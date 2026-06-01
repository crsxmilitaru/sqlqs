namespace Sqlqs.Contracts.Schema;

public sealed class DatabaseInfo
{
    public string Name { get; set; } = string.Empty;
    public bool IsSystem { get; set; }
    public string? State { get; set; }
    public string? RecoveryModel { get; set; }
    public string? CollationName { get; set; }
}
