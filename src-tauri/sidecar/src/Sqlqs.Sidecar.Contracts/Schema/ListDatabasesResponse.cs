namespace Sqlqs.Contracts.Schema;

public sealed class ListDatabasesResponse
{
    public IReadOnlyList<DatabaseInfo> Databases { get; set; } = Array.Empty<DatabaseInfo>();
}
