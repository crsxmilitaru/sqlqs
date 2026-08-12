namespace Sqlqs.Contracts.Query;

public sealed class CancelQueryRequest
{
    public string ConnectionId { get; set; } = string.Empty;
}
