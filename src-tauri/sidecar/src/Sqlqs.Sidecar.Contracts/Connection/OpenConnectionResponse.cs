namespace Sqlqs.Contracts.Connection;

public sealed class OpenConnectionResponse
{
    public string ConnectionId { get; set; } = string.Empty;
    public string ServerName { get; set; } = string.Empty;
    public string ServerVersion { get; set; } = string.Empty;
    public string? CurrentDatabase { get; set; }
}
