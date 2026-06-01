namespace Sqlqs.Contracts.Health;

public sealed class PingResponse
{
    public string SidecarVersion { get; set; } = string.Empty;
    public int ProtocolVersion { get; set; }
    public string RuntimeDescription { get; set; } = string.Empty;
    public long ProcessId { get; set; }
    public long UptimeMilliseconds { get; set; }
}
