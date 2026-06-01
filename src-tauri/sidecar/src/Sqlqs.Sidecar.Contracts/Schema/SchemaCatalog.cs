namespace Sqlqs.Contracts.Schema;

public sealed class SchemaCatalogEntry
{
    public string SchemaName { get; set; } = string.Empty;
    public string TableName { get; set; } = string.Empty;
    public IReadOnlyList<string> Columns { get; set; } = Array.Empty<string>();
}

public sealed class ListSchemaCatalogRequest
{
    public string ConnectionId { get; set; } = string.Empty;
    public string Database { get; set; } = string.Empty;
}

public sealed class ListSchemaCatalogResponse
{
    public IReadOnlyList<SchemaCatalogEntry> Entries { get; set; } = Array.Empty<SchemaCatalogEntry>();
}
