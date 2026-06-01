namespace Sqlqs.Contracts.Connection;

public sealed class SqlConnectionConfig
{
    public string Server { get; set; } = string.Empty;
    public int? Port { get; set; }
    public string? Database { get; set; }
    public string? Username { get; set; }
    public string? Password { get; set; }
    public bool UseWindowsAuth { get; set; }
    public bool Encrypt { get; set; }
    public bool TrustServerCertificate { get; set; } = true;
    public string? ConnectionString { get; set; }
}
