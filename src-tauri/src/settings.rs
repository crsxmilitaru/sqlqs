use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::db::ConnectionConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedConnection {
    pub name: String,
    pub config: ConnectionConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppSettings {
    pub connections: Vec<SavedConnection>,
    pub last_connection: Option<String>,
    pub keep_logged_in: bool,
}

const KEYRING_SERVICE: &str = "sqlqs";

fn settings_path() -> PathBuf {
    let dir = dirs_next()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("sqlqs");
    fs::create_dir_all(&dir).ok();
    dir.join("settings.json")
}

fn dirs_next() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA").ok().map(PathBuf::from)
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME")
            .ok()
            .map(|h| PathBuf::from(h).join("Library/Application Support"))
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var("XDG_CONFIG_HOME")
            .ok()
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var("HOME")
                    .ok()
                    .map(|h| PathBuf::from(h).join(".config"))
            })
    }
}

pub fn load_settings() -> AppSettings {
    let path = settings_path();
    if path.exists() {
        let data = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        AppSettings::default()
    }
}

pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let path = settings_path();
    let data =
        serde_json::to_string_pretty(settings).map_err(|e| format!("Serialize error: {}", e))?;
    fs::write(&path, data).map_err(|e| format!("Write error: {}", e))
}

pub fn store_password(connection_name: &str, password: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, connection_name)
        .map_err(|e| format!("Keyring error: {}", e))?;
    entry
        .set_password(password)
        .map_err(|e| format!("Failed to store password: {}", e))
}

pub fn load_password(connection_name: &str) -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, connection_name).ok()?;
    entry.get_password().ok()
}
