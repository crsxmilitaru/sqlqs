namespace Sqlqs.Contracts.Schema;

public sealed class SchemaCatalogColumn
{
    public string Name { get; set; } = string.Empty;
    public string TypeName { get; set; } = string.Empty;
    public bool IsNullable { get; set; }
    public bool IsIdentity { get; set; }
    public bool IsPrimaryKey { get; set; }
}

public sealed class SchemaCatalogParameter
{
    public string Name { get; set; } = string.Empty;
    public string TypeName { get; set; } = string.Empty;
    public bool IsOutput { get; set; }
}

public sealed class SchemaCatalogEntry
{
    public string SchemaName { get; set; } = string.Empty;
    public string ObjectName { get; set; } = string.Empty;
    public string ObjectKind { get; set; } = string.Empty;
    public IReadOnlyList<SchemaCatalogColumn> Columns { get; set; } = Array.Empty<SchemaCatalogColumn>();
    public IReadOnlyList<SchemaCatalogParameter> Parameters { get; set; } = Array.Empty<SchemaCatalogParameter>();
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
