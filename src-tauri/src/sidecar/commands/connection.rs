use crate::sidecar::contracts::connection::{
    ChangeDatabaseRequest, CloseConnectionRequest, OpenConnectionRequest, OpenConnectionResponse,
    SqlConnectionConfig,
};
use crate::sidecar::rpc::{JsonRpcClient, RpcError};
use tokio_util::sync::CancellationToken;

pub async fn open(
    rpc: &JsonRpcClient,
    config: SqlConnectionConfig,
) -> Result<OpenConnectionResponse, RpcError> {
    rpc.call("connection.open", &OpenConnectionRequest { config })
        .await
}

pub async fn open_cancellable(
    rpc: &JsonRpcClient,
    config: SqlConnectionConfig,
    cancel: CancellationToken,
) -> Result<OpenConnectionResponse, RpcError> {
    rpc.call_with_cancel("connection.open", &OpenConnectionRequest { config }, cancel)
        .await
}

pub async fn close(rpc: &JsonRpcClient, connection_id: &str) -> Result<(), RpcError> {
    let _: serde_json::Value = rpc
        .call(
            "connection.close",
            &CloseConnectionRequest {
                connection_id: connection_id.to_string(),
            },
        )
        .await?;
    Ok(())
}

pub async fn change_database(
    rpc: &JsonRpcClient,
    connection_id: &str,
    database: &str,
) -> Result<(), RpcError> {
    let _: serde_json::Value = rpc
        .call(
            "connection.changeDatabase",
            &ChangeDatabaseRequest {
                connection_id: connection_id.to_string(),
                database: database.to_string(),
            },
        )
        .await?;
    Ok(())
}
