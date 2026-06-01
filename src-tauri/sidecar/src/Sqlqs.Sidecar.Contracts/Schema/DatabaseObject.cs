namespace Sqlqs.Contracts.Schema;

public sealed class DatabaseObject
{
    public string SchemaName { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string ObjectType { get; set; } = string.Empty;
}

public sealed class ListTablesRequest
{
    public string ConnectionId { get; set; } = string.Empty;
    public string Database { get; set; } = string.Empty;
}

public sealed class ListTablesResponse
{
    public IReadOnlyList<DatabaseObject> Objects { get; set; } = Array.Empty<DatabaseObject>();
}
