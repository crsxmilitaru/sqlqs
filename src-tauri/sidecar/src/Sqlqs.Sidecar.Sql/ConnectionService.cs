using System.Collections.Concurrent;
using Microsoft.Data.SqlClient;
using Sqlqs.Contracts.Connection;

namespace Sqlqs.Sidecar.Sql;

public sealed class ConnectionService : IAsyncDisposable
{
    private readonly ConcurrentDictionary<Guid, ManagedConnection> _connections = new();

    public async Task<OpenConnectionResponse> OpenAsync(
        SqlConnectionConfig config,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(config);

        var connectionString = BuildConnectionString(config);
        var connection = new SqlConnection(connectionString);

        try
        {
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
            await InitializeSessionAsync(connection, cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            await connection.DisposeAsync().ConfigureAwait(false);
            throw;
        }

        var id = Guid.NewGuid();
        var managed = new ManagedConnection(id, connection);
        if (!_connections.TryAdd(id, managed))
        {
            await managed.DisposeAsync().ConfigureAwait(false);
            throw new InvalidOperationException($"Connection id collision for {id}");
        }

        return new OpenConnectionResponse
        {
            ConnectionId = id.ToString("D"),
            ServerName = connection.DataSource ?? string.Empty,
            ServerVersion = connection.ServerVersion ?? string.Empty,
            CurrentDatabase = string.IsNullOrEmpty(connection.Database) ? null : connection.Database,
        };
    }

    /// <summary>
    /// Apply the same SET options SSMS sends when opening a new connection.
    /// These persist for the lifetime of the connection. ARITHABORT ON in
    /// particular is required for DML against indexed views, computed-column
    /// indexes and filtered indexes; Microsoft.Data.SqlClient leaves it OFF.
    /// </summary>
    private static async Task InitializeSessionAsync(SqlConnection connection, CancellationToken cancellationToken)
    {
        const string sql =
            "SET ANSI_NULLS ON;" +
            "SET ANSI_PADDING ON;" +
            "SET ANSI_WARNINGS ON;" +
            "SET ARITHABORT ON;" +
            "SET CONCAT_NULL_YIELDS_NULL ON;" +
            "SET NUMERIC_ROUNDABORT OFF;" +
            "SET QUOTED_IDENTIFIER ON;" +
            "SET TEXTSIZE 2147483647;";
        await using var cmd = new SqlCommand(sql, connection);
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task CloseAsync(string connectionId)
    {
        var id = ParseConnectionId(connectionId);

        if (!_connections.TryGetValue(id, out var managed))
        {
            return;
        }

        if (!managed.TryBeginClose())
        {
            return;
        }

        await managed.Gate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        try
        {
            _connections.TryRemove(id, out _);
            await managed.DisposeAsync().ConfigureAwait(false);
        }
        finally
        {
            managed.Gate.Release();
        }
    }

    public async Task ChangeDatabaseAsync(string connectionId, string database, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(database))
        {
            throw new ArgumentException("Database name is required", nameof(database));
        }
        await using var lease = await AcquireAsync(connectionId, cancellationToken).ConfigureAwait(false);
        lease.Connection.ChangeDatabase(database);
    }

    /// <summary>
    /// Resolves a connection without serializing access. Only call this while
    /// already holding the connection's lease (see <see cref="AcquireAsync"/>).
    /// </summary>
    public SqlConnection Resolve(string connectionId) => ResolveManaged(connectionId).Connection;

    /// <summary>
    /// Acquires exclusive access to a connection. A single <see cref="SqlConnection"/>
    /// cannot service more than one command at a time, so every operation that
    /// touches a connection must hold its lease for the full duration of the work.
    /// </summary>
    public async Task<ConnectionLease> AcquireAsync(string connectionId, CancellationToken cancellationToken)
    {
        var id = ParseConnectionId(connectionId);
        var managed = ResolveManaged(id, connectionId);
        await managed.Gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        if (managed.IsClosing || !_connections.TryGetValue(id, out var current) || !ReferenceEquals(current, managed))
        {
            managed.Gate.Release();
            throw new InvalidOperationException($"Connection {connectionId} is closed");
        }
        return new ConnectionLease(managed.Connection, managed.Gate);
    }

    private ManagedConnection ResolveManaged(string connectionId)
    {
        return ResolveManaged(ParseConnectionId(connectionId), connectionId);
    }

    private ManagedConnection ResolveManaged(Guid id, string connectionId)
    {
        if (!_connections.TryGetValue(id, out var managed))
        {
            throw new InvalidOperationException($"Connection {connectionId} not found");
        }

        return managed;
    }

    private static Guid ParseConnectionId(string connectionId)
    {
        if (!Guid.TryParseExact(connectionId, "D", out var id))
        {
            throw new ArgumentException($"Invalid connection id format: {connectionId}", nameof(connectionId));
        }

        return id;
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var id in _connections.Keys.ToArray())
        {
            await CloseAsync(id.ToString("D")).ConfigureAwait(false);
        }
    }

    internal static string BuildConnectionString(SqlConnectionConfig config)
    {
        SqlConnectionStringBuilder builder;
        var hasConnectionString = !string.IsNullOrWhiteSpace(config.ConnectionString);

        if (hasConnectionString)
        {
            builder = new SqlConnectionStringBuilder(config.ConnectionString);
        }
        else
        {
            builder = new SqlConnectionStringBuilder
            {
                DataSource = config.Port.HasValue
                    ? $"{config.Server},{config.Port.Value}"
                    : config.Server,
            };

            if (!string.IsNullOrWhiteSpace(config.Database))
            {
                builder.InitialCatalog = config.Database!;
            }

            if (config.UseWindowsAuth)
            {
                builder.IntegratedSecurity = true;
            }
            else if (!string.IsNullOrEmpty(config.Username))
            {
                builder.UserID = config.Username!;
            }
        }

        if (builder.IntegratedSecurity && !OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("Windows authentication is only supported on Windows.");
        }

        // Apply the password last so an out-of-band value (e.g. typed separately
        // from a saved connection string whose password was stripped) always wins
        // for SQL authentication, regardless of which branch built the builder.
        if (!config.UseWindowsAuth && config.Password is not null)
        {
            builder.Password = config.Password;
        }

        if (!hasConnectionString)
        {
            builder.Encrypt = config.Encrypt
                ? SqlConnectionEncryptOption.Mandatory
                : SqlConnectionEncryptOption.Optional;
            builder.TrustServerCertificate = config.TrustServerCertificate;
        }
        builder.Pooling = false;
        builder.ApplicationName = "SQL Query Studio";

        return builder.ConnectionString;
    }

    public sealed class ConnectionLease : IAsyncDisposable
    {
        private readonly SemaphoreSlim _gate;
        private int _released;

        internal ConnectionLease(SqlConnection connection, SemaphoreSlim gate)
        {
            Connection = connection;
            _gate = gate;
        }

        public SqlConnection Connection { get; }

        public ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref _released, 1) == 0)
            {
                _gate.Release();
            }
            return ValueTask.CompletedTask;
        }
    }

    private sealed class ManagedConnection : IAsyncDisposable
    {
        public ManagedConnection(Guid id, SqlConnection connection)
        {
            Id = id;
            Connection = connection;
        }

        public Guid Id { get; }
        public SqlConnection Connection { get; }
        public bool IsClosing => Volatile.Read(ref _closing) != 0;

        // A single SqlConnection cannot run concurrent commands; this gate
        // serializes every operation issued against this connection.
        public SemaphoreSlim Gate { get; } = new(1, 1);

        private int _closing;

        public bool TryBeginClose()
        {
            return Interlocked.Exchange(ref _closing, 1) == 0;
        }

        public async ValueTask DisposeAsync()
        {
            try
            {
                await Connection.DisposeAsync().ConfigureAwait(false);
            }
            catch
            {
                // ignore: closing is best-effort
            }
        }
    }
}
