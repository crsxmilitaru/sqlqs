using StreamJsonRpc;
using Sqlqs.Contracts.Backup;
using Sqlqs.Sidecar.Smo;

namespace Sqlqs.Sidecar.Host.Rpc;

internal sealed class BackupRpc
{
    private readonly BackupService _backups;

    public BackupRpc(BackupService backups)
    {
        _backups = backups;
    }

    [JsonRpcMethod("backup.run", UseSingleObjectParameterDeserialization = true)]
    public Task<BackupResponse> RunAsync(BackupRequest request, CancellationToken cancellationToken)
    {
        return _backups.BackupAsync(request, cancellationToken);
    }

    [JsonRpcMethod("backup.restore", UseSingleObjectParameterDeserialization = true)]
    public Task<BackupResponse> RestoreAsync(RestoreRequest request, CancellationToken cancellationToken)
    {
        return _backups.RestoreAsync(request, cancellationToken);
    }

    [JsonRpcMethod("backup.defaults", UseSingleObjectParameterDeserialization = true)]
    public Task<BackupDefaultsResponse> DefaultsAsync(BackupDefaultsRequest request, CancellationToken cancellationToken)
    {
        return _backups.GetDefaultsAsync(request, cancellationToken);
    }

    [JsonRpcMethod("backup.inspect", UseSingleObjectParameterDeserialization = true)]
    public Task<InspectBackupResponse> InspectAsync(InspectBackupRequest request, CancellationToken cancellationToken)
    {
        return _backups.InspectAsync(request, cancellationToken);
    }
}
