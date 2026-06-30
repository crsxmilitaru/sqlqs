namespace Sqlqs.Contracts.Query;

public sealed class OutputItem
{
    public int Type { get; set; }
    public int? ResultSetIndex { get; set; }
    public string? Message { get; set; }
}

public sealed class ExecuteSqlResponse
{
    public IReadOnlyList<ResultSetData> ResultSets { get; set; } = Array.Empty<ResultSetData>();
    public long RowsAffected { get; set; }
    public IReadOnlyList<string> Messages { get; set; } = Array.Empty<string>();
    public long ElapsedMs { get; set; }
    public long? RowLimitApplied { get; set; }
    public QueryStatistics? Statistics { get; set; }
    public IReadOnlyList<OutputItem> Outputs { get; set; } = Array.Empty<OutputItem>();
}

public sealed class TableIoStatistics
{
    public string TableName { get; set; } = string.Empty;
    public long ScanCount { get; set; }
    public long LogicalReads { get; set; }
    public long PhysicalReads { get; set; }
    public long ReadAheadReads { get; set; }
    public long LobLogicalReads { get; set; }
    public long LobPhysicalReads { get; set; }
    public long LobReadAheadReads { get; set; }
}

public sealed class QueryStatistics
{
    public long ParseAndCompileCpuTimeMs { get; set; }
    public long ParseAndCompileElapsedTimeMs { get; set; }
    public long ExecutionCpuTimeMs { get; set; }
    public long ExecutionElapsedTimeMs { get; set; }
    public List<TableIoStatistics> TableIo { get; set; } = new();
}

public sealed class ResultSetData
{
    public IReadOnlyList<QueryColumn> Columns { get; set; } = Array.Empty<QueryColumn>();
    public IReadOnlyList<IReadOnlyList<object?>> Rows { get; set; } = Array.Empty<IReadOnlyList<object?>>();
    public bool Truncated { get; set; }
}

public sealed class QueryColumn
{
    public string Name { get; set; } = string.Empty;
    public string TypeName { get; set; } = string.Empty;
    public bool IsIdentity { get; set; }
    public bool IsNullable { get; set; }
}
