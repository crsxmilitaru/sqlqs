mod backup_schedules;
mod conn_string;
mod db;
mod settings;
pub mod sidecar;
mod sql_gen;

use db::{
    BackupDatabaseRequest, BackupDefaults, BackupFileInfo, BackupOperationResult,
    BackupScheduleInfo, BackupScheduleRequest, CachedServerObjectIndex, ColumnInfo,
    ConnectionConfig, DatabaseObject, DatabaseSchemaCatalogEntry, QueryResult,
    RestoreDatabaseRequest, ServerObjectIndexStatus, ServerObjectSearchResponse,
};
use serde::{Deserialize, Serialize};
use settings::{AppSettings, SavedConnection};
use sidecar::{PingResponse, SidecarHandle, SidecarSupervisor};
use std::path::{Path, PathBuf};
use std::sync::Arc;
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "ios"))]
use tauri::Emitter;
use tauri::Manager;
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::{Mutex, RwLock};
use tokio_util::sync::CancellationToken;
use url::Url;

#[allow(dead_code)]
const SQL_FILE_OPENED_EVENT: &str = "sql-file-opened";
const STABLE_UPDATE_ENDPOINT: &str =
    "https://github.com/crsxmilitaru/sqlqs/releases/latest/download/latest.json";
const GITHUB_RELEASES_ENDPOINT: &str =
    "https://api.github.com/repos/crsxmilitaru/sqlqs/releases?per_page=100";
const GITHUB_TAG_REF_ENDPOINT: &str =
    "https://api.github.com/repos/crsxmilitaru/sqlqs/git/ref/tags/";

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    prerelease: bool,
    draft: bool,
    target_commitish: Option<String>,
}

#[derive(Deserialize)]
struct GitHubRefObject {
    sha: String,
    #[serde(rename = "type")]
    kind: String,
    url: Option<String>,
}

#[derive(Deserialize)]
struct GitHubRef {
    object: GitHubRefObject,
}

#[derive(Deserialize)]
struct GitHubTag {
    object: GitHubRefObject,
}

struct PreviewUpdateEndpoint {
    url: String,
    build_commit: Option<String>,
}

fn is_sql_path(path: &Path) -> bool {
    !path.is_dir()
}

struct CancelSlot {
    token: Option<CancellationToken>,
    generation: u64,
}

struct AppState {
    active_connection: Arc<Mutex<Option<ActiveConnection>>>,
    cancel_token: Arc<Mutex<CancelSlot>>,
    cancel_generation: std::sync::atomic::AtomicU64,
    server_object_index: Arc<Mutex<CachedServerObjectIndex>>,
    server_object_index_token: Arc<Mutex<Option<CancellationToken>>>,
    sidecar: Arc<RwLock<Option<Arc<SidecarHandle>>>>,
    sidecar_connection_id: Arc<Mutex<Option<String>>>,
    last_sidecar_error: Arc<Mutex<Option<String>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateMetadata {
    rid: tauri::ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

fn parse_preview_tag(tag: &str) -> Option<(u64, u64, u64, u64, u64)> {
    let version = tag.strip_prefix('v').unwrap_or(tag);
    let (base, preview_suffix) = version.split_once("-preview")?;
    if !preview_suffix.is_empty() && !preview_suffix.starts_with('.') {
        return None;
    }

    let (preview_build, preview_attempt) = if preview_suffix.is_empty() {
        (0, 0)
    } else {
        let mut parts = preview_suffix.trim_start_matches('.').split('.');
        let build = parts.next()?.parse().ok()?;
        let attempt = parts.next().map_or(Some(0), |part| part.parse().ok())?;
        if parts.next().is_some() {
            return None;
        }
        (build, attempt)
    };

    let mut parts = base.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch, preview_build, preview_attempt))
}

fn current_build_commit() -> Option<&'static str> {
    option_env!("SQLQS_BUILD_COMMIT").filter(|commit| !commit.trim().is_empty())
}

fn looks_like_commit(value: &str) -> bool {
    let value = value.trim();
    (7..=40).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn commits_match(current: &str, latest: &str) -> bool {
    let current = current.trim().to_ascii_lowercase();
    let latest = latest.trim().to_ascii_lowercase();

    if current.is_empty() || latest.is_empty() {
        return false;
    }

    current == latest
        || (current.len() >= 7 && latest.starts_with(&current))
        || (latest.len() >= 7 && current.starts_with(&latest))
}

async fn resolve_preview_tag_commit(client: &reqwest::Client, tag: &str) -> Option<String> {
    let release_ref = client
        .get(format!("{GITHUB_TAG_REF_ENDPOINT}{tag}"))
        .header(reqwest::header::USER_AGENT, "SQL Query Studio")
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<GitHubRef>()
        .await
        .ok()?;

    if release_ref.object.kind == "commit" && looks_like_commit(&release_ref.object.sha) {
        return Some(release_ref.object.sha);
    }

    if release_ref.object.kind != "tag" {
        return None;
    }

    let tag_url = release_ref.object.url?;
    let tag = client
        .get(tag_url)
        .header(reqwest::header::USER_AGENT, "SQL Query Studio")
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<GitHubTag>()
        .await
        .ok()?;

    if tag.object.kind == "commit" && looks_like_commit(&tag.object.sha) {
        Some(tag.object.sha)
    } else {
        None
    }
}

async fn latest_preview_update_endpoint() -> Result<PreviewUpdateEndpoint, String> {
    let client = reqwest::Client::new();
    let releases = client
        .get(GITHUB_RELEASES_ENDPOINT)
        .header(reqwest::header::USER_AGENT, "SQL Query Studio")
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|err| format!("Could not fetch preview releases: {err}"))?
        .error_for_status()
        .map_err(|err| format!("Could not fetch preview releases: {err}"))?
        .json::<Vec<GitHubRelease>>()
        .await
        .map_err(|err| format!("Could not read preview releases: {err}"))?;

    let latest_release = releases
        .into_iter()
        .filter(|release| release.prerelease && !release.draft)
        .filter_map(|release| {
            parse_preview_tag(&release.tag_name).map(|version| (version, release))
        })
        .max_by_key(|(version, _)| *version)
        .map(|(_, release)| release)
        .ok_or_else(|| "No published preview release metadata found yet.".to_string())?;

    let build_commit = resolve_preview_tag_commit(&client, &latest_release.tag_name)
        .await
        .or_else(|| {
            latest_release
                .target_commitish
                .filter(|commit| looks_like_commit(commit))
        });

    Ok(PreviewUpdateEndpoint {
        url: format!(
            "https://github.com/crsxmilitaru/sqlqs/releases/download/{}/latest.json",
            latest_release.tag_name
        ),
        build_commit,
    })
}

#[tauri::command]
async fn check_update_channel<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    channel: String,
) -> Result<Option<UpdateMetadata>, String> {
    let preview_build_commit;
    let endpoint = match channel.as_str() {
        "stable" => {
            preview_build_commit = None;
            STABLE_UPDATE_ENDPOINT.to_string()
        }
        "preview" => {
            let preview_endpoint = latest_preview_update_endpoint().await?;
            preview_build_commit = preview_endpoint.build_commit;
            preview_endpoint.url
        }
        other => return Err(format!("Unknown update channel: {other}")),
    };

    let endpoint = Url::parse(&endpoint).map_err(|err| err.to_string())?;
    let mut builder = webview
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|err| err.to_string())?;

    if channel == "preview" {
        let current_build_commit = current_build_commit().map(ToOwned::to_owned);
        builder = builder.version_comparator(move |current, update| {
            if update.version != current {
                return true;
            }

            match (
                current_build_commit.as_deref(),
                preview_build_commit.as_deref(),
            ) {
                (None, Some(_)) => true,
                (Some(current), Some(latest)) => !commits_match(current, latest),
                _ => false,
            }
        });
    }

    let updater = builder.build().map_err(|err| err.to_string())?;
    let update = updater.check().await.map_err(|err| err.to_string())?;

    if let Some(update) = update {
        let metadata = UpdateMetadata {
            current_version: update.current_version.clone(),
            version: update.version.clone(),
            date: update.date.map(|date| date.to_string()),
            body: update.body.clone(),
            raw_json: update.raw_json.clone(),
            rid: webview.resources_table().add(update),
        };
        Ok(Some(metadata))
    } else {
        Ok(None)
    }
}

/// Returns a running sidecar handle, lazily spawning (or respawning) the
/// sidecar process if it has never started or has since crashed. Spawning is
/// serialized behind the write lock so concurrent callers can't start duplicate
/// processes.
async fn spawn_or_reuse_sidecar(
    sidecar: &Arc<RwLock<Option<Arc<SidecarHandle>>>>,
    connection_id: &Arc<Mutex<Option<String>>>,
    last_error: &Arc<Mutex<Option<String>>>,
) -> Result<Arc<SidecarHandle>, String> {
    // Fast path: an existing, still-running sidecar.
    {
        let guard = sidecar.read().await;
        if let Some(handle) = guard.as_ref() {
            if handle.is_alive().await {
                return Ok(Arc::clone(handle));
            }
        }
    }

    let mut guard = sidecar.write().await;
    // Re-check under the write lock in case another caller just spawned one.
    if let Some(handle) = guard.as_ref() {
        if handle.is_alive().await {
            return Ok(Arc::clone(handle));
        }
    }

    // A previously-spawned sidecar has died: drop it and invalidate the stale
    // connection id so the app knows it must reconnect.
    if guard.take().is_some() {
        *connection_id.lock().await = None;
    }

    match SidecarSupervisor::spawn().await {
        Ok(handle) => {
            let handle = Arc::new(handle);
            *guard = Some(Arc::clone(&handle));
            *last_error.lock().await = None;
            eprintln!("[sidecar] spawned at {}", handle.binary_path().display());
            Ok(handle)
        }
        Err(err) => {
            let message = format!("Failed to start the SQL engine (sidecar): {err}");
            *last_error.lock().await = Some(message.clone());
            eprintln!("[sidecar] {message}");
            Err(message)
        }
    }
}

async fn ensure_sidecar(state: &AppState) -> Result<Arc<SidecarHandle>, String> {
    spawn_or_reuse_sidecar(
        &state.sidecar,
        &state.sidecar_connection_id,
        &state.last_sidecar_error,
    )
    .await
}

async fn sidecar_rpc(state: &AppState) -> Result<Arc<sidecar::JsonRpcClient>, String> {
    Ok(ensure_sidecar(state).await?.rpc())
}

async fn close_sidecar_connection(rpc: &sidecar::JsonRpcClient, connection_id: String) {
    if let Err(err) = sidecar::commands::connection::close(rpc, &connection_id).await {
        eprintln!("[sidecar] failed to close connection {connection_id}: {err}");
    }
}

fn close_sidecar_connection_later(rpc: Arc<sidecar::JsonRpcClient>, connection_id: String) {
    tauri::async_runtime::spawn(async move {
        close_sidecar_connection(&rpc, connection_id).await;
    });
}

async fn cancel_current_query(state: &AppState) {
    let mut slot = state.cancel_token.lock().await;
    if let Some(token) = slot.token.take() {
        token.cancel();
    }
}

async fn sidecar_connection_id(state: &AppState) -> Result<String, String> {
    // Ensure the sidecar is alive before reading the id: if it died and
    // respawned, the slot was cleared and we return "Not connected" instead
    // of a stale id that the new sidecar instance won't recognise.
    let _ = ensure_sidecar(state).await?;
    state
        .sidecar_connection_id
        .lock()
        .await
        .clone()
        .ok_or_else(|| "Not connected to a server".to_string())
}

async fn sidecar_run_query(
    state: &AppState,
    sql: &str,
) -> Result<sidecar::contracts::query::ExecuteSqlResponse, String> {
    let id = sidecar_connection_id(state).await?;
    let rpc = sidecar_rpc(state).await?;
    sidecar::commands::query::execute(&rpc, &id, sql, None)
        .await
        .map_err(|e| e.to_string())
}

async fn open_sidecar_connection_with_timeout(
    rpc: &Arc<sidecar::JsonRpcClient>,
    config: sidecar::contracts::connection::SqlConnectionConfig,
    timeout: std::time::Duration,
) -> Result<sidecar::contracts::connection::OpenConnectionResponse, String> {
    let cancel = CancellationToken::new();
    let rpc_for_open = Arc::clone(rpc);
    let cancel_for_open = cancel.clone();
    let mut open_task = tauri::async_runtime::spawn(async move {
        sidecar::commands::connection::open_cancellable(&rpc_for_open, config, cancel_for_open)
            .await
    });

    match tokio::time::timeout(timeout, &mut open_task).await {
        Ok(joined) => joined
            .map_err(|err| format!("Connection task failed: {err}"))?
            .map_err(|err| err.to_string()),
        Err(_) => {
            cancel.cancel();
            let rpc_for_cleanup = Arc::clone(rpc);
            tauri::async_runtime::spawn(async move {
                match open_task.await {
                    Ok(Ok(opened)) => {
                        close_sidecar_connection(&rpc_for_cleanup, opened.connection_id).await;
                    }
                    Ok(Err(_)) | Err(_) => {}
                }
            });
            Err("Connection attempt timed out".to_string())
        }
    }
}

fn first_result_set(
    response: sidecar::contracts::query::ExecuteSqlResponse,
) -> Option<sidecar::contracts::query::ResultSetData> {
    response.result_sets.into_iter().next()
}

fn extract_string_cell(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Null => None,
        other => Some(other.to_string()),
    }
}

#[derive(Clone)]
struct ActiveConnection {
    config: ConnectionConfig,
}

#[derive(serde::Serialize)]
struct OpenedSqlFile {
    path: String,
    file_name: String,
    content: String,
}

#[derive(serde::Serialize)]
struct AiSchemaContext {
    database: Option<String>,
    schema_summary: String,
}

async fn reset_server_object_index(state: &AppState) {
    let token = {
        let mut token_lock = state.server_object_index_token.lock().await;
        token_lock.take()
    };

    if let Some(token) = token {
        token.cancel();
    }

    let mut object_index = state.server_object_index.lock().await;
    *object_index = CachedServerObjectIndex::default();
}

async fn set_active_connection(state: &AppState, config: ConnectionConfig) {
    let mut active_lock = state.active_connection.lock().await;
    *active_lock = Some(ActiveConnection { config });
}

async fn ensure_server_object_indexing_started(
    state: &AppState,
) -> Result<ServerObjectIndexStatus, String> {
    let connection_id = sidecar_connection_id(state).await?;

    let should_start = {
        let mut object_index = state.server_object_index.lock().await;
        if object_index.initialized {
            false
        } else {
            *object_index = CachedServerObjectIndex::start();
            true
        }
    };

    if !should_start {
        let object_index = state.server_object_index.lock().await;
        return Ok(object_index.status());
    }

    let token = CancellationToken::new();
    {
        let previous_token = {
            let mut token_lock = state.server_object_index_token.lock().await;
            token_lock.replace(token.clone())
        };
        if let Some(previous_token) = previous_token {
            previous_token.cancel();
        }
    }

    let rpc = sidecar_rpc(state).await?;
    let object_index = Arc::clone(&state.server_object_index);

    tauri::async_runtime::spawn(async move {
        let databases = match sidecar::commands::schema::list_databases(&rpc, &connection_id).await
        {
            Ok(response) => response
                .databases
                .into_iter()
                .map(|d| d.name)
                .collect::<Vec<_>>(),
            Err(error) => {
                eprintln!("Failed to start server object indexing: {}", error);
                let mut object_index = object_index.lock().await;
                object_index.finish();
                return;
            }
        };

        {
            let mut object_index = object_index.lock().await;
            if token.is_cancelled() {
                object_index.finish();
                return;
            }
            object_index.set_database_count(databases.len());
        }

        for database in databases {
            if token.is_cancelled() {
                break;
            }

            let result =
                sidecar::commands::schema::list_tables(&rpc, &connection_id, &database).await;

            if token.is_cancelled() {
                break;
            }

            {
                let mut object_index = object_index.lock().await;
                if token.is_cancelled() {
                    break;
                }

                match result {
                    Ok(response) => {
                        let objects = response
                            .objects
                            .into_iter()
                            .map(|o| DatabaseObject {
                                schema_name: o.schema_name,
                                name: o.name,
                                object_type: o.object_type,
                            })
                            .collect();
                        object_index.add_database_objects(database.clone(), objects);
                    }
                    Err(error) => {
                        eprintln!(
                            "Failed to index objects for database '{}': {}",
                            database, error
                        );
                        object_index.add_failed_database(database);
                    }
                }
            }

            tokio::task::yield_now().await;
        }

        let mut object_index = object_index.lock().await;
        object_index.finish();
    });

    let object_index = state.server_object_index.lock().await;
    Ok(object_index.status())
}

fn conversations_dir() -> PathBuf {
    let dir = settings::app_data_dir().join("conversations");
    fs::create_dir_all(&dir).ok();
    dir
}

fn is_valid_conversation_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn conversation_path(id: &str) -> Result<PathBuf, String> {
    if !is_valid_conversation_id(id) {
        return Err("Invalid conversation id".to_string());
    }
    Ok(conversations_dir().join(format!("{}.json", id)))
}

use std::fs;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct ConversationMeta {
    id: String,
    title: String,
    created_at: u64,
    updated_at: u64,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ConversationData {
    meta: ConversationMeta,
    messages: serde_json::Value,
}

#[tauri::command]
fn list_conversations() -> Result<Vec<ConversationMeta>, String> {
    let dir = conversations_dir();
    let mut conversations: Vec<ConversationMeta> = Vec::new();

    let entries =
        fs::read_dir(&dir).map_err(|e| format!("Failed to read conversations dir: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Ok(data) = fs::read_to_string(&path) {
                if let Ok(conv) = serde_json::from_str::<ConversationData>(&data) {
                    conversations.push(conv.meta);
                }
            }
        }
    }

    conversations.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(conversations)
}

#[tauri::command]
fn load_conversation(id: String) -> Result<ConversationData, String> {
    let path = conversation_path(&id)?;
    let data =
        fs::read_to_string(&path).map_err(|e| format!("Failed to load conversation: {}", e))?;
    serde_json::from_str(&data).map_err(|e| format!("Failed to parse conversation: {}", e))
}

#[tauri::command]
fn save_conversation(data: ConversationData) -> Result<(), String> {
    let dir = conversations_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create conversations dir: {}", e))?;
    let path = conversation_path(&data.meta.id)?;
    let json = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize conversation: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write conversation: {}", e))
}

#[tauri::command]
fn delete_conversation(id: String) -> Result<(), String> {
    let path = conversation_path(&id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete conversation: {}", e))?;
    }
    Ok(())
}

fn extract_startup_sql_file_path() -> Option<String> {
    std::env::args_os().skip(1).find_map(|arg| {
        let path = PathBuf::from(arg);
        if is_sql_path(&path) && path.exists() {
            Some(path.to_string_lossy().to_string())
        } else {
            None
        }
    })
}

#[tauri::command]
fn get_startup_sql_file_path() -> Option<String> {
    extract_startup_sql_file_path()
}

#[tauri::command]
fn read_sql_file(path: String) -> Result<OpenedSqlFile, String> {
    let file_path = PathBuf::from(&path);
    if !is_sql_path(&file_path) {
        return Err("Directories cannot be opened as files".to_string());
    }

    let content = std::fs::read_to_string(&file_path)
        .map_err(|err| format!("Failed to read SQL file '{}': {}", path, err))?;

    let file_name = file_path
        .file_stem()
        .or_else(|| file_path.file_name())
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("Query")
        .to_string();

    Ok(OpenedSqlFile {
        path: file_path.to_string_lossy().to_string(),
        file_name,
        content,
    })
}

#[tauri::command]
fn write_sql_file(path: String, content: String) -> Result<String, String> {
    let file_path = PathBuf::from(&path);

    if !is_sql_path(&file_path) {
        return Err("Directories cannot be written to".to_string());
    }

    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            let allowed_root = dirs::document_dir().ok_or("Cannot resolve Documents folder")?;
            if !parent.starts_with(&allowed_root) {
                return Err("Cannot create directories outside Documents folder".to_string());
            }
            std::fs::create_dir_all(parent).map_err(|err| {
                format!("Failed to create directory '{}': {}", parent.display(), err)
            })?;
        }
    }

    std::fs::write(&file_path, &content)
        .map_err(|err| format!("Failed to write SQL file '{}': {}", path, err))?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    let folder = PathBuf::from(&path);
    if !folder.exists() {
        let allowed_root = dirs::document_dir().ok_or("Cannot resolve Documents folder")?;
        if !folder.starts_with(&allowed_root) {
            return Err("Cannot create directories outside Documents folder".to_string());
        }
        std::fs::create_dir_all(&folder)
            .map_err(|err| format!("Failed to create folder '{}': {}", path, err))?;
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("explorer");
        command.arg(&folder);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(&folder);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(&folder);
        command
    };

    command
        .spawn()
        .map_err(|err| format!("Failed to open folder: {}", err))?;
    Ok(())
}

#[tauri::command]
fn list_custom_themes() -> Result<Vec<serde_json::Value>, String> {
    let docs_dir = dirs::document_dir().ok_or_else(|| "Failed to get Documents folder".to_string())?;
    let themes_dir = docs_dir.join("SQL Query Studio").join("Themes");
    if !themes_dir.exists() {
        return Ok(Vec::new());
    }

    let mut list = Vec::new();
    let entries = std::fs::read_dir(&themes_dir)
        .map_err(|err| format!("Failed to read themes folder: {}", err))?;

    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        list.push(json);
                    }
                }
            }
        }
    }
    Ok(list)
}

#[tauri::command]
fn save_custom_theme(theme: serde_json::Value) -> Result<(), String> {
    let docs_dir = dirs::document_dir().ok_or_else(|| "Failed to get Documents folder".to_string())?;
    let themes_dir = docs_dir.join("SQL Query Studio").join("Themes");
    std::fs::create_dir_all(&themes_dir)
        .map_err(|err| format!("Failed to create themes directory: {}", err))?;

    let id = theme.get("id").and_then(|v| v.as_str()).ok_or("Theme is missing id")?;
    let sanitized_id: String = id.chars().filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_').collect();
    if sanitized_id.is_empty() {
        return Err("Invalid theme ID".to_string());
    }

    let file_path = themes_dir.join(format!("{}.json", sanitized_id));

    let content = serde_json::to_string_pretty(&theme)
        .map_err(|err| format!("Failed to serialize theme: {}", err))?;

    std::fs::write(&file_path, content)
        .map_err(|err| format!("Failed to write theme file: {}", err))?;

    Ok(())
}

#[tauri::command]
fn delete_custom_theme(id: String) -> Result<(), String> {
    let docs_dir = dirs::document_dir().ok_or_else(|| "Failed to get Documents folder".to_string())?;
    let themes_dir = docs_dir.join("SQL Query Studio").join("Themes");

    let sanitized_id: String = id.chars().filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_').collect();
    if sanitized_id.is_empty() {
        return Err("Invalid theme ID".to_string());
    }

    let file_path = themes_dir.join(format!("{}.json", sanitized_id));
    if file_path.exists() {
        std::fs::remove_file(&file_path)
            .map_err(|err| format!("Failed to delete theme file: {}", err))?;
    }
    Ok(())
}

#[tauri::command]
fn get_documents_folder() -> Result<String, String> {
    let docs_dir =
        dirs::document_dir().ok_or_else(|| "Failed to get Documents folder".to_string())?;
    Ok(docs_dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn pick_folder_dialog(
    app: tauri::AppHandle,
    title: Option<String>,
    starting_directory: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file();

    if let Some(title) = title.filter(|value| !value.trim().is_empty()) {
        dialog = dialog.set_title(title);
    }

    if let Some(starting_directory) = starting_directory.filter(|value| !value.trim().is_empty()) {
        dialog = dialog.set_directory(starting_directory);
    }

    let selected = dialog.blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };

    let path = selected
        .into_path()
        .map_err(|err| format!("Failed to resolve selected folder: {}", err))?;

    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
async fn connect_to_server(
    state: State<'_, AppState>,
    config: ConnectionConfig,
    save_connection: Option<String>,
    remember_password: bool,
) -> Result<String, String> {
    let resolved_config = if let Some(ref conn_str) = config.connection_string {
        if !conn_str.trim().is_empty() {
            let mut parsed = conn_string::parse_connection_string(conn_str)?;
            parsed.password = config.password.clone().or(parsed.password);
            parsed
        } else {
            config.clone()
        }
    } else {
        config.clone()
    };

    let mut settings = settings::load_settings();

    let rpc = sidecar_rpc(&state).await?;

    let config_payload: sidecar::contracts::connection::SqlConnectionConfig =
        (&resolved_config).into();
    let response = sidecar::commands::connection::open(&rpc, config_payload)
        .await
        .map_err(|err| err.to_string())?;
    let new_connection_id = response.connection_id.clone();

    let mut settings_changed = false;
    if let Some(name) = &save_connection {
        let mut save_config = resolved_config.clone();

        if remember_password {
            if let Some(pass) = &save_config.password {
                settings::store_password(name, pass).ok();
            }
        }
        save_config.password = None;
        if let Some(conn_str) = &save_config.connection_string {
            save_config.connection_string =
                Some(conn_string::strip_password_from_connection_string(conn_str));
        }

        if let Some(existing) = settings.connections.iter_mut().find(|c| &c.name == name) {
            existing.config = save_config;
        } else {
            settings.connections.push(SavedConnection {
                name: name.clone(),
                config: save_config,
            });
        }
        settings.last_connection = Some(name.clone());
        settings_changed = true;
    }

    if settings_changed {
        if let Err(err) = settings::save_settings(&settings) {
            close_sidecar_connection(&rpc, new_connection_id).await;
            return Err(err);
        }
    }

    let previous_connection_id = {
        let mut lock = state.sidecar_connection_id.lock().await;
        lock.replace(new_connection_id)
    };
    if let Some(previous_connection_id) = previous_connection_id {
        cancel_current_query(&state).await;
        close_sidecar_connection_later(Arc::clone(&rpc), previous_connection_id);
    }

    set_active_connection(&state, resolved_config).await;
    reset_server_object_index(&state).await;
    eprintln!(
        "[backend] connected via SIDECAR (server={}, version={})",
        response.server_name, response.server_version
    );

    Ok("Connected".to_string())
}

#[tauri::command]
async fn disconnect_from_server(state: State<'_, AppState>) -> Result<(), String> {
    cancel_current_query(&state).await;
    let sidecar_id = state.sidecar_connection_id.lock().await.take();
    if let Some(id) = sidecar_id {
        if let Ok(rpc) = sidecar_rpc(&state).await {
            close_sidecar_connection_later(rpc, id);
        }
    }
    let mut active_lock = state.active_connection.lock().await;
    *active_lock = None;
    drop(active_lock);
    reset_server_object_index(&state).await;
    Ok(())
}

#[tauri::command]
async fn execute_query(
    state: State<'_, AppState>,
    sql: String,
    max_rows: Option<u64>,
    timeout_seconds: Option<u64>,
) -> Result<QueryResult, String> {
    let id = sidecar_connection_id(&state).await?;
    execute_query_via_sidecar(&state, &id, sql, max_rows, timeout_seconds).await
}

async fn execute_query_via_sidecar(
    state: &AppState,
    connection_id: &str,
    sql: String,
    max_rows: Option<u64>,
    timeout_seconds: Option<u64>,
) -> Result<QueryResult, String> {
    use db::ResultSet;

    let rpc = sidecar_rpc(state).await?;
    let start = std::time::Instant::now();
    let batches = db::split_batches(&sql);

    let cancel = CancellationToken::new();
    let cancel_gen = state
        .cancel_generation
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        .wrapping_add(1);
    {
        let mut slot = state.cancel_token.lock().await;
        slot.token = Some(cancel.clone());
        slot.generation = cancel_gen;
    }

    let timeout = timeout_seconds.filter(|s| *s > 0);
    let timeout_future = async {
        match timeout {
            Some(secs) => {
                tokio::time::sleep(std::time::Duration::from_secs(secs)).await;
                secs
            }
            None => std::future::pending::<u64>().await,
        }
    };
    tokio::pin!(timeout_future);

    let exec_future = sidecar::commands::query::execute_batches_cancellable(
        &rpc,
        connection_id,
        batches,
        max_rows,
        cancel.clone(),
    );

    let result = tokio::select! {
        res = exec_future => {
            let response = res.map_err(|err| {
                if cancel.is_cancelled() {
                    "Query cancelled by user".to_string()
                } else {
                    err.query_message()
                }
            })?;
            Ok(QueryResult {
                result_sets: response.result_sets.into_iter().map(|rs| ResultSet {
                    columns: rs.columns.into_iter().map(|c| ColumnInfo {
                        name: c.name,
                        type_name: c.type_name,
                        is_identity: c.is_identity,
                        is_nullable: c.is_nullable,
                        base_table_name: c.base_table_name,
                        base_schema_name: c.base_schema_name,
                        base_column_name: c.base_column_name,
                        is_expression: c.is_expression,
                    }).collect(),
                    rows: rs.rows,
                    truncated: rs.truncated,
                }).collect(),
                rows_affected: response.rows_affected,
                messages: response.messages,
                elapsed_ms: start.elapsed().as_millis() as u64,
                row_limit_applied: response.row_limit_applied,
                statistics: response.statistics.map(|s| db::QueryStatistics {
                    parse_and_compile_cpu_time_ms: s.parse_and_compile_cpu_time_ms,
                    parse_and_compile_elapsed_time_ms: s.parse_and_compile_elapsed_time_ms,
                    execution_cpu_time_ms: s.execution_cpu_time_ms,
                    execution_elapsed_time_ms: s.execution_elapsed_time_ms,
                    table_io: s.table_io.into_iter().map(|io| db::TableIoStatistics {
                        table_name: io.table_name,
                        scan_count: io.scan_count,
                        logical_reads: io.logical_reads,
                        physical_reads: io.physical_reads,
                        read_ahead_reads: io.read_ahead_reads,
                        lob_logical_reads: io.lob_logical_reads,
                        lob_physical_reads: io.lob_physical_reads,
                        lob_read_ahead_reads: io.lob_read_ahead_reads,
                    }).collect(),
                }),
                outputs: response.outputs.into_iter().map(|o| db::OutputItem {
                    r#type: o.r#type,
                    result_set_index: o.result_set_index,
                    message: o.message,
                }).collect(),
            })
        }
        secs = &mut timeout_future => {
            cancel.cancel();
            Err(format!("Query timed out after {}s", secs))
        }
    };

    {
        let mut slot = state.cancel_token.lock().await;
        if slot.generation == cancel_gen {
            slot.token = None;
        }
    }

    result
}

#[tauri::command]
async fn cancel_query(state: State<'_, AppState>) -> Result<(), String> {
    cancel_current_query(&state).await;
    Ok(())
}

#[tauri::command]
async fn get_databases(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let id = sidecar_connection_id(&state).await?;
    let rpc = sidecar_rpc(&state).await?;
    let response = sidecar::commands::schema::list_databases(&rpc, &id)
        .await
        .map_err(|err| err.to_string())?;
    Ok(response.databases.into_iter().map(|d| d.name).collect())
}

#[tauri::command]
async fn get_tables(
    state: State<'_, AppState>,
    database: String,
) -> Result<Vec<DatabaseObject>, String> {
    let id = sidecar_connection_id(&state).await?;
    let rpc = sidecar_rpc(&state).await?;
    let response = sidecar::commands::schema::list_tables(&rpc, &id, &database)
        .await
        .map_err(|err| err.to_string())?;
    Ok(response
        .objects
        .into_iter()
        .map(|o| DatabaseObject {
            schema_name: o.schema_name,
            name: o.name,
            object_type: o.object_type,
        })
        .collect())
}

#[tauri::command]
async fn search_server_objects(
    state: State<'_, AppState>,
    query: String,
    preferred_database: Option<String>,
    object_type: Option<String>,
    database_filter: Option<String>,
    limit: Option<usize>,
) -> Result<ServerObjectSearchResponse, String> {
    let limit = limit.unwrap_or(60).clamp(1, 200);
    let _ = ensure_server_object_indexing_started(&state).await?;

    let object_index = state.server_object_index.lock().await;

    Ok(db::search_server_objects(
        &object_index,
        &query,
        preferred_database.as_deref(),
        object_type.as_deref(),
        database_filter.as_deref(),
        limit,
    ))
}

#[tauri::command]
async fn start_server_object_indexing(
    state: State<'_, AppState>,
) -> Result<ServerObjectIndexStatus, String> {
    ensure_server_object_indexing_started(&state).await
}

#[tauri::command]
async fn get_server_object_index_status(
    state: State<'_, AppState>,
) -> Result<ServerObjectIndexStatus, String> {
    sidecar_connection_id(&state).await?;
    let object_index = state.server_object_index.lock().await;
    Ok(object_index.status())
}

#[tauri::command]
async fn get_columns(
    state: State<'_, AppState>,
    database: String,
    schema: String,
    table: String,
) -> Result<Vec<ColumnInfo>, String> {
    get_columns_via_sidecar(&state, &database, &schema, &table).await
}

#[tauri::command]
async fn get_database_schema_catalog(
    state: State<'_, AppState>,
    database: String,
) -> Result<Vec<DatabaseSchemaCatalogEntry>, String> {
    let id = sidecar_connection_id(&state).await?;
    let rpc = sidecar_rpc(&state).await?;
    let response = sidecar::commands::schema::list_schema_catalog(&rpc, &id, &database)
        .await
        .map_err(|err| err.to_string())?;
    Ok(response
        .entries
        .into_iter()
        .map(|e| DatabaseSchemaCatalogEntry {
            table_name: e.table_name,
            schema_name: e.schema_name,
            columns: e.columns,
        })
        .collect())
}

#[tauri::command]
async fn load_connections() -> Result<AppSettings, String> {
    Ok(settings::load_settings())
}

#[tauri::command]
async fn load_saved_password(connection_name: String) -> Result<Option<String>, String> {
    Ok(settings::load_password(&connection_name))
}

#[tauri::command]
async fn save_connections_settings(payload: AppSettings) -> Result<(), String> {
    settings::save_settings(&payload)
}

#[tauri::command]
async fn set_connection_password(name: String, password: String) -> Result<(), String> {
    if password.is_empty() {
        settings::delete_password(&name)
    } else {
        settings::store_password(&name, &password)
    }
}

#[tauri::command]
async fn delete_saved_connection(name: String) -> Result<AppSettings, String> {
    let mut current = settings::load_settings();
    current.connections.retain(|c| c.name != name);
    if current.last_connection.as_deref() == Some(name.as_str()) {
        current.last_connection = None;
    }
    settings::save_settings(&current)?;
    let _ = settings::delete_password(&name);
    Ok(current)
}

#[tauri::command]
async fn store_api_key(key: String) -> Result<(), String> {
    if key.is_empty() {
        return settings::delete_api_key();
    }
    settings::store_api_key(&key)
}

#[tauri::command]
async fn load_api_key() -> Result<Option<String>, String> {
    Ok(settings::load_api_key())
}

#[tauri::command]
async fn store_brave_search_key(key: String) -> Result<(), String> {
    if key.is_empty() {
        return settings::delete_brave_api_key();
    }
    settings::store_brave_api_key(&key)
}

#[tauri::command]
async fn load_brave_search_key() -> Result<Option<String>, String> {
    Ok(settings::load_brave_api_key())
}

#[derive(serde::Serialize)]
struct BraveSearchResult {
    title: String,
    url: String,
    description: String,
}

#[tauri::command]
async fn brave_search(query: String, count: Option<u32>) -> Result<Vec<BraveSearchResult>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("query is required".to_string());
    }

    let api_key = settings::load_brave_api_key()
        .ok_or_else(|| "Brave Search API key not configured".to_string())?;

    let count = count.unwrap_or(5).clamp(1, 20);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let response = client
        .get("https://api.search.brave.com/res/v1/web/search")
        .query(&[("q", query), ("count", &count.to_string())])
        .header("X-Subscription-Token", api_key)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Brave Search request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Brave Search HTTP {}: {}", status.as_u16(), body));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Brave Search response: {}", e))?;

    let results = body
        .get("web")
        .and_then(|w| w.get("results"))
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();

    let parsed = results
        .into_iter()
        .map(|item| BraveSearchResult {
            title: strip_html(
                item.get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default(),
            ),
            url: item
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            description: strip_html(
                item.get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default(),
            ),
        })
        .filter(|r| !r.url.is_empty())
        .collect();

    Ok(parsed)
}

fn strip_html(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

#[derive(serde::Serialize)]
struct AutoConnectResult {
    connected: bool,
    server: Option<String>,
    database: Option<String>,
    databases: Vec<String>,
}

#[tauri::command]
async fn try_auto_connect(state: State<'_, AppState>) -> Result<AutoConnectResult, String> {
    let not_connected = AutoConnectResult {
        connected: false,
        server: None,
        database: None,
        databases: vec![],
    };

    let settings = settings::load_settings();

    if !settings.auto_connect_startup {
        return Ok(not_connected);
    }

    let last_name = match &settings.last_connection {
        Some(n) => n.clone(),
        None => return Ok(not_connected),
    };

    let saved = match settings.connections.iter().find(|c| c.name == last_name) {
        Some(c) => c.clone(),
        None => return Ok(not_connected),
    };

    let password = settings::load_password(&last_name);
    let config = match &saved.config.connection_string {
        Some(conn_str) if !conn_str.trim().is_empty() => {
            let mut parsed = conn_string::parse_connection_string(conn_str)?;
            parsed.password = password.or(parsed.password);
            parsed
        }
        _ => ConnectionConfig {
            password,
            ..saved.config.clone()
        },
    };

    let rpc = match sidecar_rpc(&state).await {
        Ok(rpc) => rpc,
        Err(_) => return Ok(not_connected),
    };
    let config_payload: sidecar::contracts::connection::SqlConnectionConfig = (&config).into();
    let opened = match open_sidecar_connection_with_timeout(
        &rpc,
        config_payload,
        std::time::Duration::from_secs(10),
    )
    .await
    {
        Ok(response) => response,
        Err(_) => return Ok(not_connected),
    };
    *state.sidecar_connection_id.lock().await = Some(opened.connection_id.clone());

    let _ = settings;

    set_active_connection(&state, config.clone()).await;
    reset_server_object_index(&state).await;

    let databases = sidecar::commands::schema::list_databases(&rpc, &opened.connection_id)
        .await
        .map(|r| r.databases.into_iter().map(|d| d.name).collect())
        .unwrap_or_default();

    Ok(AutoConnectResult {
        connected: true,
        server: Some(config.server),
        database: config.database,
        databases,
    })
}

#[tauri::command]
async fn change_database(state: State<'_, AppState>, database: String) -> Result<(), String> {
    let id = sidecar_connection_id(&state).await?;
    let rpc = sidecar_rpc(&state).await?;
    sidecar::commands::connection::change_database(&rpc, &id, &database)
        .await
        .map_err(|err| err.to_string())?;
    let mut active_lock = state.active_connection.lock().await;
    if let Some(active) = active_lock.as_mut() {
        active.config.database = Some(database);
    }
    Ok(())
}

#[tauri::command]
async fn get_backup_defaults(state: State<'_, AppState>) -> Result<BackupDefaults, String> {
    let id = sidecar_connection_id(&state).await?;
    let rpc = sidecar_rpc(&state).await?;
    let response = sidecar::commands::backup::defaults(&rpc, &id)
        .await
        .map_err(|err| err.to_string())?;
    Ok(BackupDefaults {
        backup_directory: response.backup_directory,
        data_directory: response.data_directory,
        log_directory: response.log_directory,
    })
}

#[tauri::command]
async fn backup_database(
    state: State<'_, AppState>,
    request: BackupDatabaseRequest,
) -> Result<BackupOperationResult, String> {
    let id = sidecar_connection_id(&state).await?;
    let rpc = sidecar_rpc(&state).await?;
    let response = sidecar::commands::backup::run(
        &rpc,
        sidecar::contracts::backup::BackupRequest {
            connection_id: id,
            database: request.database,
            destination_path: request.destination_path,
            backup_type: request.backup_type,
            overwrite: request.overwrite,
            copy_only: request.copy_only,
            compression: request.compression,
            checksum: request.checksum,
        },
    )
    .await
    .map_err(|err| err.to_string())?;
    Ok(BackupOperationResult {
        message: response.message,
        elapsed_ms: response.elapsed_ms,
    })
}

#[tauri::command]
async fn inspect_backup_file(
    state: State<'_, AppState>,
    source_path: String,
) -> Result<Vec<BackupFileInfo>, String> {
    let id = sidecar_connection_id(&state).await?;
    let rpc = sidecar_rpc(&state).await?;
    let response = sidecar::commands::backup::inspect(&rpc, &id, &source_path)
        .await
        .map_err(|err| err.to_string())?;
    Ok(response
        .files
        .into_iter()
        .map(|f| BackupFileInfo {
            logical_name: f.logical_name,
            physical_name: f.physical_name,
            file_type: f.file_type,
            size_bytes: f.size_bytes,
        })
        .collect())
}

#[tauri::command]
async fn restore_database(
    state: State<'_, AppState>,
    request: RestoreDatabaseRequest,
) -> Result<BackupOperationResult, String> {
    let id = sidecar_connection_id(&state).await?;
    let rpc = sidecar_rpc(&state).await?;
    let response = sidecar::commands::backup::restore(
        &rpc,
        sidecar::contracts::backup::RestoreRequest {
            connection_id: id,
            source_path: request.source_path,
            target_database: request.target_database,
            replace_existing: request.replace_existing,
            recovery: request.recovery,
            restricted_user: request.restricted_user,
            file_moves: request
                .file_moves
                .into_iter()
                .map(|m| sidecar::contracts::backup::RestoreFileMoveDto {
                    logical_name: m.logical_name,
                    physical_name: m.physical_name,
                })
                .collect(),
        },
    )
    .await
    .map_err(|err| err.to_string())?;
    Ok(BackupOperationResult {
        message: response.message,
        elapsed_ms: response.elapsed_ms,
    })
}

#[tauri::command]
async fn create_backup_schedule(
    state: State<'_, AppState>,
    request: BackupScheduleRequest,
) -> Result<BackupOperationResult, String> {
    let sql = backup_schedules::build_create_schedule_sql(&request)?;
    let start = std::time::Instant::now();
    sidecar_run_query(&state, &sql).await?;
    Ok(BackupOperationResult {
        message: "Schedule creation completed successfully.".to_string(),
        elapsed_ms: start.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
async fn list_backup_schedules(
    state: State<'_, AppState>,
) -> Result<Vec<BackupScheduleInfo>, String> {
    let response = sidecar_run_query(&state, backup_schedules::LIST_SCHEDULES_SQL).await?;
    let Some(result_set) = first_result_set(response) else {
        return Ok(Vec::new());
    };
    Ok(result_set
        .rows
        .into_iter()
        .filter_map(|row| {
            let mut iter = row.into_iter();
            let job_id = extract_string_cell(&iter.next()?)?;
            let job_name = extract_string_cell(&iter.next()?).unwrap_or_default();
            let enabled = iter.next().and_then(|v| v.as_bool()).unwrap_or(false);
            let schedule_name = iter.next().and_then(|v| extract_string_cell(&v));
            let next_run_date = iter.next().and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            let next_run_time = iter.next().and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            Some(BackupScheduleInfo {
                job_id,
                job_name,
                enabled,
                schedule_name,
                next_run: backup_schedules::format_sql_agent_datetime(next_run_date, next_run_time),
            })
        })
        .collect())
}

#[tauri::command]
async fn delete_backup_schedule(
    state: State<'_, AppState>,
    job_name: String,
) -> Result<BackupOperationResult, String> {
    let sql = backup_schedules::build_delete_schedule_sql(&job_name)?;
    let start = std::time::Instant::now();
    sidecar_run_query(&state, &sql).await?;
    Ok(BackupOperationResult {
        message: "Schedule deletion completed successfully.".to_string(),
        elapsed_ms: start.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
async fn get_ai_schema_context(state: State<'_, AppState>) -> Result<AiSchemaContext, String> {
    if state.sidecar_connection_id.lock().await.is_none() {
        return Ok(AiSchemaContext {
            database: None,
            schema_summary: String::new(),
        });
    }

    let database = sidecar_run_query(&state, "SELECT DB_NAME()")
        .await
        .ok()
        .and_then(first_result_set)
        .and_then(|rs| rs.rows.into_iter().next())
        .and_then(|row| row.into_iter().next())
        .and_then(|c| extract_string_cell(&c));

    let schema_summary = sidecar_run_query(&state, AI_SCHEMA_SUMMARY_SQL)
        .await
        .ok()
        .and_then(first_result_set)
        .map(|rs| format_ai_schema_summary(&rs.rows))
        .unwrap_or_default();

    Ok(AiSchemaContext {
        database,
        schema_summary,
    })
}

const AI_SCHEMA_SUMMARY_SQL: &str = r#"
WITH objects AS (
    SELECT
        TABLE_SCHEMA,
        TABLE_NAME,
        CASE WHEN TABLE_TYPE = 'VIEW' THEN 'VIEW' ELSE 'TABLE' END AS OBJECT_TYPE,
        ROW_NUMBER() OVER (
            ORDER BY
                CASE WHEN TABLE_TYPE = 'VIEW' THEN 1 ELSE 0 END,
                TABLE_SCHEMA,
                TABLE_NAME
        ) AS OBJECT_RANK
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW')
),
columns_limited AS (
    SELECT
        TABLE_SCHEMA,
        TABLE_NAME,
        COLUMN_NAME,
        DATA_TYPE,
        ROW_NUMBER() OVER (
            PARTITION BY TABLE_SCHEMA, TABLE_NAME
            ORDER BY ORDINAL_POSITION
        ) AS COLUMN_RANK
    FROM INFORMATION_SCHEMA.COLUMNS
)
SELECT
    o.TABLE_SCHEMA,
    o.TABLE_NAME,
    o.OBJECT_TYPE,
    c.COLUMN_NAME,
    c.DATA_TYPE,
    c.COLUMN_RANK
FROM objects o
LEFT JOIN columns_limited c
    ON o.TABLE_SCHEMA = c.TABLE_SCHEMA
    AND o.TABLE_NAME = c.TABLE_NAME
    AND c.COLUMN_RANK <= 8
WHERE o.OBJECT_RANK <= 40
ORDER BY o.OBJECT_RANK, c.COLUMN_RANK
"#;

fn format_ai_schema_summary(rows: &[Vec<serde_json::Value>]) -> String {
    let mut summary_lines: Vec<String> = Vec::new();
    let mut current_key = String::new();
    let mut current_object = String::new();
    let mut current_columns: Vec<String> = Vec::new();

    for row in rows {
        let schema = row
            .get(0)
            .and_then(extract_string_cell)
            .unwrap_or_else(|| "dbo".to_string());
        let table = row.get(1).and_then(extract_string_cell).unwrap_or_default();
        let object_type = row
            .get(2)
            .and_then(extract_string_cell)
            .unwrap_or_else(|| "TABLE".to_string());
        let column_name = row.get(3).and_then(extract_string_cell);
        let data_type = row.get(4).and_then(extract_string_cell);
        let key = format!("[{}].[{}]", schema, table);

        if key != current_key && !current_key.is_empty() {
            summary_lines.push(format!(
                "{} {} ({})",
                current_object,
                current_key,
                current_columns.join(", ")
            ));
            current_columns.clear();
        }

        if key != current_key {
            current_key = key.clone();
            current_object = object_type;
        }

        if let Some(column_name) = column_name {
            let type_name = data_type.unwrap_or_else(|| "sql_variant".to_string());
            current_columns.push(format!("{} {}", column_name, type_name));
        }
    }

    if !current_key.is_empty() {
        summary_lines.push(format!(
            "{} {} ({})",
            current_object,
            current_key,
            current_columns.join(", ")
        ));
    }

    summary_lines.join("\n")
}

#[tauri::command]
async fn get_indexes(
    state: State<'_, AppState>,
    database: String,
    schema: String,
    table: String,
) -> Result<String, String> {
    let id = sidecar_connection_id(&state).await?;
    let rpc = sidecar_rpc(&state).await?;
    let response = sidecar::commands::schema::list_indexes(&rpc, &id, &database, &schema, &table)
        .await
        .map_err(|err| err.to_string())?;
    if response.indexes.is_empty() {
        return Ok("No indexes found.".to_string());
    }
    let lines: Vec<String> = response
        .indexes
        .into_iter()
        .map(|i| {
            let mut flags = Vec::new();
            if i.is_primary_key {
                flags.push("PRIMARY KEY");
            }
            if i.is_unique && !i.is_primary_key {
                flags.push("UNIQUE");
            }
            let flag_str = if flags.is_empty() {
                String::new()
            } else {
                format!(" [{}]", flags.join(", "))
            };
            format!(
                "{}{} ({}) \u{2014} {}",
                i.name, flag_str, i.columns, i.type_description
            )
        })
        .collect();
    Ok(lines.join("\n"))
}

#[tauri::command]
async fn get_foreign_keys(
    state: State<'_, AppState>,
    database: String,
    schema: String,
    table: String,
) -> Result<String, String> {
    let id = sidecar_connection_id(&state).await?;
    let rpc = sidecar_rpc(&state).await?;
    let response =
        sidecar::commands::schema::list_foreign_keys(&rpc, &id, &database, &schema, &table)
            .await
            .map_err(|err| err.to_string())?;
    if response.foreign_keys.is_empty() {
        return Ok("No foreign keys found.".to_string());
    }
    let lines: Vec<String> = response
        .foreign_keys
        .into_iter()
        .map(|fk| {
            format!(
                "{}: ({}) \u{2192} [{}].[{}]({})",
                fk.name,
                fk.parent_columns,
                fk.referenced_schema,
                fk.referenced_table,
                fk.referenced_columns
            )
        })
        .collect();
    Ok(lines.join("\n"))
}

#[tauri::command]
async fn generate_create_script(
    state: State<'_, AppState>,
    database: String,
    schema: String,
    table: String,
) -> Result<String, String> {
    script_object_via_sidecar(&state, &database, &schema, &table, "TABLE").await
}

#[tauri::command]
async fn get_object_definition(
    state: State<'_, AppState>,
    database: String,
    schema: String,
    name: String,
) -> Result<String, String> {
    let id = sidecar_connection_id(&state).await?;
    let rpc = sidecar_rpc(&state).await?;
    let candidates = ["PROCEDURE", "FUNCTION", "VIEW", "TRIGGER"];
    let mut last_err: Option<String> = None;
    for object_type in candidates {
        match sidecar::commands::scripting::script_object(
            &rpc,
            &id,
            &database,
            &schema,
            &name,
            object_type,
            Some(sidecar::contracts::scripting::ScriptOptions::ssms_defaults()),
        )
        .await
        {
            Ok(response) => return Ok(response.script),
            Err(err) => last_err = Some(err.to_string()),
        }
    }
    Err(last_err.unwrap_or_else(|| "Object not found".to_string()))
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn set_mica_theme(window: tauri::WebviewWindow, dark: bool) -> Result<(), String> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::DwmSetWindowAttribute;

    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let value = BOOL::from(dark);

    unsafe {
        DwmSetWindowAttribute(
            HWND(hwnd.0 as *mut _),
            windows::Win32::Graphics::Dwm::DWMWINDOWATTRIBUTE(20),
            &value as *const BOOL as *const std::ffi::c_void,
            std::mem::size_of::<BOOL>() as u32,
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn minimize_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn maximize_window(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn close_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn set_mica_theme(_window: tauri::WebviewWindow, _dark: bool) -> Result<(), String> {
    Ok(())
}

#[derive(serde::Serialize)]
struct SystemLocaleInfo {
    locale: String,
    short_date_pattern: Option<String>,
    short_time_pattern: Option<String>,
    long_time_pattern: Option<String>,
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_system_locale() -> SystemLocaleInfo {
    use windows::core::PCWSTR;
    use windows::Win32::Globalization::GetLocaleInfoEx;

    const LOCALE_SNAME: u32 = 0x0000005c;
    const LOCALE_SSHORTDATE: u32 = 0x0000001f;
    const LOCALE_SSHORTTIME: u32 = 0x00000079;
    const LOCALE_STIMEFORMAT: u32 = 0x00001003;

    fn query(lctype: u32) -> Option<String> {
        let mut buf = [0u16; 256];
        let len = unsafe { GetLocaleInfoEx(PCWSTR::null(), lctype, Some(&mut buf)) };
        if len <= 0 {
            return None;
        }
        let len = (len - 1) as usize;
        String::from_utf16(&buf[..len]).ok()
    }

    SystemLocaleInfo {
        locale: query(LOCALE_SNAME).unwrap_or_else(|| "en-US".to_string()),
        short_date_pattern: query(LOCALE_SSHORTDATE),
        short_time_pattern: query(LOCALE_SSHORTTIME),
        long_time_pattern: query(LOCALE_STIMEFORMAT),
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_system_locale() -> SystemLocaleInfo {
    SystemLocaleInfo {
        locale: sys_locale::get_locale().unwrap_or_else(|| "en-US".to_string()),
        short_date_pattern: None,
        short_time_pattern: None,
        long_time_pattern: None,
    }
}

#[tauri::command]
fn extract_table_name(sql: String) -> Option<String> {
    sql_gen::extract_table_name(&sql)
}

#[tauri::command]
fn extract_result_set_table_names(sql: String) -> Vec<String> {
    sql_gen::extract_result_set_table_names(&sql)
}

#[tauri::command]
fn build_row_sql(
    operation: String,
    source_sql: String,
    columns: Vec<sql_gen::ColumnDef>,
    row: Vec<serde_json::Value>,
    primary_key_columns: Option<Vec<String>>,
    target_table: Option<String>,
) -> Result<String, String> {
    let table_name = target_table
        .or_else(|| sql_gen::extract_table_name(&source_sql))
        .ok_or_else(|| "Could not determine table name from query".to_string())?;
    let primary_key_columns = primary_key_columns.unwrap_or_default();

    match operation.as_str() {
        "update" => sql_gen::build_update_sql(&table_name, &columns, &row, &primary_key_columns),
        "delete" => sql_gen::build_delete_sql(&table_name, &columns, &row, &primary_key_columns),
        "insert" => Ok(sql_gen::build_insert_sql(&table_name, &columns, &row)),
        _ => Err(format!("Unknown operation: {}", operation)),
    }
}

fn resolve_table_ref(
    source_sql: &str,
    table: Option<String>,
    schema: Option<String>,
) -> Result<String, String> {
    if let Some(table) = table {
        let trimmed = table.trim();
        if !trimmed.is_empty() {
            if let Some(schema) = schema.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
                return Ok(format!("{}.{}", schema, trimmed));
            }
            return Ok(trimmed.to_string());
        }
    }
    sql_gen::extract_table_name(source_sql)
        .ok_or_else(|| "Could not determine table name from query".to_string())
}

#[tauri::command]
async fn get_table_identity_columns(
    state: State<'_, AppState>,
    source_sql: String,
    table: Option<String>,
    schema: Option<String>,
) -> Result<Vec<String>, String> {
    let table_ref = resolve_table_ref(&source_sql, table, schema)?;
    let sql = format!(
        "SELECT c.name FROM sys.columns c WHERE c.object_id = OBJECT_ID('{}') AND c.is_identity = 1",
        table_ref.replace('\'', "''")
    );
    let response = sidecar_run_query(&state, &sql).await?;
    let Some(result_set) = first_result_set(response) else {
        return Ok(Vec::new());
    };
    Ok(result_set
        .rows
        .into_iter()
        .filter_map(|row| row.into_iter().next().and_then(|c| extract_string_cell(&c)))
        .collect())
}

#[tauri::command]
async fn get_primary_key_columns(
    state: State<'_, AppState>,
    source_sql: String,
    table: Option<String>,
    schema: Option<String>,
) -> Result<Vec<String>, String> {
    let table_ref = resolve_table_ref(&source_sql, table, schema)?;
    let sql = format!(
        "SELECT c.name \
         FROM sys.indexes i \
         JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id \
         JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id \
         WHERE i.object_id = OBJECT_ID('{}') AND i.is_primary_key = 1 \
         ORDER BY ic.key_ordinal",
        table_ref.replace('\'', "''")
    );
    let response = sidecar_run_query(&state, &sql).await?;
    let Some(result_set) = first_result_set(response) else {
        return Ok(Vec::new());
    };
    Ok(result_set
        .rows
        .into_iter()
        .filter_map(|row| row.into_iter().next().and_then(|c| extract_string_cell(&c)))
        .collect())
}

#[tauri::command]
async fn get_table_column_metadata(
    state: State<'_, AppState>,
    source_sql: String,
    table: Option<String>,
    schema: Option<String>,
) -> Result<Vec<ColumnInfo>, String> {
    let table_ref = resolve_table_ref(&source_sql, table, schema)?;
    let sql = format!(
        "SELECT \
            c.name, \
            tp.name + CASE \
                WHEN tp.name IN ('varchar','char','binary','varbinary') THEN '(' + \
                    CASE WHEN c.max_length = -1 THEN 'max' ELSE CAST(c.max_length AS VARCHAR(10)) END + ')' \
                WHEN tp.name IN ('nvarchar','nchar') THEN '(' + \
                    CASE WHEN c.max_length = -1 THEN 'max' ELSE CAST(c.max_length / 2 AS VARCHAR(10)) END + ')' \
                WHEN tp.name IN ('decimal','numeric') THEN '(' + CAST(c.precision AS VARCHAR(10)) + ',' + CAST(c.scale AS VARCHAR(10)) + ')' \
                WHEN tp.name IN ('datetime2','datetimeoffset','time') THEN '(' + CAST(c.scale AS VARCHAR(10)) + ')' \
                ELSE '' END AS full_type, \
            c.is_identity, \
            c.is_nullable \
         FROM sys.columns c \
         JOIN sys.types tp ON c.user_type_id = tp.user_type_id \
         WHERE c.object_id = OBJECT_ID('{}') \
         ORDER BY c.column_id",
        table_ref.replace('\'', "''")
    );
    let response = sidecar_run_query(&state, &sql).await?;
    let Some(result_set) = first_result_set(response) else {
        return Ok(Vec::new());
    };
    Ok(result_set
        .rows
        .into_iter()
        .filter_map(|row| {
            let mut iter = row.into_iter();
            let name = extract_string_cell(&iter.next()?)?;
            let type_name = extract_string_cell(&iter.next()?).unwrap_or_default();
            let is_identity = iter.next().and_then(|v| v.as_bool()).unwrap_or(false);
            let is_nullable = iter.next().and_then(|v| v.as_bool()).unwrap_or(true);
            Some(ColumnInfo {
                name,
                type_name,
                is_identity,
                is_nullable,
                base_table_name: None,
                base_schema_name: None,
                base_column_name: None,
                is_expression: false,
            })
        })
        .collect())
}

#[tauri::command]
fn build_row_update_with_edits(
    source_sql: String,
    columns: Vec<sql_gen::ColumnDef>,
    old_row: Vec<serde_json::Value>,
    new_row: Vec<serde_json::Value>,
    primary_key_columns: Vec<String>,
    target_table: Option<String>,
) -> Result<String, String> {
    let table_name = target_table
        .or_else(|| sql_gen::extract_table_name(&source_sql))
        .ok_or_else(|| "Could not determine table name from query".to_string())?;
    sql_gen::build_update_sql_with_edits(
        &table_name,
        &columns,
        &old_row,
        &new_row,
        &primary_key_columns,
    )
}

#[tauri::command]
fn export_results_csv(
    path: String,
    columns: Vec<sql_gen::ColumnDef>,
    rows: Vec<Vec<serde_json::Value>>,
) -> Result<(), String> {
    sql_gen::export_csv(&path, &columns, &rows)
}

#[tauri::command]
fn export_results_json(
    path: String,
    columns: Vec<sql_gen::ColumnDef>,
    rows: Vec<Vec<serde_json::Value>>,
) -> Result<(), String> {
    sql_gen::export_json(&path, &columns, &rows)
}

#[tauri::command]
fn export_results_xlsx(
    path: String,
    columns: Vec<sql_gen::ColumnDef>,
    rows: Vec<Vec<serde_json::Value>>,
) -> Result<(), String> {
    sql_gen::export_xlsx(&path, &columns, &rows)
}

#[derive(serde::Serialize)]
struct ObjectScriptResult {
    sql: String,
}

#[tauri::command]
async fn generate_object_script(
    state: State<'_, AppState>,
    database: String,
    schema: String,
    name: String,
    object_type: String,
    action: String,
) -> Result<ObjectScriptResult, String> {
    if let Some(sql) =
        sql_gen::generate_object_script_static(&database, &schema, &name, &object_type, &action)
    {
        return Ok(ObjectScriptResult { sql });
    }

    let needs_columns = matches!(
        action.as_str(),
        "script_select_columns" | "script_insert" | "script_update" | "script_delete"
    );
    let needs_columns_for_create = action == "script_create" && object_type == "VIEW";

    let fallback_script = |action_str: &str| {
        sql_gen::generate_object_script_definition_fallback(
            &database,
            &schema,
            &name,
            &object_type,
            action_str,
        )
    };

    if needs_columns || needs_columns_for_create {
        match get_columns_via_sidecar(&state, &database, &schema, &name).await {
            Ok(columns) => {
                let sql = sql_gen::generate_object_script_with_columns(
                    &database,
                    &schema,
                    &name,
                    &object_type,
                    &action,
                    &columns,
                );
                return Ok(ObjectScriptResult { sql });
            }
            Err(_) => {
                return Ok(ObjectScriptResult {
                    sql: fallback_script(&action),
                });
            }
        }
    }

    if action == "script_create" && object_type == "TABLE" {
        match script_object_via_sidecar(&state, &database, &schema, &name, "TABLE").await {
            Ok(sql) => return Ok(ObjectScriptResult { sql }),
            Err(_) => {
                return Ok(ObjectScriptResult {
                    sql: fallback_script(&action),
                });
            }
        }
    }

    let needs_definition = matches!(action.as_str(), "script_alter" | "view_definition" | "jump")
        && matches!(
            object_type.as_str(),
            "PROCEDURE" | "FUNCTION" | "TRIGGER" | "VIEW"
        );

    if needs_definition {
        match script_object_via_sidecar(&state, &database, &schema, &name, &object_type).await {
            Ok(definition) => {
                let sql = sql_gen::generate_object_script_with_definition(
                    &database,
                    &schema,
                    &name,
                    &object_type,
                    &action,
                    &definition,
                );
                return Ok(ObjectScriptResult { sql });
            }
            Err(_) => {
                return Ok(ObjectScriptResult {
                    sql: fallback_script(&action),
                });
            }
        }
    }

    Ok(ObjectScriptResult {
        sql: fallback_script(&action),
    })
}

async fn get_columns_via_sidecar(
    state: &AppState,
    database: &str,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    let id = sidecar_connection_id(state).await?;
    let rpc = sidecar_rpc(state).await?;
    let response = sidecar::commands::schema::list_columns(&rpc, &id, database, schema, table)
        .await
        .map_err(|err| err.to_string())?;
    Ok(response
        .columns
        .into_iter()
        .map(|c| ColumnInfo {
            name: c.name,
            type_name: c.type_name,
            is_identity: c.is_identity,
            is_nullable: c.is_nullable,
            base_table_name: None,
            base_schema_name: None,
            base_column_name: None,
            is_expression: false,
        })
        .collect())
}

async fn script_object_via_sidecar(
    state: &AppState,
    database: &str,
    schema: &str,
    name: &str,
    object_type: &str,
) -> Result<String, String> {
    let id = sidecar_connection_id(state).await?;
    let rpc = sidecar_rpc(state).await?;
    let response = sidecar::commands::scripting::script_object(
        &rpc,
        &id,
        database,
        schema,
        name,
        object_type,
        Some(sidecar::contracts::scripting::ScriptOptions::ssms_defaults()),
    )
    .await
    .map_err(|err| err.to_string())?;
    Ok(response.script)
}

#[tauri::command]
async fn xe_start_session(
    state: State<'_, AppState>,
    session_name: String,
    events: Option<Vec<String>>,
    max_memory_kb: Option<i32>,
    max_events_retained: Option<i32>,
) -> Result<sidecar::contracts::xe::StartXeSessionResponse, String> {
    let connection_id = sidecar_connection_id(&state).await?;
    let rpc = sidecar_rpc(&state).await?;
    sidecar::commands::xe::start_session(
        &rpc,
        sidecar::contracts::xe::StartXeSessionRequest {
            connection_id,
            session_name,
            events,
            max_memory_kb: max_memory_kb.unwrap_or(4096),
            max_events_retained: max_events_retained.unwrap_or(1000),
        },
    )
    .await
    .map_err(|err| err.to_string())
}

#[tauri::command]
async fn xe_stop_session(
    state: State<'_, AppState>,
    session_name: String,
    drop: Option<bool>,
) -> Result<(), String> {
    let connection_id = sidecar_connection_id(&state).await?;
    let rpc = sidecar_rpc(&state).await?;
    sidecar::commands::xe::stop_session(
        &rpc,
        sidecar::contracts::xe::StopXeSessionRequest {
            connection_id,
            session_name,
            drop: drop.unwrap_or(true),
        },
    )
    .await
    .map_err(|err| err.to_string())
}

#[tauri::command]
async fn xe_read_session(
    state: State<'_, AppState>,
    session_name: String,
) -> Result<sidecar::contracts::xe::ReadXeSessionResponse, String> {
    let connection_id = sidecar_connection_id(&state).await?;
    let rpc = sidecar_rpc(&state).await?;
    sidecar::commands::xe::read_session(&rpc, &connection_id, &session_name)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn sidecar_health_ping(state: State<'_, AppState>) -> Result<PingResponse, String> {
    let handle = ensure_sidecar(&state).await?;
    handle.ping().await.map_err(|err| err.to_string())
}

#[tauri::command]
fn read_clipboard() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.get_text().map_err(|e| e.to_string())
}

#[tauri::command]
fn write_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::panic::set_hook(Box::new(|info| {
        eprintln!("PANIC: {}", info);
        if let Ok(bt) = std::env::var("RUST_BACKTRACE") {
            if bt == "1" || bt == "full" {
                eprintln!("{:?}", std::backtrace::Backtrace::capture());
            }
        }
    }));

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // Linux keeps single-instance file forwarding. Windows allows separate
    // app processes, and Mac uses RunEvent::Opened instead.
    #[cfg(target_os = "linux")]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }

            for arg in args.iter().skip(1) {
                let path = PathBuf::from(arg);
                if is_sql_path(&path) && path.exists() {
                    let _ = app.emit(SQL_FILE_OPENED_EVENT, path.to_string_lossy().to_string());
                    break;
                }
            }
        }));
    }

    let app = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_snap_layout::init().button_id("snap-btn").build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();

            let window_clone = window.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                window_clone.show().ok();
            });

            let state = app.state::<AppState>();
            let sidecar_slot = state.sidecar.clone();
            let connection_slot = state.sidecar_connection_id.clone();
            let error_slot = state.last_sidecar_error.clone();
            tauri::async_runtime::spawn(async move {
                match spawn_or_reuse_sidecar(&sidecar_slot, &connection_slot, &error_slot).await {
                    Ok(handle) => match handle.ping().await {
                        Ok(pong) => eprintln!(
                            "[sidecar] health.ping ok: version={} runtime={} pid={} uptime_ms={}",
                            pong.sidecar_version,
                            pong.runtime_description,
                            pong.process_id,
                            pong.uptime_milliseconds
                        ),
                        Err(err) => eprintln!("[sidecar] health.ping failed: {err}"),
                    },
                    Err(err) => eprintln!("[sidecar] {err}"),
                }
            });

            Ok(())
        })
        .manage(AppState {
            active_connection: Arc::new(Mutex::new(None)),
            cancel_token: Arc::new(Mutex::new(CancelSlot {
                token: None,
                generation: 0,
            })),
            cancel_generation: std::sync::atomic::AtomicU64::new(0),
            server_object_index: Arc::new(Mutex::new(CachedServerObjectIndex::default())),
            server_object_index_token: Arc::new(Mutex::new(None)),
            sidecar: Arc::new(RwLock::new(None)),
            sidecar_connection_id: Arc::new(Mutex::new(None)),
            last_sidecar_error: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            connect_to_server,
            disconnect_from_server,
            execute_query,
            cancel_query,
            get_databases,
            get_tables,
            search_server_objects,
            start_server_object_indexing,
            get_server_object_index_status,
            get_columns,
            get_database_schema_catalog,
            get_indexes,
            get_foreign_keys,
            get_object_definition,
            generate_create_script,
            load_connections,
            load_saved_password,
            save_connections_settings,
            set_connection_password,
            delete_saved_connection,
            try_auto_connect,
            change_database,
            get_backup_defaults,
            backup_database,
            inspect_backup_file,
            restore_database,
            create_backup_schedule,
            list_backup_schedules,
            delete_backup_schedule,
            get_ai_schema_context,
            get_startup_sql_file_path,
            read_sql_file,
            write_sql_file,
            get_documents_folder,
            pick_folder_dialog,
            open_folder,
            list_custom_themes,
            save_custom_theme,
            delete_custom_theme,
            set_mica_theme,
            minimize_window,
            maximize_window,
            close_window,
            store_api_key,
            load_api_key,
            store_brave_search_key,
            load_brave_search_key,
            brave_search,
            get_system_locale,
            extract_table_name,
            extract_result_set_table_names,
            build_row_sql,
            build_row_update_with_edits,
            get_table_identity_columns,
            get_primary_key_columns,
            check_update_channel,
            get_table_column_metadata,
            export_results_csv,
            export_results_json,
            export_results_xlsx,
            generate_object_script,
            list_conversations,
            load_conversation,
            save_conversation,
            delete_conversation,
            sidecar_health_ping,
            xe_start_session,
            xe_stop_session,
            xe_read_session,
            read_clipboard,
            write_clipboard,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        tauri::RunEvent::Opened { urls } => {
            for url in urls {
                let Ok(path) = url.to_file_path() else {
                    continue;
                };

                if is_sql_path(&path) {
                    let _ =
                        app_handle.emit(SQL_FILE_OPENED_EVENT, path.to_string_lossy().to_string());
                }
            }
        }
        tauri::RunEvent::ExitRequested { .. } => {
            let sidecar = app_handle.state::<AppState>().sidecar.clone();
            tauri::async_runtime::block_on(async move {
                if let Some(handle) = sidecar.write().await.take() {
                    handle.shutdown().await;
                }
            });
        }
        _ => {}
    });
}
