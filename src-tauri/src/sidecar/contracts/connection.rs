use serde::{Deserialize, Serialize};

use crate::db::ConnectionConfig as DbConnectionConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlConnectionConfig {
    pub server: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    pub use_windows_auth: bool,
    pub encrypt: bool,
    pub trust_server_certificate: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_string: Option<String>,
}

impl From<&DbConnectionConfig> for SqlConnectionConfig {
    fn from(value: &DbConnectionConfig) -> Self {
        Self {
            server: value.server.clone(),
            port: value.port,
            database: value.database.clone(),
            username: value.username.clone(),
            password: value.password.clone(),
            use_windows_auth: value.use_windows_auth,
            encrypt: value.encrypt,
            trust_server_certificate: value.trust_server_certificate,
            connection_string: value.connection_string.clone(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenConnectionRequest {
    pub config: SqlConnectionConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenConnectionResponse {
    pub connection_id: String,
    pub server_name: String,
    pub server_version: String,
    #[serde(default)]
    pub current_database: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseConnectionRequest {
    pub connection_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeDatabaseRequest {
    pub connection_id: String,
    pub database: String,
}
