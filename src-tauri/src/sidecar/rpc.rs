use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{oneshot, Mutex};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use super::transport::{read_frame, write_frame};

const JSONRPC_VERSION: &str = "2.0";

#[derive(Debug, thiserror::Error)]
pub enum RpcError {
    #[error("sidecar transport error: {0}")]
    Transport(#[from] std::io::Error),

    #[error("sidecar protocol error: {0}")]
    Protocol(String),

    #[error("sidecar method `{method}` returned error {code}: {message}")]
    Server {
        method: String,
        code: i64,
        message: String,
        data: Option<Value>,
    },

    #[error("sidecar disconnected before response (method `{0}`)")]
    Disconnected(String),

    #[error("sidecar serialization error: {0}")]
    Serde(#[from] serde_json::Error),
}

impl RpcError {
    pub fn query_message(&self) -> String {
        let message = match self {
            Self::Server { message, .. } => message.as_str(),
            _ => return self.to_string(),
        };

        let lower_message = message.to_ascii_lowercase();
        let statistics_start = lower_message
            .find("sql server parse and compile time:")
            .or_else(|| lower_message.find("sql server execution times:"));

        statistics_start
            .map(|index| message[..index].trim_end().to_string())
            .unwrap_or_else(|| message.trim().to_string())
    }
}

struct PendingEntry {
    method: String,
    sender: oneshot::Sender<Result<Value, RpcError>>,
}

type Pending = Arc<Mutex<HashMap<u64, PendingEntry>>>;

pub struct JsonRpcClient {
    writer: Arc<Mutex<Box<dyn AsyncWrite + Send + Unpin>>>,
    pending: Pending,
    next_id: AtomicU64,
    reader_handle: Mutex<Option<JoinHandle<()>>>,
}

impl JsonRpcClient {
    pub fn spawn<R, W>(reader: R, writer: W) -> Arc<Self>
    where
        R: AsyncRead + Send + Unpin + 'static,
        W: AsyncWrite + Send + Unpin + 'static,
    {
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let writer: Arc<Mutex<Box<dyn AsyncWrite + Send + Unpin>>> =
            Arc::new(Mutex::new(Box::new(writer)));

        let pending_for_reader = pending.clone();
        let handle = tokio::spawn(async move {
            reader_loop(reader, pending_for_reader).await;
        });

        Arc::new(Self {
            writer,
            pending,
            next_id: AtomicU64::new(1),
            reader_handle: Mutex::new(Some(handle)),
        })
    }

    pub async fn call<P, R>(&self, method: &str, params: &P) -> Result<R, RpcError>
    where
        P: Serialize,
        R: DeserializeOwned,
    {
        self.call_inner(method, params, None).await
    }

    pub async fn call_with_cancel<P, R>(
        &self,
        method: &str,
        params: &P,
        cancel: CancellationToken,
    ) -> Result<R, RpcError>
    where
        P: Serialize,
        R: DeserializeOwned,
    {
        self.call_inner(method, params, Some(cancel)).await
    }

    async fn call_inner<P, R>(
        &self,
        method: &str,
        params: &P,
        cancel: Option<CancellationToken>,
    ) -> Result<R, RpcError>
    where
        P: Serialize,
        R: DeserializeOwned,
    {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let request = json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": id,
            "method": method,
            "params": params,
        });

        let payload = serde_json::to_vec(&request)?;
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(
            id,
            PendingEntry {
                method: method.to_string(),
                sender: tx,
            },
        );

        {
            let mut writer = self.writer.lock().await;
            if let Err(err) = write_frame(writer.as_mut(), &payload).await {
                self.pending.lock().await.remove(&id);
                return Err(RpcError::Transport(err));
            }
        }

        let cancel_watcher = cancel.map(|ct| {
            let writer = Arc::clone(&self.writer);
            tokio::spawn(async move {
                ct.cancelled().await;
                let cancel_msg = json!({
                    "jsonrpc": JSONRPC_VERSION,
                    "method": "$/cancelRequest",
                    "params": { "id": id },
                });
                if let Ok(bytes) = serde_json::to_vec(&cancel_msg) {
                    let mut w = writer.lock().await;
                    let _ = write_frame(w.as_mut(), &bytes).await;
                }
            })
        });

        let value = rx
            .await
            .map_err(|_| RpcError::Disconnected(method.to_string()))?;

        if let Some(handle) = cancel_watcher {
            handle.abort();
        }

        let parsed: R = serde_json::from_value(value?).map_err(RpcError::Serde)?;
        Ok(parsed)
    }

    pub async fn shutdown(&self) {
        let mut guard = self.reader_handle.lock().await;
        if let Some(handle) = guard.take() {
            handle.abort();
        }
        let mut pending = self.pending.lock().await;
        for (_, entry) in pending.drain() {
            let _ = entry
                .sender
                .send(Err(RpcError::Disconnected("shutdown".into())));
        }
    }
}

async fn reader_loop<R: AsyncRead + Unpin>(mut reader: R, pending: Pending) {
    loop {
        match read_frame(&mut reader).await {
            Ok(Some(frame)) => {
                if let Err(err) = dispatch_frame(&frame, &pending).await {
                    eprintln!("[sidecar] frame dispatch error: {err}");
                }
            }
            Ok(None) => {
                fail_all_pending(&pending, "sidecar stdout closed").await;
                return;
            }
            Err(err) => {
                eprintln!("[sidecar] reader loop error: {err}");
                fail_all_pending(&pending, "sidecar reader error").await;
                return;
            }
        }
    }
}

async fn dispatch_frame(frame: &[u8], pending: &Pending) -> Result<(), RpcError> {
    let value: Value = serde_json::from_slice(frame)?;

    let Some(id_value) = value.get("id") else {
        eprintln!(
            "[sidecar] received notification (ignored in Phase 0): {}",
            value
                .get("method")
                .and_then(|v| v.as_str())
                .unwrap_or("<no method>")
        );
        return Ok(());
    };

    let id = id_value
        .as_u64()
        .ok_or_else(|| RpcError::Protocol(format!("response id is not u64: {id_value}")))?;

    let entry = pending.lock().await.remove(&id);
    let Some(entry) = entry else {
        eprintln!("[sidecar] response for unknown id {id}");
        return Ok(());
    };

    if let Some(error) = value.get("error") {
        let code = error.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
        let message = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("")
            .to_string();
        let data = error.get("data").cloned();
        let _ = entry.sender.send(Err(RpcError::Server {
            method: entry.method,
            code,
            message,
            data,
        }));
    } else {
        let result = value.get("result").cloned().unwrap_or(Value::Null);
        let _ = entry.sender.send(Ok(result));
    }

    Ok(())
}

async fn fail_all_pending(pending: &Pending, reason: &str) {
    let mut pending = pending.lock().await;
    for (_, entry) in pending.drain() {
        let _ = entry
            .sender
            .send(Err(RpcError::Disconnected(reason.to_string())));
    }
}
