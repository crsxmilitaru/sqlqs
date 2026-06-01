use crate::sidecar::contracts::xe::*;
use crate::sidecar::rpc::{JsonRpcClient, RpcError};

pub async fn start_session(
    rpc: &JsonRpcClient,
    request: StartXeSessionRequest,
) -> Result<StartXeSessionResponse, RpcError> {
    rpc.call("xe.startSession", &request).await
}

pub async fn stop_session(
    rpc: &JsonRpcClient,
    request: StopXeSessionRequest,
) -> Result<(), RpcError> {
    let _: serde_json::Value = rpc.call("xe.stopSession", &request).await?;
    Ok(())
}

pub async fn read_session(
    rpc: &JsonRpcClient,
    connection_id: &str,
    session_name: &str,
) -> Result<ReadXeSessionResponse, RpcError> {
    rpc.call(
        "xe.readSession",
        &ReadXeSessionRequest {
            connection_id: connection_id.to_string(),
            session_name: session_name.to_string(),
        },
    )
    .await
}
