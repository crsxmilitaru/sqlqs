mod db;
mod settings;

use db::{ColumnInfo, ConnectionConfig, DatabaseObject, QueryResult, SqlClient};
use settings::{AppSettings, SavedConnection};
use std::path::PathBuf;
use std::sync::Arc;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::Emitter;
use tauri::State;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[cfg(any(target_os = "macos", target_os = "ios"))]
const SQL_FILE_OPENED_EVENT: &str = "sql-file-opened";

struct AppState {
    client: Arc<Mutex<Option<SqlClient>>>,
    cancel_token: Arc<Mutex<Option<CancellationToken>>>,
}

#[derive(serde::Serialize)]
struct OpenedSqlFile {
    path: String,
    file_name: String,
    content: String,
}

fn extract_startup_sql_file_path() -> Option<String> {
    std::env::args_os().skip(1).find_map(|arg| {
        let path = PathBuf::from(arg);
        let is_sql = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("sql"))
            .unwrap_or(false);

        if is_sql && path.exists() {
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
    let is_sql = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("sql"))
        .unwrap_or(false);

    if !is_sql {
        return Err("Only .sql files are supported".to_string());
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

    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create directory '{}': {}", parent.display(), err))?;
    }

    std::fs::write(&file_path, &content)
        .map_err(|err| format!("Failed to write SQL file '{}': {}", path, err))?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    let folder = PathBuf::from(&path);
    if !folder.exists() {
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
fn get_documents_folder() -> Result<String, String> {
    let docs_dir =
        dirs::document_dir().ok_or_else(|| "Failed to get Documents folder".to_string())?;
    Ok(docs_dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn connect_to_server(
    state: State<'_, AppState>,
    config: ConnectionConfig,
    save_connection: Option<String>,
    remember_password: bool,
    keep_logged_in: bool,
) -> Result<String, String> {
    let mut settings = settings::load_settings();

    let cached_port = save_connection
        .as_ref()
        .and_then(|name| settings.connections.iter().find(|c| &c.name == name))
        .and_then(|c| c.cached_port);

    let (client, resolved_port) = db::connect(&config, cached_port).await?;
    let mut settings_changed = false;

    if let Some(name) = &save_connection {
        let mut save_config = config.clone();

        if remember_password {
            if let Some(pass) = &save_config.password {
                settings::store_password(name, pass).ok();
            }
        }
        save_config.password = None;

        if let Some(existing) = settings.connections.iter_mut().find(|c| &c.name == name) {
            existing.config = save_config;
            existing.cached_port = resolved_port;
        } else {
            settings.connections.push(SavedConnection {
                name: name.clone(),
                config: save_config,
                cached_port: resolved_port,
            });
        }
        settings.last_connection = Some(name.clone());
        settings_changed = true;
    }

    if settings.keep_logged_in != keep_logged_in {
        settings.keep_logged_in = keep_logged_in;
        settings_changed = true;
    }

    if settings_changed {
        settings::save_settings(&settings)?;
    }

    let mut lock = state.client.lock().await;
    *lock = Some(client);

    Ok("Connected".to_string())
}

#[tauri::command]
async fn disconnect_from_server(state: State<'_, AppState>) -> Result<(), String> {
    let mut lock = state.client.lock().await;
    *lock = None;
    Ok(())
}

#[tauri::command]
async fn execute_query(state: State<'_, AppState>, sql: String) -> Result<QueryResult, String> {
    let token = CancellationToken::new();
    {
        let mut cancel_lock = state.cancel_token.lock().await;
        *cancel_lock = Some(token.clone());
    }

    let result = {
        let mut lock = state.client.lock().await;
        let client = lock
            .as_mut()
            .ok_or("Not connected to a server".to_string())?;

        tokio::select! {
            res = db::execute_query(client, &sql) => res,
            _ = token.cancelled() => Err("Query cancelled by user".to_string()),
        }
    };

    {
        let mut cancel_lock = state.cancel_token.lock().await;
        *cancel_lock = None;
    }

    result
}

#[tauri::command]
async fn cancel_query(state: State<'_, AppState>) -> Result<(), String> {
    let mut cancel_lock = state.cancel_token.lock().await;
    if let Some(token) = cancel_lock.take() {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
async fn get_databases(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut lock = state.client.lock().await;
    let client = lock
        .as_mut()
        .ok_or("Not connected to a server".to_string())?;
    db::get_databases(client).await
}

#[tauri::command]
async fn get_tables(
    state: State<'_, AppState>,
    database: String,
) -> Result<Vec<DatabaseObject>, String> {
    let mut lock = state.client.lock().await;
    let client = lock
        .as_mut()
        .ok_or("Not connected to a server".to_string())?;
    db::get_tables(client, &database).await
}

#[tauri::command]
async fn get_columns(
    state: State<'_, AppState>,
    database: String,
    schema: String,
    table: String,
) -> Result<Vec<ColumnInfo>, String> {
    let mut lock = state.client.lock().await;
    let client = lock
        .as_mut()
        .ok_or("Not connected to a server".to_string())?;
    db::get_columns(client, &database, &schema, &table).await
}

#[tauri::command]
async fn load_connections() -> Result<AppSettings, String> {
    Ok(settings::load_settings())
}

#[tauri::command]
async fn load_saved_password(connection_name: String) -> Result<Option<String>, String> {
    Ok(settings::load_password(&connection_name))
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

    let mut settings = settings::load_settings();

    if !settings.keep_logged_in {
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
    let config = ConnectionConfig {
        password,
        ..saved.config
    };

    let (mut client, resolved_port) = match tokio::time::timeout(
        std::time::Duration::from_secs(10),
        db::connect(&config, saved.cached_port),
    )
    .await
    {
        Ok(Ok(result)) => result,
        _ => return Ok(not_connected),
    };

    // Cache resolved port for faster reconnects
    if resolved_port != saved.cached_port {
        if let Some(conn) = settings.connections.iter_mut().find(|c| c.name == last_name) {
            conn.cached_port = resolved_port;
            settings::save_settings(&settings).ok();
        }
    }

    let databases = db::get_databases(&mut client).await.unwrap_or_default();

    let mut lock = state.client.lock().await;
    *lock = Some(client);

    Ok(AutoConnectResult {
        connected: true,
        server: Some(config.server),
        database: config.database,
        databases,
    })
}

#[tauri::command]
async fn change_database(state: State<'_, AppState>, database: String) -> Result<(), String> {
    let mut lock = state.client.lock().await;
    let client = lock
        .as_mut()
        .ok_or("Not connected to a server".to_string())?;
    let sql = format!("USE [{}]", database.replace(']', "]]"));
    client
        .execute(&sql, &[])
        .await
        .map_err(|e| format!("Failed to change database: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn generate_sql_completion(
    state: State<'_, AppState>,
) -> Result<(Option<String>, String), String> {
    let mut client_lock = state.client.lock().await;
    if let Some(client) = client_lock.as_mut() {
        Ok((
            db::get_current_database_name(client).await?,
            db::get_schema_summary(client).await.unwrap_or_default(),
        ))
    } else {
        Ok((None, String::new()))
    }
}

#[tauri::command]
async fn get_indexes(
    state: State<'_, AppState>,
    database: String,
    schema: String,
    table: String,
) -> Result<String, String> {
    let mut lock = state.client.lock().await;
    let client = lock
        .as_mut()
        .ok_or("Not connected to a server".to_string())?;
    db::get_indexes(client, &database, &schema, &table).await
}

#[tauri::command]
async fn get_foreign_keys(
    state: State<'_, AppState>,
    database: String,
    schema: String,
    table: String,
) -> Result<String, String> {
    let mut lock = state.client.lock().await;
    let client = lock
        .as_mut()
        .ok_or("Not connected to a server".to_string())?;
    db::get_foreign_keys(client, &database, &schema, &table).await
}

#[tauri::command]
async fn generate_create_script(
    state: State<'_, AppState>,
    database: String,
    schema: String,
    table: String,
) -> Result<String, String> {
    let mut lock = state.client.lock().await;
    let client = lock
        .as_mut()
        .ok_or("Not connected to a server".to_string())?;
    db::generate_create_script(client, &database, &schema, &table).await
}

#[tauri::command]
async fn get_object_definition(
    state: State<'_, AppState>,
    database: String,
    schema: String,
    name: String,
) -> Result<String, String> {
    let mut lock = state.client.lock().await;
    let client = lock
        .as_mut()
        .ok_or("Not connected to a server".to_string())?;
    db::get_object_definition(client, &database, &schema, &name).await
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn set_mica_theme(window: tauri::WebviewWindow, dark: bool) -> Result<(), String> {
    use tauri::Manager;
    use windows::Win32::Foundation::{BOOL, HWND};
    use windows::Win32::Graphics::Dwm::DwmSetWindowAttribute;

    let native_window = window.get_webview_window("main")
        .ok_or("Window not found")?;
    let hwnd = native_window.hwnd().map_err(|e| e.to_string())?;
    let value = BOOL::from(dark);

    unsafe {
        // DWMWA_USE_IMMERSIVE_DARK_MODE = 20
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

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn set_mica_theme(_window: tauri::WebviewWindow, _dark: bool) -> Result<(), String> {
    Ok(())
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

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            client: Arc::new(Mutex::new(None)),
            cancel_token: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            connect_to_server,
            disconnect_from_server,
            execute_query,
            cancel_query,
            get_databases,
            get_tables,
            get_columns,
            get_indexes,
            get_foreign_keys,
            get_object_definition,
            generate_create_script,
            load_connections,
            load_saved_password,
            try_auto_connect,
            change_database,
            generate_sql_completion,
            get_startup_sql_file_path,
            read_sql_file,
            write_sql_file,
            get_documents_folder,
            open_folder,
            set_mica_theme,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    app.run(|app_handle, event| {
        if let tauri::RunEvent::Opened { urls } = event {
            for url in urls {
                let Ok(path) = url.to_file_path() else {
                    continue;
                };

                let is_sql = path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| ext.eq_ignore_ascii_case("sql"))
                    .unwrap_or(false);

                if is_sql {
                    let _ =
                        app_handle.emit(SQL_FILE_OPENED_EVENT, path.to_string_lossy().to_string());
                }
            }
        }
    });

    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    app.run(|_, _| {});
}
