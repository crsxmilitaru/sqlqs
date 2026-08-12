use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelQueryRequest {
    pub connection_id: String,
}

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
    #[serde(default)]
    pub base_table_name: Option<String>,
    #[serde(default)]
    pub base_schema_name: Option<String>,
    #[serde(default)]
    pub base_column_name: Option<String>,
    #[serde(default)]
    pub is_expression: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultSetData {
    pub columns: Vec<QueryColumn>,
    pub rows: Vec<Vec<serde_json::Value>>,
    #[serde(default)]
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputItem {
    pub r#type: i32,
    pub result_set_index: Option<usize>,
    pub message: Option<String>,
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
    #[serde(default)]
    pub statistics: Option<QueryStatistics>,
    #[serde(default)]
    pub outputs: Vec<OutputItem>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableIoStatistics {
    pub table_name: String,
    pub scan_count: i64,
    pub logical_reads: i64,
    pub physical_reads: i64,
    pub read_ahead_reads: i64,
    pub lob_logical_reads: i64,
    pub lob_physical_reads: i64,
    pub lob_read_ahead_reads: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryStatistics {
    pub parse_and_compile_cpu_time_ms: u64,
    pub parse_and_compile_elapsed_time_ms: u64,
    pub execution_cpu_time_ms: u64,
    pub execution_elapsed_time_ms: u64,
    pub table_io: Vec<TableIoStatistics>,
}
