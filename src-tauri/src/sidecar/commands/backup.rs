use crate::sidecar::contracts::backup::*;
use crate::sidecar::rpc::{JsonRpcClient, RpcError};

pub async fn run(rpc: &JsonRpcClient, request: BackupRequest) -> Result<BackupResponse, RpcError> {
    rpc.call("backup.run", &request).await
}

pub async fn restore(
    rpc: &JsonRpcClient,
    request: RestoreRequest,
) -> Result<BackupResponse, RpcError> {
    rpc.call("backup.restore", &request).await
}

pub async fn defaults(
    rpc: &JsonRpcClient,
    connection_id: &str,
) -> Result<BackupDefaultsResponse, RpcError> {
    rpc.call(
        "backup.defaults",
        &BackupDefaultsRequest {
            connection_id: connection_id.to_string(),
        },
    )
    .await
}

pub async fn inspect(
    rpc: &JsonRpcClient,
    connection_id: &str,
    source_path: &str,
) -> Result<InspectBackupResponse, RpcError> {
    rpc.call(
        "backup.inspect",
        &InspectBackupRequest {
            connection_id: connection_id.to_string(),
            source_path: source_path.to_string(),
        },
    )
    .await
}
