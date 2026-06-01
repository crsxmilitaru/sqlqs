namespace Sqlqs.Contracts.Connection;

public sealed class OpenConnectionRequest
{
    public SqlConnectionConfig Config { get; set; } = new();
}
