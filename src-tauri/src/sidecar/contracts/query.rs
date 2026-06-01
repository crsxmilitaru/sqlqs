use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteSqlRequest {
    pub connection_id: String,
    pub sql: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_rows: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub batches: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryColumn {
    pub name: String,
    pub type_name: String,
    pub is_identity: bool,
    pub is_nullable: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultSetData {
    pub columns: Vec<QueryColumn>,
    pub rows: Vec<Vec<serde_json::Value>>,
    #[serde(default)]
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteSqlResponse {
    #[serde(default)]
    pub result_sets: Vec<ResultSetData>,
    #[serde(default)]
    pub rows_affected: u64,
    #[serde(default)]
    pub messages: Vec<String>,
    #[serde(default)]
    pub elapsed_ms: u64,
    #[serde(default)]
    pub row_limit_applied: Option<u64>,
}
