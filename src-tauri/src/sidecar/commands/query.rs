use tokio_util::sync::CancellationToken;

use crate::sidecar::contracts::query::{ExecuteSqlRequest, ExecuteSqlResponse};
use crate::sidecar::rpc::{JsonRpcClient, RpcError};

pub async fn execute(
    rpc: &JsonRpcClient,
    connection_id: &str,
    sql: &str,
    max_rows: Option<u64>,
) -> Result<ExecuteSqlResponse, RpcError> {
    rpc.call(
        "query.execute",
        &ExecuteSqlRequest {
            connection_id: connection_id.to_string(),
            sql: sql.to_string(),
            max_rows,
            batches: None,
        },
    )
    .await
}

pub async fn execute_cancellable(
    rpc: &JsonRpcClient,
    connection_id: &str,
    sql: &str,
    max_rows: Option<u64>,
    cancel: CancellationToken,
) -> Result<ExecuteSqlResponse, RpcError> {
    rpc.call_with_cancel(
        "query.execute",
        &ExecuteSqlRequest {
            connection_id: connection_id.to_string(),
            sql: sql.to_string(),
            max_rows,
            batches: None,
        },
        cancel,
    )
    .await
}

pub async fn execute_batches_cancellable(
    rpc: &JsonRpcClient,
    connection_id: &str,
    batches: Vec<String>,
    max_rows: Option<u64>,
    cancel: CancellationToken,
) -> Result<ExecuteSqlResponse, RpcError> {
    rpc.call_with_cancel(
        "query.execute",
        &ExecuteSqlRequest {
            connection_id: connection_id.to_string(),
            sql: String::new(),
            max_rows,
            batches: Some(batches),
        },
        cancel,
    )
    .await
}
