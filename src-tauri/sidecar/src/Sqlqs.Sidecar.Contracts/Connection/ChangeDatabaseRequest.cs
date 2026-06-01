namespace Sqlqs.Contracts.Connection;

public sealed class ChangeDatabaseRequest
{
    public string ConnectionId { get; set; } = string.Empty;
    public string Database { get; set; } = string.Empty;
}
