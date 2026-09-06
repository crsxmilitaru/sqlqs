namespace Sqlqs.Contracts.Backup;

public sealed class BackupRequest
{
    public string ConnectionId { get; set; } = string.Empty;
    public string Database { get; set; } = string.Empty;
    public string DestinationPath { get; set; } = string.Empty;
    public string BackupType { get; set; } = "FULL";
    public bool Overwrite { get; set; }
    public bool CopyOnly { get; set; }
    public bool Compression { get; set; }
    public bool Checksum { get; set; }
}

public sealed class BackupResponse
{
    public string Message { get; set; } = string.Empty;
    public long ElapsedMs { get; set; }
}

public sealed class RestoreFileMoveDto
{
    public string LogicalName { get; set; } = string.Empty;
    public string PhysicalName { get; set; } = string.Empty;
}

public sealed class RestoreRequest
{
    public string ConnectionId { get; set; } = string.Empty;
    public string SourcePath { get; set; } = string.Empty;
    public string TargetDatabase { get; set; } = string.Empty;
    public bool ReplaceExisting { get; set; }
    public bool Recovery { get; set; } = true;
    public bool RestrictedUser { get; set; }
    public IReadOnlyList<RestoreFileMoveDto> FileMoves { get; set; } = Array.Empty<RestoreFileMoveDto>();
}

public sealed class BackupDefaultsRequest
{
    public string ConnectionId { get; set; } = string.Empty;
}

public sealed class BackupDefaultsResponse
{
    public string? BackupDirectory { get; set; }
    public string? DataDirectory { get; set; }
    public string? LogDirectory { get; set; }
}

public sealed class InspectBackupRequest
{
    public string ConnectionId { get; set; } = string.Empty;
    public string SourcePath { get; set; } = string.Empty;
}

public sealed class BackupFileInfoDto
{
    public string LogicalName { get; set; } = string.Empty;
    public string PhysicalName { get; set; } = string.Empty;
    public string FileType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
}

public sealed class InspectBackupResponse
{
    public IReadOnlyList<BackupFileInfoDto> Files { get; set; } = Array.Empty<BackupFileInfoDto>();
}
