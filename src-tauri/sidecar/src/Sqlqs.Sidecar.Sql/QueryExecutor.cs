using System.Data;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using System.Linq;
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
        var outputs = new List<OutputItem>();
        var statisticsEnabled = false;

        void OnInfoMessage(object _, SqlInfoMessageEventArgs args)
        {
            foreach (SqlError error in args.Errors)
            {
                var msg = error.Class > 10 ? FormatServerError(error) : error.Message;
                outputs.Add(new OutputItem { Type = 1, Message = msg });
            }
        }

        connection.InfoMessage += OnInfoMessage;
        try
        {
            try
            {
                using var cmdStatsOn = new SqlCommand("SET STATISTICS TIME ON; SET STATISTICS IO ON;", connection);
                await cmdStatsOn.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
                statisticsEnabled = true;
            }
            catch
            {
                // Ignore
            }

            try
            {
                var resultSets = new List<ResultSetData>();
                long rowsAffected = 0;
                long? rowLimitApplied = null;

                using var cmd = new SqlCommand(sql, connection);
                cmd.CommandTimeout = 0;

                using (var reader = await cmd.ExecuteReaderAsync(ResolveReaderBehavior(sql), cancellationToken).ConfigureAwait(false))
                {
                    while (true)
                    {
                        if (reader.FieldCount > 0)
                        {
                            var (data, truncated) = await ReadResultSetAsync(reader, limit, cancellationToken).ConfigureAwait(false);
                            if (truncated && rowLimitApplied is null) rowLimitApplied = limit;
                            resultSets.Add(data);
                            outputs.Add(new OutputItem { Type = 0, ResultSetIndex = resultSets.Count - 1 });
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
                }

                if (statisticsEnabled)
                {
                    await DisableStatisticsAsync(connection).ConfigureAwait(false);
                    statisticsEnabled = false;
                }

                watch.Stop();
                var stats = ParseAndFilterStatistics(outputs, out var filteredOutputs);
                var filteredMessages = filteredOutputs.Where(o => o.Type == 1).Select(o => o.Message!).ToList();
                return new ExecuteSqlResponse
                {
                    ResultSets = resultSets,
                    RowsAffected = rowsAffected,
                    Messages = filteredMessages,
                    Statistics = stats,
                    ElapsedMs = watch.ElapsedMilliseconds,
                    RowLimitApplied = rowLimitApplied,
                    Outputs = filteredOutputs,
                };
            }
            finally
            {
                if (statisticsEnabled)
                {
                    await DisableStatisticsAsync(connection).ConfigureAwait(false);
                }
            }
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
        var outputs = new List<OutputItem>();
        var statisticsEnabled = false;

        void OnInfoMessage(object _, SqlInfoMessageEventArgs args)
        {
            foreach (SqlError error in args.Errors)
            {
                var msg = error.Class > 10 ? FormatServerError(error) : error.Message;
                outputs.Add(new OutputItem { Type = 1, Message = msg });
            }
        }

        connection.InfoMessage += OnInfoMessage;
        try
        {
            try
            {
                using var cmdStatsOn = new SqlCommand("SET STATISTICS TIME ON; SET STATISTICS IO ON;", connection);
                await cmdStatsOn.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
                statisticsEnabled = true;
            }
            catch
            {
                // Ignore
            }

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

                    using var reader = await cmd.ExecuteReaderAsync(ResolveReaderBehavior(batch), cancellationToken).ConfigureAwait(false);

                    while (true)
                    {
                        if (reader.FieldCount > 0)
                        {
                            var (data, truncated) = await ReadResultSetAsync(reader, limit, cancellationToken).ConfigureAwait(false);
                            if (truncated && rowLimitApplied is null) rowLimitApplied = limit;
                            allResultSets.Add(data);
                            outputs.Add(new OutputItem { Type = 0, ResultSetIndex = allResultSets.Count - 1 });
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

                if (statisticsEnabled)
                {
                    await DisableStatisticsAsync(connection).ConfigureAwait(false);
                    statisticsEnabled = false;
                }

                watch.Stop();
                var stats = ParseAndFilterStatistics(outputs, out var filteredOutputs);
                var filteredMessages = filteredOutputs.Where(o => o.Type == 1).Select(o => o.Message!).ToList();
                return new ExecuteSqlResponse
                {
                    ResultSets = allResultSets,
                    RowsAffected = totalRowsAffected,
                    Messages = filteredMessages,
                    Statistics = stats,
                    ElapsedMs = watch.ElapsedMilliseconds,
                    RowLimitApplied = rowLimitApplied,
                    Outputs = filteredOutputs,
                };
            }
            finally
            {
                if (statisticsEnabled)
                {
                    await DisableStatisticsAsync(connection).ConfigureAwait(false);
                }
            }
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
            string? baseTableName = null;
            string? baseSchemaName = null;
            string? baseColumnName = null;
            bool isExpression = false;

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
                if (row.Table.Columns.Contains("BaseTableName") && row["BaseTableName"] is string btn && !string.IsNullOrEmpty(btn))
                {
                    baseTableName = btn;
                }
                if (row.Table.Columns.Contains("BaseSchemaName") && row["BaseSchemaName"] is string bsn && !string.IsNullOrEmpty(bsn))
                {
                    baseSchemaName = bsn;
                }
                if (row.Table.Columns.Contains("BaseColumnName") && row["BaseColumnName"] is string bcn && !string.IsNullOrEmpty(bcn))
                {
                    baseColumnName = bcn;
                }
                if (row.Table.Columns.Contains("IsExpression") && row["IsExpression"] is bool ie)
                {
                    isExpression = ie;
                }
            }

            columns.Add(new QueryColumn
            {
                Name = name,
                TypeName = typeName,
                IsIdentity = isIdentity,
                IsNullable = isNullable,
                BaseTableName = baseTableName,
                BaseSchemaName = baseSchemaName,
                BaseColumnName = baseColumnName,
                IsExpression = isExpression,
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

    private static readonly Regex BatchExclusiveDdlRegex = new(
        @"^(?:(?:CREATE\s+(?:OR\s+ALTER\s+)?|ALTER\s+)(?:PROC(?:EDURE)?|VIEW|FUNCTION|TRIGGER)|CREATE\s+(?:RULE|DEFAULT|SCHEMA))\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static CommandBehavior ResolveReaderBehavior(string sql)
    {
        return StartsWithBatchExclusiveDdl(sql)
            ? CommandBehavior.Default
            : CommandBehavior.KeyInfo;
    }

    internal static bool StartsWithBatchExclusiveDdl(string sql)
    {
        var i = 0;
        while (i < sql.Length)
        {
            var c = sql[i];
            if (char.IsWhiteSpace(c))
            {
                i++;
                continue;
            }

            if (i + 1 < sql.Length && c == '-' && sql[i + 1] == '-')
            {
                i += 2;
                while (i < sql.Length && sql[i] != '\n')
                {
                    i++;
                }
                continue;
            }

            if (i + 1 < sql.Length && c == '/' && sql[i + 1] == '*')
            {
                i += 2;
                while (i + 1 < sql.Length && !(sql[i] == '*' && sql[i + 1] == '/'))
                {
                    i++;
                }
                if (i + 1 < sql.Length)
                {
                    i += 2;
                }
                continue;
            }

            break;
        }

        return BatchExclusiveDdlRegex.IsMatch(sql.AsSpan(i));
    }

    private static async Task DisableStatisticsAsync(SqlConnection connection)
    {
        try
        {
            using var cmdStatsOff = new SqlCommand("SET STATISTICS TIME OFF; SET STATISTICS IO OFF;", connection);
            cmdStatsOff.CommandTimeout = 5;
            await cmdStatsOff.ExecuteNonQueryAsync(CancellationToken.None).ConfigureAwait(false);
        }
        catch
        {
            // Ignore cleanup failures; the connection lease/next command handles broken sessions.
        }
    }

    private static readonly Regex CompileRegex = new(
        @"SQL\s+Server\s+parse\s+and\s+compile\s+time:\s+CPU\s+time\s*=\s*(\d+)\s*ms,\s+elapsed\s+time\s*=\s*(\d+)\s*ms",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex ExecutionRegex = new(
        @"SQL\s+Server\s+Execution\s+Times:\s+CPU\s+time\s*=\s*(\d+)\s*ms,\s+elapsed\s+time\s*=\s*(\d+)\s*ms",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static QueryStatistics? ParseAndFilterStatistics(List<OutputItem> rawOutputs, out List<OutputItem> filteredOutputs)
    {
        var stats = new QueryStatistics();
        filteredOutputs = new List<OutputItem>();
        bool hasAnyStats = false;

        foreach (var item in rawOutputs)
        {
            if (item.Type != 1 || string.IsNullOrWhiteSpace(item.Message))
            {
                filteredOutputs.Add(item);
                continue;
            }

            var msg = item.Message;
            bool isStatsMsg = false;

            var compMatch = CompileRegex.Match(msg);
            if (compMatch.Success)
            {
                isStatsMsg = true;
                hasAnyStats = true;
                if (long.TryParse(compMatch.Groups[1].Value, out var cpu)) stats.ParseAndCompileCpuTimeMs += cpu;
                if (long.TryParse(compMatch.Groups[2].Value, out var el)) stats.ParseAndCompileElapsedTimeMs += el;
            }

            var execMatch = ExecutionRegex.Match(msg);
            if (execMatch.Success)
            {
                isStatsMsg = true;
                hasAnyStats = true;
                if (long.TryParse(execMatch.Groups[1].Value, out var cpu)) stats.ExecutionCpuTimeMs += cpu;
                if (long.TryParse(execMatch.Groups[2].Value, out var el)) stats.ExecutionElapsedTimeMs += el;
            }

            if (msg.StartsWith("Table '", StringComparison.OrdinalIgnoreCase))
            {
                int firstQuote = 6;
                int secondQuote = msg.IndexOf('\'', firstQuote + 1);
                if (secondQuote > firstQuote)
                {
                    var tableName = msg.Substring(firstQuote + 1, secondQuote - firstQuote - 1);
                    int dotIndex = msg.IndexOf('.', secondQuote);
                    if (dotIndex > 0)
                    {
                        var propertiesPart = msg.Substring(dotIndex + 1).Trim();
                        var parts = propertiesPart.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);

                        long scan = 0, logical = 0, physical = 0, readAhead = 0, lobLogical = 0, lobPhysical = 0, lobReadAhead = 0;
                        bool hasParsedAnyProperty = false;

                        foreach (var part in parts)
                        {
                            var trimmedPart = part.Trim();
                            int lastSpace = trimmedPart.LastIndexOf(' ');
                            if (lastSpace > 0)
                            {
                                var propName = trimmedPart.Substring(0, lastSpace).Trim();
                                var propValStr = trimmedPart.Substring(lastSpace + 1).Trim().TrimEnd('.');

                                if (long.TryParse(propValStr, out var propVal))
                                {
                                    if (string.Equals(propName, "Scan count", StringComparison.OrdinalIgnoreCase))
                                    {
                                        scan = propVal;
                                        hasParsedAnyProperty = true;
                                    }
                                    else if (string.Equals(propName, "logical reads", StringComparison.OrdinalIgnoreCase))
                                    {
                                        logical = propVal;
                                        hasParsedAnyProperty = true;
                                    }
                                    else if (string.Equals(propName, "physical reads", StringComparison.OrdinalIgnoreCase))
                                    {
                                        physical = propVal;
                                        hasParsedAnyProperty = true;
                                    }
                                    else if (string.Equals(propName, "read-ahead reads", StringComparison.OrdinalIgnoreCase))
                                    {
                                        readAhead = propVal;
                                        hasParsedAnyProperty = true;
                                    }
                                    else if (string.Equals(propName, "lob logical reads", StringComparison.OrdinalIgnoreCase))
                                    {
                                        lobLogical = propVal;
                                        hasParsedAnyProperty = true;
                                    }
                                    else if (string.Equals(propName, "lob physical reads", StringComparison.OrdinalIgnoreCase))
                                    {
                                        lobPhysical = propVal;
                                        hasParsedAnyProperty = true;
                                    }
                                    else if (string.Equals(propName, "lob read-ahead reads", StringComparison.OrdinalIgnoreCase))
                                    {
                                        lobReadAhead = propVal;
                                        hasParsedAnyProperty = true;
                                    }
                                }
                            }
                        }

                        if (hasParsedAnyProperty)
                        {
                            isStatsMsg = true;
                            hasAnyStats = true;

                            var existing = stats.TableIo.FirstOrDefault(t => string.Equals(t.TableName, tableName, StringComparison.OrdinalIgnoreCase));
                            if (existing != null)
                            {
                                existing.ScanCount += scan;
                                existing.LogicalReads += logical;
                                existing.PhysicalReads += physical;
                                existing.ReadAheadReads += readAhead;
                                existing.LobLogicalReads += lobLogical;
                                existing.LobPhysicalReads += lobPhysical;
                                existing.LobReadAheadReads += lobReadAhead;
                            }
                            else
                            {
                                stats.TableIo.Add(new TableIoStatistics
                                {
                                    TableName = tableName,
                                    ScanCount = scan,
                                    LogicalReads = logical,
                                    PhysicalReads = physical,
                                    ReadAheadReads = readAhead,
                                    LobLogicalReads = lobLogical,
                                    LobPhysicalReads = lobPhysical,
                                    LobReadAheadReads = lobReadAhead
                                });
                            }
                        }
                    }
                }
            }

            if (msg.Trim().Equals("SQL Server parse and compile time:", StringComparison.OrdinalIgnoreCase) ||
                msg.Trim().Equals("SQL Server Execution Times:", StringComparison.OrdinalIgnoreCase))
            {
                isStatsMsg = true;
                hasAnyStats = true;
            }

            if (!isStatsMsg)
            {
                filteredOutputs.Add(item);
            }
        }

        return hasAnyStats ? stats : null;
    }
}
