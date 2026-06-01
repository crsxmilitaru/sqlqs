namespace Sqlqs.Contracts.Scripting;

public sealed class ScriptObjectRequest
{
    public string ConnectionId { get; set; } = string.Empty;
    public string Database { get; set; } = string.Empty;
    public string Schema { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string ObjectType { get; set; } = string.Empty;
    public ScriptOptionsDto? Options { get; set; }
}

public sealed class ScriptOptionsDto
{
    public bool IncludeHeaders { get; set; } = true;
    public bool IncludeIndexes { get; set; } = true;
    public bool IncludeForeignKeys { get; set; } = true;
    public bool IncludeTriggers { get; set; } = true;
    public bool IncludeCheckConstraints { get; set; } = true;
    public bool IncludeDefaults { get; set; } = true;
    public bool IncludePermissions { get; set; }
    public bool IncludeIfNotExists { get; set; }
    public bool ScriptDrops { get; set; }
}

public sealed class ScriptObjectResponse
{
    public string Script { get; set; } = string.Empty;
}
