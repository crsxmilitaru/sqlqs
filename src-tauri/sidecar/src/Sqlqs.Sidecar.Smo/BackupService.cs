using System.Diagnostics;
using Microsoft.SqlServer.Management.Common;
using Microsoft.SqlServer.Management.Smo;
using Sqlqs.Contracts.Backup;
using Sqlqs.Sidecar.Sql;

namespace Sqlqs.Sidecar.Smo;

public sealed class BackupService
{
    private readonly ConnectionService _connections;

    public BackupService(ConnectionService connections)
    {
        _connections = connections;
    }

    public async Task<BackupResponse> BackupAsync(BackupRequest request, CancellationToken cancellationToken)
    {
        await using var lease = await _connections.AcquireAsync(request.ConnectionId, cancellationToken).ConfigureAwait(false);
        return await Task.Run(() => DoBackup(request, cancellationToken)).ConfigureAwait(false);
    }

    public async Task<BackupResponse> RestoreAsync(RestoreRequest request, CancellationToken cancellationToken)
    {
        await using var lease = await _connections.AcquireAsync(request.ConnectionId, cancellationToken).ConfigureAwait(false);
        return await Task.Run(() => DoRestore(request, cancellationToken)).ConfigureAwait(false);
    }

    public async Task<BackupDefaultsResponse> GetDefaultsAsync(BackupDefaultsRequest request, CancellationToken cancellationToken)
    {
        await using var lease = await _connections.AcquireAsync(request.ConnectionId, cancellationToken).ConfigureAwait(false);
        return await Task.Run(() => GetDefaults(request)).ConfigureAwait(false);
    }

    public async Task<InspectBackupResponse> InspectAsync(InspectBackupRequest request, CancellationToken cancellationToken)
    {
        await using var lease = await _connections.AcquireAsync(request.ConnectionId, cancellationToken).ConfigureAwait(false);
        return await Task.Run(() => Inspect(request, cancellationToken)).ConfigureAwait(false);
    }

    private BackupResponse DoBackup(BackupRequest request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var sqlConn = _connections.Resolve(request.ConnectionId);
        var originalDatabase = sqlConn.Database;
        try
        {
            var server = new Server(new ServerConnection(sqlConn));

            var backup = new Backup
            {
                Database = request.Database,
                Action = request.BackupType.ToUpperInvariant() switch
                {
                    "LOG" => BackupActionType.Log,
                    _ => BackupActionType.Database,
                },
                Incremental = request.BackupType.Equals("DIFFERENTIAL", StringComparison.OrdinalIgnoreCase),
                CopyOnly = request.CopyOnly,
                CompressionOption = request.Compression
                    ? BackupCompressionOptions.On
                    : BackupCompressionOptions.Default,
                Checksum = request.Checksum,
                ContinueAfterError = false,
                Initialize = request.Overwrite,
                FormatMedia = false,
                SkipTapeHeader = true,
            };
            backup.Devices.AddDevice(request.DestinationPath, DeviceType.File);

            var watch = Stopwatch.StartNew();
            backup.SqlBackup(server);
            watch.Stop();

            return new BackupResponse
            {
                Message = $"BACKUP completed for [{request.Database}] -> {request.DestinationPath}",
                ElapsedMs = watch.ElapsedMilliseconds,
            };
        }
        finally
        {
            ScriptingService.RestoreDatabaseContext(sqlConn, originalDatabase);
        }
    }

    private BackupResponse DoRestore(RestoreRequest request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var sqlConn = _connections.Resolve(request.ConnectionId);
        var originalDatabase = sqlConn.Database;
        try
        {
            // SMO's Restore does not kick existing sessions, so a REPLACE over a
            // database that has active connections fails with "database in use".
            // Force SINGLE_USER first (matching the previous T-SQL behavior).
            if (request.ReplaceExisting)
            {
                SetDatabaseUserMode(sqlConn, request.TargetDatabase, "SINGLE_USER WITH ROLLBACK IMMEDIATE", requireNotRestoring: false);
            }

            try
            {
                var server = new Server(new ServerConnection(sqlConn));

                var restore = new Restore
                {
                    Database = request.TargetDatabase,
                    Action = RestoreActionType.Database,
                    NoRecovery = !request.Recovery,
                    ReplaceDatabase = request.ReplaceExisting,
                    RestrictedUser = request.RestrictedUser,
                };
                restore.Devices.AddDevice(request.SourcePath, DeviceType.File);

                foreach (var move in request.FileMoves)
                {
                    restore.RelocateFiles.Add(new RelocateFile(move.LogicalName, move.PhysicalName));
                }

                var watch = Stopwatch.StartNew();
                restore.SqlRestore(server);
                watch.Stop();

                // Only an online (RECOVERY) database can leave single-user mode.
                if (request.ReplaceExisting && request.Recovery)
                {
                    SetDatabaseUserMode(
                        sqlConn,
                        request.TargetDatabase,
                        request.RestrictedUser ? "RESTRICTED_USER" : "MULTI_USER",
                        requireNotRestoring: true);
                }

                return new BackupResponse
                {
                    Message = $"RESTORE completed for [{request.TargetDatabase}] from {request.SourcePath}",
                    ElapsedMs = watch.ElapsedMilliseconds,
                };
            }
            catch
            {
                if (request.ReplaceExisting)
                {
                    try
                    {
                        SetDatabaseUserMode(sqlConn, request.TargetDatabase, "MULTI_USER", requireNotRestoring: true);
                    }
                    catch
                    {
                        // best-effort revert
                    }
                }
                throw;
            }
        }
        finally
        {
            ScriptingService.RestoreDatabaseContext(sqlConn, originalDatabase);
        }
    }

    private BackupDefaultsResponse GetDefaults(BackupDefaultsRequest request)
    {
        var sqlConn = _connections.Resolve(request.ConnectionId);
        var originalDatabase = sqlConn.Database;
        try
        {
            var server = new Server(new ServerConnection(sqlConn));
            var info = server.Information;
            var settings = server.Settings;
            return new BackupDefaultsResponse
            {
                BackupDirectory = NullIfBlank(settings.BackupDirectory),
                DataDirectory = NullIfBlank(info.MasterDBPath),
                LogDirectory = NullIfBlank(info.MasterDBLogPath),
            };
        }
        finally
        {
            ScriptingService.RestoreDatabaseContext(sqlConn, originalDatabase);
        }
    }

    private InspectBackupResponse Inspect(InspectBackupRequest request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var sqlConn = _connections.Resolve(request.ConnectionId);
        var originalDatabase = sqlConn.Database;
        try
        {
            var server = new Server(new ServerConnection(sqlConn));

            var restore = new Restore();
            restore.Devices.AddDevice(request.SourcePath, DeviceType.File);
            var dt = restore.ReadFileList(server);

            var files = new List<BackupFileInfoDto>();
            foreach (System.Data.DataRow row in dt.Rows)
            {
                files.Add(new BackupFileInfoDto
                {
                    LogicalName = row["LogicalName"]?.ToString() ?? string.Empty,
                    PhysicalName = row["PhysicalName"]?.ToString() ?? string.Empty,
                    FileType = row["Type"]?.ToString() ?? string.Empty,
                    SizeBytes = row["Size"] is long l ? l : Convert.ToInt64(row["Size"] ?? 0L),
                });
            }

            return new InspectBackupResponse { Files = files };
        }
        finally
        {
            ScriptingService.RestoreDatabaseContext(sqlConn, originalDatabase);
        }
    }

    /// <summary>
    /// Sets the access mode of <paramref name="database"/> via ALTER DATABASE,
    /// quoting the identifier and guarding existence so it is safe to call when
    /// the database may be absent or mid-restore.
    /// </summary>
    private static void SetDatabaseUserMode(
        Microsoft.Data.SqlClient.SqlConnection connection,
        string database,
        string mode,
        bool requireNotRestoring)
    {
        var quoted = "[" + database.Replace("]", "]]") + "]";
        var notRestoring = requireNotRestoring
            ? " AND DATABASEPROPERTYEX(@db, 'Status') <> N'RESTORING'"
            : string.Empty;
        var sql = $"IF DB_ID(@db) IS NOT NULL{notRestoring} ALTER DATABASE {quoted} SET {mode};";
        using var cmd = new Microsoft.Data.SqlClient.SqlCommand(sql, connection);
        cmd.Parameters.AddWithValue("@db", database);
        cmd.ExecuteNonQuery();
    }

    private static string? NullIfBlank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;
}
