use crate::sidecar::contracts::scripting::{
    ScriptObjectRequest, ScriptObjectResponse, ScriptOptions,
};
use crate::sidecar::rpc::{JsonRpcClient, RpcError};

pub async fn script_object(
    rpc: &JsonRpcClient,
    connection_id: &str,
    database: &str,
    schema: &str,
    name: &str,
    object_type: &str,
    options: Option<ScriptOptions>,
) -> Result<ScriptObjectResponse, RpcError> {
    rpc.call(
        "scripting.scriptObject",
        &ScriptObjectRequest {
            connection_id: connection_id.to_string(),
            database: database.to_string(),
            schema: schema.to_string(),
            name: name.to_string(),
            object_type: object_type.to_string(),
            options,
        },
    )
    .await
}
