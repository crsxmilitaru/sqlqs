use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRequest {
    pub connection_id: String,
    pub database: String,
    pub destination_path: String,
    pub backup_type: String,
    pub overwrite: bool,
    pub copy_only: bool,
    pub compression: bool,
    pub checksum: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResponse {
    pub message: String,
    pub elapsed_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreFileMoveDto {
    pub logical_name: String,
    pub physical_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreRequest {
    pub connection_id: String,
    pub source_path: String,
    pub target_database: String,
    pub replace_existing: bool,
    pub recovery: bool,
    pub restricted_user: bool,
    pub file_moves: Vec<RestoreFileMoveDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupDefaultsRequest {
    pub connection_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupDefaultsResponse {
    #[serde(default)]
    pub backup_directory: Option<String>,
    #[serde(default)]
    pub data_directory: Option<String>,
    #[serde(default)]
    pub log_directory: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectBackupRequest {
    pub connection_id: String,
    pub source_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFileInfoDto {
    pub logical_name: String,
    pub physical_name: String,
    pub file_type: String,
    pub size_bytes: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectBackupResponse {
    pub files: Vec<BackupFileInfoDto>,
}
