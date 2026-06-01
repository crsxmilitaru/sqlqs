namespace Sqlqs.Contracts.Schema;

public sealed class ForeignKeyInfo
{
    public string Name { get; set; } = string.Empty;
    public string ParentColumns { get; set; } = string.Empty;
    public string ReferencedSchema { get; set; } = string.Empty;
    public string ReferencedTable { get; set; } = string.Empty;
    public string ReferencedColumns { get; set; } = string.Empty;
}

public sealed class ListForeignKeysRequest
{
    public string ConnectionId { get; set; } = string.Empty;
    public string Database { get; set; } = string.Empty;
    public string Schema { get; set; } = string.Empty;
    public string Table { get; set; } = string.Empty;
}

public sealed class ListForeignKeysResponse
{
    public IReadOnlyList<ForeignKeyInfo> ForeignKeys { get; set; } = Array.Empty<ForeignKeyInfo>();
}
