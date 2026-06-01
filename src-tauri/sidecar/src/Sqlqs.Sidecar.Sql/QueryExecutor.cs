using System.Diagnostics;
using System.Globalization;
using System.Text;
using Microsoft.Data.SqlClient;
using Sqlqs.Contracts.Query;

namespace Sqlqs.Sidecar.Sql;

public sealed class QueryExecutor
{
    private readonly ConnectionService _connections;

    public QueryExecutor(ConnectionService connections)
    {
        _connections = connections;
    }

    public async Task<ExecuteSqlResponse> ExecuteAsync(
        string connectionId,
        string sql,
        long? maxRows,
        CancellationToken cancellationToken)
    {
        var limit = (maxRows.HasValue && maxRows.Value > 0) ? maxRows.Value : (long?)null;

        await using var lease = await _connections.AcquireAsync(connectionId, cancellationToken).ConfigureAwait(false);
        var connection = lease.Connection;
        var watch = Stopwatch.StartNew();
        var messages = new List<string>();

        void OnInfoMessage(object _, SqlInfoMessageEventArgs args)
        {
            foreach (SqlError error in args.Errors)
            {
                messages.Add(FormatServerError(error));
            }
        }

        connection.InfoMessage += OnInfoMessage;
        try
        {
            var resultSets = new List<ResultSetData>();
            long rowsAffected = 0;
            long? rowLimitApplied = null;

            using var cmd = new SqlCommand(sql, connection);
            cmd.CommandTimeout = 0;

            using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);

            while (true)
            {
                if (reader.FieldCount > 0)
                {
                    var (data, truncated) = await ReadResultSetAsync(reader, limit, cancellationToken).ConfigureAwait(false);
                    if (truncated && rowLimitApplied is null) rowLimitApplied = limit;
                    resultSets.Add(data);
                }

                if (!await reader.NextResultAsync(cancellationToken).ConfigureAwait(false))
                {
                    break;
                }
            }

            if (reader.RecordsAffected > 0)
            {
                rowsAffected = reader.RecordsAffected;
            }

            watch.Stop();
            return new ExecuteSqlResponse
            {
                ResultSets = resultSets,
                RowsAffected = rowsAffected,
                Messages = messages,
                ElapsedMs = watch.ElapsedMilliseconds,
                RowLimitApplied = rowLimitApplied,
            };
        }
        finally
        {
            connection.InfoMessage -= OnInfoMessage;
        }
    }

    /// <summary>
    /// Executes multiple batches sequentially under a single connection lease,
    /// preserving session state (transactions, temp tables, SET options) across
    /// GO boundaries. Each batch's result sets and row counts are accumulated.
    /// </summary>
    public async Task<ExecuteSqlResponse> ExecuteBatchesAsync(
        string connectionId,
        IReadOnlyList<string> batches,
        long? maxRows,
        CancellationToken cancellationToken)
    {
        var limit = (maxRows.HasValue && maxRows.Value > 0) ? maxRows.Value : (long?)null;

        await using var lease = await _connections.AcquireAsync(connectionId, cancellationToken).ConfigureAwait(false);
        var connection = lease.Connection;
        var watch = Stopwatch.StartNew();
        var messages = new List<string>();

        void OnInfoMessage(object _, SqlInfoMessageEventArgs args)
        {
            foreach (SqlError error in args.Errors)
            {
                messages.Add(FormatServerError(error));
            }
        }

        connection.InfoMessage += OnInfoMessage;
        try
        {
            var allResultSets = new List<ResultSetData>();
            long totalRowsAffected = 0;
            long? rowLimitApplied = null;

            for (int i = 0; i < batches.Count; i++)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var batch = batches[i];
                if (string.IsNullOrWhiteSpace(batch)) continue;

                using var cmd = new SqlCommand(batch, connection);
                cmd.CommandTimeout = 0;

                using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);

                while (true)
                {
                    if (reader.FieldCount > 0)
                    {
                        var (data, truncated) = await ReadResultSetAsync(reader, limit, cancellationToken).ConfigureAwait(false);
                        if (truncated && rowLimitApplied is null) rowLimitApplied = limit;
                        allResultSets.Add(data);
                    }

                    if (!await reader.NextResultAsync(cancellationToken).ConfigureAwait(false))
                    {
                        break;
                    }
                }

                if (reader.RecordsAffected > 0)
                {
                    totalRowsAffected += reader.RecordsAffected;
                }
            }

            watch.Stop();
            return new ExecuteSqlResponse
            {
                ResultSets = allResultSets,
                RowsAffected = totalRowsAffected,
                Messages = messages,
                ElapsedMs = watch.ElapsedMilliseconds,
                RowLimitApplied = rowLimitApplied,
            };
        }
        finally
        {
            connection.InfoMessage -= OnInfoMessage;
        }
    }

    private static async Task<(ResultSetData data, bool truncated)> ReadResultSetAsync(
        SqlDataReader reader,
        long? limit,
        CancellationToken cancellationToken)
    {
        var columns = new List<QueryColumn>(reader.FieldCount);
        var dataTypeNames = new string[reader.FieldCount];
        var schemaTable = await reader.GetSchemaTableAsync(cancellationToken).ConfigureAwait(false);

        for (int i = 0; i < reader.FieldCount; i++)
        {
            var name = reader.GetName(i);
            var typeName = reader.GetDataTypeName(i);
            dataTypeNames[i] = typeName;
            bool isNullable = true;
            bool isIdentity = false;

            if (schemaTable is not null && i < schemaTable.Rows.Count)
            {
                var row = schemaTable.Rows[i];
                if (row.Table.Columns.Contains("AllowDBNull") && row["AllowDBNull"] is bool nb)
                {
                    isNullable = nb;
                }
                if (row.Table.Columns.Contains("IsIdentity") && row["IsIdentity"] is bool id)
                {
                    isIdentity = id;
                }
            }

            columns.Add(new QueryColumn
            {
                Name = name,
                TypeName = typeName,
                IsIdentity = isIdentity,
                IsNullable = isNullable,
            });
        }

        var rows = new List<IReadOnlyList<object?>>();
        bool truncated = false;
        long count = 0;

        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            if (limit.HasValue && count >= limit.Value)
            {
                truncated = true;
                continue;
            }
            count++;

            var row = new object?[reader.FieldCount];
            for (int i = 0; i < reader.FieldCount; i++)
            {
                row[i] = await reader.IsDBNullAsync(i, cancellationToken).ConfigureAwait(false)
                    ? null
                    : NormalizeCellValue(reader.GetValue(i), dataTypeNames[i]);
            }
            rows.Add(row);
        }

        return (
            new ResultSetData
            {
                Columns = columns,
                Rows = rows,
                Truncated = truncated,
            },
            truncated);
    }

    internal static object? NormalizeCellValue(object value, string dataTypeName)
    {
        var typeLower = dataTypeName.ToLowerInvariant();

        return value switch
        {
            byte[] bytes => FormatBinary(bytes),
            DateTime dt => FormatDateTime(dt, typeLower),
            DateTimeOffset dto => FormatDateTimeOffset(dto),
            TimeSpan ts => FormatTime(ts),
            Guid g => g.ToString("D"),
            decimal d => typeLower is "money" or "smallmoney"
                ? d.ToString("F4", CultureInfo.InvariantCulture)
                : (object)d.ToString(CultureInfo.InvariantCulture),
            _ => value,
        };
    }

    private static string FormatDateTime(DateTime dt, string typeLower)
    {
        return typeLower switch
        {
            "date" => dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            "smalldatetime" => dt.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
            "datetime" => dt.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture),
            "datetime2" => dt.ToString("yyyy-MM-dd HH:mm:ss.fffffff", CultureInfo.InvariantCulture),
            _ => dt.ToString("yyyy-MM-dd HH:mm:ss.fffffff", CultureInfo.InvariantCulture),
        };
    }

    private static string FormatDateTimeOffset(DateTimeOffset dto)
    {
        return dto.ToString("yyyy-MM-dd HH:mm:ss.fffffff zzz", CultureInfo.InvariantCulture);
    }

    private static string FormatTime(TimeSpan ts)
    {
        var negative = ts < TimeSpan.Zero;
        var abs = negative ? ts.Negate() : ts;
        var formatted = string.Format(
            CultureInfo.InvariantCulture,
            "{0:D2}:{1:D2}:{2:D2}.{3:D7}",
            (int)abs.TotalHours,
            abs.Minutes,
            abs.Seconds,
            (int)(abs.Ticks % TimeSpan.TicksPerSecond));
        return negative ? "-" + formatted : formatted;
    }

    private static string FormatBinary(byte[] bytes)
    {
        var sb = new StringBuilder(bytes.Length * 2 + 2);
        sb.Append("0x");
        foreach (var b in bytes) sb.Append(b.ToString("X2", CultureInfo.InvariantCulture));
        return sb.ToString();
    }

    private static string FormatServerError(SqlError error)
    {
        return $"Msg {error.Number}, Level {error.Class}, State {error.State}, Line {error.LineNumber}\n{error.Message}";
    }
}
