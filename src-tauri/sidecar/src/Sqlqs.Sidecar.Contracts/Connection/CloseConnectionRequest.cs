namespace Sqlqs.Contracts.Connection;

public sealed class CloseConnectionRequest
{
    public string ConnectionId { get; set; } = string.Empty;
}
