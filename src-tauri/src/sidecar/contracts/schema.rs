use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDatabasesRequest {
    pub connection_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub name: String,
    pub is_system: bool,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub recovery_model: Option<String>,
    #[serde(default)]
    pub collation_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDatabasesResponse {
    pub databases: Vec<DatabaseInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTablesRequest {
    pub connection_id: String,
    pub database: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseObject {
    pub schema_name: String,
    pub name: String,
    pub object_type: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTablesResponse {
    pub objects: Vec<DatabaseObject>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListColumnsRequest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    pub table: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub type_name: String,
    pub is_identity: bool,
    pub is_nullable: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListColumnsResponse {
    pub columns: Vec<ColumnInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListIndexesRequest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    pub table: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub name: String,
    pub type_description: String,
    pub is_unique: bool,
    pub is_primary_key: bool,
    pub columns: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListIndexesResponse {
    pub indexes: Vec<IndexInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListForeignKeysRequest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    pub table: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyInfo {
    pub name: String,
    pub parent_columns: String,
    pub referenced_schema: String,
    pub referenced_table: String,
    pub referenced_columns: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListForeignKeysResponse {
    pub foreign_keys: Vec<ForeignKeyInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSchemaCatalogRequest {
    pub connection_id: String,
    pub database: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaCatalogColumn {
    pub name: String,
    pub type_name: String,
    pub is_nullable: bool,
    pub is_identity: bool,
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaCatalogParameter {
    pub name: String,
    pub type_name: String,
    pub is_output: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaCatalogEntry {
    pub schema_name: String,
    pub object_name: String,
    pub object_kind: String,
    pub columns: Vec<SchemaCatalogColumn>,
    pub parameters: Vec<SchemaCatalogParameter>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSchemaCatalogResponse {
    pub entries: Vec<SchemaCatalogEntry>,
}
