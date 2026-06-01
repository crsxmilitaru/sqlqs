namespace Sqlqs.Contracts.Schema;

public sealed class ColumnInfo
{
    public string Name { get; set; } = string.Empty;
    public string TypeName { get; set; } = string.Empty;
    public bool IsIdentity { get; set; }
    public bool IsNullable { get; set; }
}

public sealed class ListColumnsRequest
{
    public string ConnectionId { get; set; } = string.Empty;
    public string Database { get; set; } = string.Empty;
    public string Schema { get; set; } = string.Empty;
    public string Table { get; set; } = string.Empty;
}

public sealed class ListColumnsResponse
{
    public IReadOnlyList<ColumnInfo> Columns { get; set; } = Array.Empty<ColumnInfo>();
}
