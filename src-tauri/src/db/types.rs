use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ConnectionConfig {
    pub server: String,
    pub port: Option<u16>,
    pub database: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub use_windows_auth: bool,
    pub encrypt: bool,
    pub trust_server_certificate: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_string: Option<String>,
}

impl std::fmt::Debug for ConnectionConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConnectionConfig")
            .field("server", &self.server)
            .field("port", &self.port)
            .field("database", &self.database)
            .field("username", &self.username)
            .field("password", &self.password.as_ref().map(|_| "[REDACTED]"))
            .field("use_windows_auth", &self.use_windows_auth)
            .field("encrypt", &self.encrypt)
            .field("trust_server_certificate", &self.trust_server_certificate)
            .finish()
    }
}

impl Default for ConnectionConfig {
    fn default() -> Self {
        Self {
            server: String::new(),
            port: None,
            database: None,
            username: None,
            password: None,
            use_windows_auth: false,
            encrypt: false,
            trust_server_certificate: true,
            connection_string: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub result_sets: Vec<ResultSet>,
    pub rows_affected: u64,
    pub messages: Vec<String>,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResultSet {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub type_name: String,
    pub is_identity: bool,
    pub is_nullable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseObject {
    pub name: String,
    pub schema_name: String,
    pub object_type: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BackupDatabaseRequest {
    pub database: String,
    pub destination_path: String,
    pub backup_type: String,
    pub overwrite: bool,
    pub copy_only: bool,
    pub compression: bool,
    pub checksum: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupOperationResult {
    pub message: String,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupDefaults {
    pub backup_directory: Option<String>,
    pub data_directory: Option<String>,
    pub log_directory: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupFileInfo {
    pub logical_name: String,
    pub physical_name: String,
    pub file_type: String,
    pub size_bytes: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RestoreFileMove {
    pub logical_name: String,
    pub physical_name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RestoreDatabaseRequest {
    pub source_path: String,
    pub target_database: String,
    pub replace_existing: bool,
    pub recovery: bool,
    pub restricted_user: bool,
    pub file_moves: Vec<RestoreFileMove>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BackupScheduleRequest {
    pub job_name: String,
    pub database: String,
    pub destination_folder: String,
    pub backup_type: String,
    pub frequency: String,
    pub time: String,
    pub weekly_days: Vec<i32>,
    pub monthly_day: Option<i32>,
    pub copy_only: bool,
    pub compression: bool,
    pub checksum: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupScheduleInfo {
    pub job_id: String,
    pub job_name: String,
    pub enabled: bool,
    pub schedule_name: Option<String>,
    pub next_run: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DatabaseSchemaCatalogEntry {
    pub table_name: String,
    pub schema_name: String,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerDatabaseObject {
    pub database: String,
    pub name: String,
    pub schema_name: String,
    pub object_type: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ServerObjectIndexStatus {
    pub initialized: bool,
    pub indexing: bool,
    pub database_count: usize,
    pub processed_database_count: usize,
    pub failed_databases: Vec<String>,
    pub object_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerObjectSearchResponse {
    pub results: Vec<ServerDatabaseObject>,
    pub total_matches: usize,
    pub initialized: bool,
    pub indexing: bool,
    pub database_count: usize,
    pub processed_database_count: usize,
    pub failed_databases: Vec<String>,
}
