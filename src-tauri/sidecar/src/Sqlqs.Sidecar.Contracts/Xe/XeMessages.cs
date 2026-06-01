namespace Sqlqs.Contracts.Xe;

public sealed class StartXeSessionRequest
{
    public string ConnectionId { get; set; } = string.Empty;
    public string SessionName { get; set; } = string.Empty;
    public IReadOnlyList<string>? Events { get; set; }
    public int MaxMemoryKb { get; set; } = 4096;
    public int MaxEventsRetained { get; set; } = 1000;
}

public sealed class StartXeSessionResponse
{
    public string SessionName { get; set; } = string.Empty;
    public IReadOnlyList<string> Events { get; set; } = Array.Empty<string>();
}

public sealed class StopXeSessionRequest
{
    public string ConnectionId { get; set; } = string.Empty;
    public string SessionName { get; set; } = string.Empty;
    public bool Drop { get; set; } = true;
}

public sealed class ReadXeSessionRequest
{
    public string ConnectionId { get; set; } = string.Empty;
    public string SessionName { get; set; } = string.Empty;
}

public sealed class XeEventDto
{
    public string Name { get; set; } = string.Empty;
    public string TimestampUtc { get; set; } = string.Empty;
    public IReadOnlyDictionary<string, string> Fields { get; set; } = new Dictionary<string, string>();
}

public sealed class ReadXeSessionResponse
{
    public IReadOnlyList<XeEventDto> Events { get; set; } = Array.Empty<XeEventDto>();
    public int DroppedEventCount { get; set; }
}
