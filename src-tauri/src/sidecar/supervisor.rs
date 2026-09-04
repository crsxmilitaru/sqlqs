use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use super::rpc::{JsonRpcClient, RpcError};

const TARGET_TRIPLE: &str = env!("SQLQS_TARGET_TRIPLE");
const BINARY_BASENAME: &str = "Sqlqs.Sidecar.Host";
const DEBUG_TFM: &str = "net10.0";

#[derive(Debug, thiserror::Error)]
pub enum SupervisorError {
    #[error("sidecar binary not found (tried env SQLQS_SIDECAR_PATH and {searched:?})")]
    BinaryNotFound { searched: Vec<PathBuf> },

    #[error("sidecar spawn failed: {0}")]
    Spawn(#[from] std::io::Error),

    #[error("sidecar rpc error: {0}")]
    Rpc(#[from] RpcError),
}

pub struct SidecarHandle {
    child: Mutex<Child>,
    rpc: Arc<JsonRpcClient>,
    binary_path: PathBuf,
}

impl SidecarHandle {
    pub fn rpc(&self) -> Arc<JsonRpcClient> {
        Arc::clone(&self.rpc)
    }

    pub fn binary_path(&self) -> &Path {
        &self.binary_path
    }

    pub async fn ping(&self) -> Result<PingResponse, RpcError> {
        let empty = serde_json::json!({});
        self.rpc.call("health.ping", &empty).await
    }

    /// Returns `false` once the child process has exited so callers can respawn.
    /// Reaps the child via `try_wait` when it has already terminated.
    pub async fn is_alive(&self) -> bool {
        let mut child = self.child.lock().await;
        !matches!(child.try_wait(), Ok(Some(_)) | Err(_))
    }

    pub async fn shutdown(&self) {
        self.rpc.shutdown().await;
        let mut child = self.child.lock().await;
        let _ = child.start_kill();
        let _ = tokio::time::timeout(std::time::Duration::from_secs(2), child.wait()).await;
    }
}

pub struct SidecarSupervisor;

impl SidecarSupervisor {
    pub async fn spawn() -> Result<SidecarHandle, SupervisorError> {
        let binary_path = resolve_binary_path()?;
        spawn_at(&binary_path).await
    }
}

async fn spawn_at(binary_path: &Path) -> Result<SidecarHandle, SupervisorError> {
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new(binary_path);
        c.creation_flags(0x08000000);
        c
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = Command::new(binary_path);

    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| std::io::Error::other("sidecar child has no stdin"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| std::io::Error::other("sidecar child has no stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| std::io::Error::other("sidecar child has no stderr"))?;

    tokio::spawn(forward_stderr(stderr));

    let rpc = JsonRpcClient::spawn(BufReader::new(stdout), stdin);

    Ok(SidecarHandle {
        child: Mutex::new(child),
        rpc,
        binary_path: binary_path.to_path_buf(),
    })
}

async fn forward_stderr(stderr: tokio::process::ChildStderr) {
    let mut reader = BufReader::new(stderr).lines();
    loop {
        match reader.next_line().await {
            Ok(Some(line)) => eprintln!("[sidecar.err] {line}"),
            Ok(None) => return,
            Err(err) => {
                eprintln!("[sidecar.err] reader error: {err}");
                return;
            }
        }
    }
}

fn resolve_binary_path() -> Result<PathBuf, SupervisorError> {
    if let Ok(env_path) = std::env::var("SQLQS_SIDECAR_PATH") {
        let path = PathBuf::from(env_path);
        if path.is_file() {
            return Ok(path);
        }
        return Err(SupervisorError::BinaryNotFound {
            searched: vec![path],
        });
    }

    let ext = if cfg!(windows) { ".exe" } else { "" };
    let mut tried: Vec<PathBuf> = Vec::new();

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            #[cfg(debug_assertions)]
            {
                for up in [1, 2, 3, 4, 5] {
                    let mut search = exe_dir.to_path_buf();
                    for _ in 0..up {
                        if !search.pop() {
                            break;
                        }
                    }
                    let debug = search
                        .join("sidecar")
                        .join("src")
                        .join(BINARY_BASENAME)
                        .join("bin")
                        .join("Debug")
                        .join(DEBUG_TFM)
                        .join(format!("{BINARY_BASENAME}{ext}"));
                    if debug.is_file() {
                        return Ok(debug);
                    }
                    tried.push(debug);
                }
            }

            let bundled = exe_dir
                .join("sidecar")
                .join("bin")
                .join(format!("{BINARY_BASENAME}{ext}"));
            if bundled.is_file() {
                return Ok(bundled);
            }
            tried.push(bundled);

            let bundled_suffixed = exe_dir
                .join("sidecar")
                .join("bin")
                .join(format!("{BINARY_BASENAME}-{TARGET_TRIPLE}{ext}"));
            if bundled_suffixed.is_file() {
                return Ok(bundled_suffixed);
            }
            tried.push(bundled_suffixed);

            let production = exe_dir.join(format!("{BINARY_BASENAME}-{TARGET_TRIPLE}{ext}"));
            if production.is_file() {
                return Ok(production);
            }
            tried.push(production);

            let production_unsuffixed = exe_dir.join(format!("{BINARY_BASENAME}{ext}"));
            if production_unsuffixed.is_file() {
                return Ok(production_unsuffixed);
            }
            tried.push(production_unsuffixed);

            for up in [1, 2, 3, 4, 5] {
                let mut search = exe_dir.to_path_buf();
                for _ in 0..up {
                    if !search.pop() {
                        break;
                    }
                }
                #[cfg(not(debug_assertions))]
                {
                    let debug = search
                        .join("sidecar")
                        .join("src")
                        .join(BINARY_BASENAME)
                        .join("bin")
                        .join("Debug")
                        .join(DEBUG_TFM)
                        .join(format!("{BINARY_BASENAME}{ext}"));
                    if debug.is_file() {
                        return Ok(debug);
                    }
                    tried.push(debug);
                }

                let dev = search
                    .join("sidecar")
                    .join("bin")
                    .join(format!("{BINARY_BASENAME}-{TARGET_TRIPLE}{ext}"));
                if dev.is_file() {
                    return Ok(dev);
                }
                tried.push(dev);
            }
        }
    }

    Err(SupervisorError::BinaryNotFound { searched: tried })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResponse {
    pub sidecar_version: String,
    pub protocol_version: u32,
    pub runtime_description: String,
    pub process_id: i64,
    pub uptime_milliseconds: i64,
}
