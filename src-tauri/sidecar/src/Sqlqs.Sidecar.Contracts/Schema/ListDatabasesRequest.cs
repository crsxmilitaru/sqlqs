namespace Sqlqs.Contracts.Schema;

public sealed class ListDatabasesRequest
{
    public string ConnectionId { get; set; } = string.Empty;
}
