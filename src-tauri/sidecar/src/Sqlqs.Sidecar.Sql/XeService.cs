using System.Text;
using System.Xml.Linq;
using Microsoft.Data.SqlClient;
using Sqlqs.Contracts.Xe;

namespace Sqlqs.Sidecar.Sql;

public sealed class XeService
{
    private static readonly string[] DefaultEvents =
    {
        "sqlserver.error_reported",
        "sqlserver.attention",
        "sqlserver.sql_batch_completed",
        "sqlserver.rpc_completed",
    };

    private readonly ConnectionService _connections;

    public XeService(ConnectionService connections)
    {
        _connections = connections;
    }

    public async Task<StartXeSessionResponse> StartSessionAsync(
        StartXeSessionRequest request,
        CancellationToken cancellationToken)
    {
        ValidateSessionName(request.SessionName);
        await using var lease = await _connections.AcquireAsync(request.ConnectionId, cancellationToken).ConfigureAwait(false);
        var connection = lease.Connection;

        var events = (request.Events is { Count: > 0 } supplied)
            ? supplied.Select(EnsureFullyQualifiedEventName).ToArray()
            : DefaultEvents;

        var dropIfExists = $"IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = @name) DROP EVENT SESSION [{request.SessionName}] ON SERVER";
        await using (var cmd = new SqlCommand(dropIfExists, connection))
        {
            cmd.Parameters.AddWithValue("@name", request.SessionName);
            await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        var create = BuildCreateSessionScript(request.SessionName, events, request.MaxMemoryKb, request.MaxEventsRetained);
        await using (var cmd = new SqlCommand(create, connection))
        {
            await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        var start = $"ALTER EVENT SESSION [{request.SessionName}] ON SERVER STATE = START";
        await using (var cmd = new SqlCommand(start, connection))
        {
            await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        return new StartXeSessionResponse
        {
            SessionName = request.SessionName,
            Events = events,
        };
    }

    public async Task StopSessionAsync(StopXeSessionRequest request, CancellationToken cancellationToken)
    {
        ValidateSessionName(request.SessionName);
        await using var lease = await _connections.AcquireAsync(request.ConnectionId, cancellationToken).ConfigureAwait(false);
        var connection = lease.Connection;

        var sql = $@"
IF EXISTS (SELECT 1 FROM sys.dm_xe_sessions WHERE name = @name)
    ALTER EVENT SESSION [{request.SessionName}] ON SERVER STATE = STOP;
{(request.Drop ? $"IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = @name) DROP EVENT SESSION [{request.SessionName}] ON SERVER;" : "")}
";
        await using var cmd = new SqlCommand(sql, connection);
        cmd.Parameters.AddWithValue("@name", request.SessionName);
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<ReadXeSessionResponse> ReadSessionAsync(
        ReadXeSessionRequest request,
        CancellationToken cancellationToken)
    {
        ValidateSessionName(request.SessionName);
        await using var lease = await _connections.AcquireAsync(request.ConnectionId, cancellationToken).ConfigureAwait(false);
        var connection = lease.Connection;

        const string sql = @"
SELECT CAST(t.target_data AS XML) AS target_data
FROM sys.dm_xe_session_targets t
JOIN sys.dm_xe_sessions s ON s.address = t.event_session_address
WHERE s.name = @name AND t.target_name = 'ring_buffer'";

        await using var cmd = new SqlCommand(sql, connection);
        cmd.Parameters.AddWithValue("@name", request.SessionName);

        var xml = (await cmd.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false)) as string;
        if (string.IsNullOrEmpty(xml))
        {
            return new ReadXeSessionResponse();
        }

        return ParseRingBufferXml(xml!);
    }

    internal static ReadXeSessionResponse ParseRingBufferXml(string xml)
    {
        var doc = XDocument.Parse(xml);
        var root = doc.Root ?? throw new InvalidOperationException("ring_buffer XML missing root");

        int dropped = ParseIntAttribute(root, "droppedCount")
            ?? ParseIntAttribute(root, "memoryDroppedCount")
            ?? 0;

        var events = new List<XeEventDto>();
        foreach (var ev in root.Elements("event"))
        {
            var name = ev.Attribute("name")?.Value ?? string.Empty;
            var ts = ev.Attribute("timestamp")?.Value ?? string.Empty;

            var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var data in ev.Elements("data"))
            {
                var fieldName = data.Attribute("name")?.Value;
                if (string.IsNullOrEmpty(fieldName)) continue;
                var value = data.Element("value")?.Value ?? string.Empty;
                fields[fieldName] = value;
            }
            foreach (var action in ev.Elements("action"))
            {
                var actionName = action.Attribute("name")?.Value;
                if (string.IsNullOrEmpty(actionName)) continue;
                var value = action.Element("value")?.Value ?? string.Empty;
                fields[actionName] = value;
            }

            events.Add(new XeEventDto { Name = name, TimestampUtc = ts, Fields = fields });
        }

        return new ReadXeSessionResponse { Events = events, DroppedEventCount = dropped };
    }

    private static int? ParseIntAttribute(XElement el, string name)
    {
        var value = el.Attribute(name)?.Value;
        return int.TryParse(value, out var n) ? n : (int?)null;
    }

    private static string BuildCreateSessionScript(string sessionName, IReadOnlyList<string> events, int maxMemoryKb, int maxEventsRetained)
    {
        var sb = new StringBuilder();
        sb.Append($"CREATE EVENT SESSION [{sessionName}] ON SERVER ");
        for (int i = 0; i < events.Count; i++)
        {
            if (i > 0) sb.Append(", ");
            sb.Append($"ADD EVENT {events[i]} ");
        }
        sb.Append($"ADD TARGET package0.ring_buffer (SET max_memory = {maxMemoryKb}, max_events_limit = {maxEventsRetained}) ");
        sb.Append("WITH (MAX_DISPATCH_LATENCY = 1 SECONDS, STARTUP_STATE = OFF)");
        return sb.ToString();
    }

    private static string EnsureFullyQualifiedEventName(string raw)
    {
        var trimmed = raw.Trim();
        if (trimmed.Length == 0)
            throw new ArgumentException("Event name must not be empty");
        foreach (var ch in trimmed)
        {
            if (!char.IsLetterOrDigit(ch) && ch != '_' && ch != '.')
                throw new ArgumentException($"Event name contains invalid character '{ch}': {trimmed}");
        }
        return trimmed.Contains('.') ? trimmed : $"sqlserver.{trimmed}";
    }

    private static void ValidateSessionName(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Session name is required", nameof(name));
        }
        foreach (var ch in name)
        {
            if (!char.IsLetterOrDigit(ch) && ch != '_')
            {
                throw new ArgumentException("Session name must contain only letters, digits and underscores", nameof(name));
            }
        }
    }
}
