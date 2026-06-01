namespace Sqlqs.Contracts.Query;

public sealed class ExecuteSqlResponse
{
    public IReadOnlyList<ResultSetData> ResultSets { get; set; } = Array.Empty<ResultSetData>();
    public long RowsAffected { get; set; }
    public IReadOnlyList<string> Messages { get; set; } = Array.Empty<string>();
    public long ElapsedMs { get; set; }
    public long? RowLimitApplied { get; set; }
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
