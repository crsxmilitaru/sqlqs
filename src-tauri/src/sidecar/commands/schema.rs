use crate::sidecar::contracts::schema::*;
use crate::sidecar::rpc::{JsonRpcClient, RpcError};

pub async fn list_databases(
    rpc: &JsonRpcClient,
    connection_id: &str,
) -> Result<ListDatabasesResponse, RpcError> {
    rpc.call(
        "schema.listDatabases",
        &ListDatabasesRequest {
            connection_id: connection_id.to_string(),
        },
    )
    .await
}

pub async fn list_tables(
    rpc: &JsonRpcClient,
    connection_id: &str,
    database: &str,
) -> Result<ListTablesResponse, RpcError> {
    rpc.call(
        "schema.listTables",
        &ListTablesRequest {
            connection_id: connection_id.to_string(),
            database: database.to_string(),
        },
    )
    .await
}

pub async fn list_columns(
    rpc: &JsonRpcClient,
    connection_id: &str,
    database: &str,
    schema: &str,
    table: &str,
) -> Result<ListColumnsResponse, RpcError> {
    rpc.call(
        "schema.listColumns",
        &ListColumnsRequest {
            connection_id: connection_id.to_string(),
            database: database.to_string(),
            schema: schema.to_string(),
            table: table.to_string(),
        },
    )
    .await
}

pub async fn list_indexes(
    rpc: &JsonRpcClient,
    connection_id: &str,
    database: &str,
    schema: &str,
    table: &str,
) -> Result<ListIndexesResponse, RpcError> {
    rpc.call(
        "schema.listIndexes",
        &ListIndexesRequest {
            connection_id: connection_id.to_string(),
            database: database.to_string(),
            schema: schema.to_string(),
            table: table.to_string(),
        },
    )
    .await
}

pub async fn list_foreign_keys(
    rpc: &JsonRpcClient,
    connection_id: &str,
    database: &str,
    schema: &str,
    table: &str,
) -> Result<ListForeignKeysResponse, RpcError> {
    rpc.call(
        "schema.listForeignKeys",
        &ListForeignKeysRequest {
            connection_id: connection_id.to_string(),
            database: database.to_string(),
            schema: schema.to_string(),
            table: table.to_string(),
        },
    )
    .await
}

pub async fn list_schema_catalog(
    rpc: &JsonRpcClient,
    connection_id: &str,
    database: &str,
) -> Result<ListSchemaCatalogResponse, RpcError> {
    rpc.call(
        "schema.listSchemaCatalog",
        &ListSchemaCatalogRequest {
            connection_id: connection_id.to_string(),
            database: database.to_string(),
        },
    )
    .await
}
