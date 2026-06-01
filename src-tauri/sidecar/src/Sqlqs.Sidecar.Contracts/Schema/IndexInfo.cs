namespace Sqlqs.Contracts.Schema;

public sealed class IndexInfo
{
    public string Name { get; set; } = string.Empty;
    public string TypeDescription { get; set; } = string.Empty;
    public bool IsUnique { get; set; }
    public bool IsPrimaryKey { get; set; }
    public string Columns { get; set; } = string.Empty;
}

public sealed class ListIndexesRequest
{
    public string ConnectionId { get; set; } = string.Empty;
    public string Database { get; set; } = string.Empty;
    public string Schema { get; set; } = string.Empty;
    public string Table { get; set; } = string.Empty;
}

public sealed class ListIndexesResponse
{
    public IReadOnlyList<IndexInfo> Indexes { get; set; } = Array.Empty<IndexInfo>();
}
