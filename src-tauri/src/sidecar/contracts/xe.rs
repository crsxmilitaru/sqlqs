use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartXeSessionRequest {
    pub connection_id: String,
    pub session_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub events: Option<Vec<String>>,
    pub max_memory_kb: i32,
    pub max_events_retained: i32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartXeSessionResponse {
    pub session_name: String,
    pub events: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StopXeSessionRequest {
    pub connection_id: String,
    pub session_name: String,
    pub drop: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadXeSessionRequest {
    pub connection_id: String,
    pub session_name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XeEventDto {
    pub name: String,
    pub timestamp_utc: String,
    pub fields: HashMap<String, String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadXeSessionResponse {
    pub events: Vec<XeEventDto>,
    pub dropped_event_count: i32,
}
