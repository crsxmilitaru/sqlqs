use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScriptOptions {
    pub include_headers: bool,
    pub include_indexes: bool,
    pub include_foreign_keys: bool,
    pub include_triggers: bool,
    pub include_check_constraints: bool,
    pub include_defaults: bool,
    pub include_permissions: bool,
    pub include_if_not_exists: bool,
    pub script_drops: bool,
}

impl ScriptOptions {
    pub fn ssms_defaults() -> Self {
        Self {
            include_headers: true,
            include_indexes: true,
            include_foreign_keys: true,
            include_triggers: true,
            include_check_constraints: true,
            include_defaults: true,
            include_permissions: false,
            include_if_not_exists: false,
            script_drops: false,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptObjectRequest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    pub name: String,
    pub object_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<ScriptOptions>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptObjectResponse {
    pub script: String,
}
