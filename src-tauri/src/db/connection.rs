use socket2::{SockRef, TcpKeepalive};
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;
use tiberius::error::Error as TiberiusError;
use tiberius::{AuthMethod, Client, Config, EncryptionLevel, SqlBrowser};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

use super::types::ConnectionConfig;

pub enum TransportStream {
    Tcp(TcpStream),
    #[cfg(windows)]
    NamedPipe(tokio::net::windows::named_pipe::NamedPipeClient),
}

impl AsyncRead for TransportStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            TransportStream::Tcp(s) => Pin::new(s).poll_read(cx, buf),
            #[cfg(windows)]
            TransportStream::NamedPipe(s) => Pin::new(s).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for TransportStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        match self.get_mut() {
            TransportStream::Tcp(s) => Pin::new(s).poll_write(cx, buf),
            #[cfg(windows)]
            TransportStream::NamedPipe(s) => Pin::new(s).poll_write(cx, buf),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            TransportStream::Tcp(s) => Pin::new(s).poll_flush(cx),
            #[cfg(windows)]
            TransportStream::NamedPipe(s) => Pin::new(s).poll_flush(cx),
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            TransportStream::Tcp(s) => Pin::new(s).poll_shutdown(cx),
            #[cfg(windows)]
            TransportStream::NamedPipe(s) => Pin::new(s).poll_shutdown(cx),
        }
    }
}

pub type SqlClient = Client<Compat<TransportStream>>;

pub fn is_connection_lost_error(error: &TiberiusError) -> bool {
    matches!(
        error,
        TiberiusError::Io { kind, .. }
            if matches!(
                *kind,
                std::io::ErrorKind::ConnectionReset
                    | std::io::ErrorKind::ConnectionAborted
                    | std::io::ErrorKind::BrokenPipe
                    | std::io::ErrorKind::UnexpectedEof
            )
    )
}

fn configure_tcp_stream(tcp: &TcpStream) {
    tcp.set_nodelay(true).ok();

    let keepalive = TcpKeepalive::new()
        .with_time(Duration::from_secs(60))
        .with_interval(Duration::from_secs(30));
    SockRef::from(tcp).set_tcp_keepalive(&keepalive).ok();
}

fn parse_server(server: &str) -> (String, Option<String>, Option<u16>) {
    let (addr, explicit_port) = if let Some(idx) = server.rfind(',') {
        let port = server[idx + 1..].trim().parse::<u16>().ok();
        (&server[..idx], port)
    } else {
        (server, None)
    };

    let (host, instance) = if let Some(idx) = addr.find('\\') {
        (
            addr[..idx].trim().to_string(),
            Some(addr[idx + 1..].trim().to_string()),
        )
    } else {
        (addr.trim().to_string(), None)
    };

    (host, instance, explicit_port)
}

#[cfg(windows)]
fn is_local_sql_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host.eq_ignore_ascii_case("(local)")
        || host == "."
        || host == "127.0.0.1"
        || host == "::1"
}

#[cfg(windows)]
fn build_named_pipe_path(host: &str, instance: Option<&str>) -> String {
    let pipe_suffix = match instance {
        Some(inst) => format!(r"pipe\MSSQL${}\sql\query", inst),
        None => r"pipe\sql\query".to_string(),
    };

    if is_local_sql_host(host) {
        format!(r"\\.\{}", pipe_suffix)
    } else {
        format!(r"\\{}\{}", host, pipe_suffix)
    }
}

#[cfg(windows)]
async fn try_named_pipe_connection(
    tib_config: &Config,
    host: &str,
    instance: Option<&str>,
) -> Result<Option<SqlClient>, String> {
    let pipe_name = build_named_pipe_path(host, instance);

    let pipe = match tokio::net::windows::named_pipe::ClientOptions::new().open(&pipe_name) {
        Ok(pipe) => pipe,
        Err(_) => return Ok(None),
    };

    let stream = TransportStream::NamedPipe(pipe);
    let mut client = Client::connect(tib_config.clone(), stream.compat_write())
        .await
        .map_err(|e| {
            format!(
                "SQL Server named pipe connection failed for '{}': {}",
                pipe_name, e
            )
        })?;
    init_session(&mut client).await?;
    Ok(Some(client))
}

fn split_connection_string_parts(conn_str: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;

    for ch in conn_str.chars() {
        match quote {
            Some(q) if ch == q => {
                quote = None;
                current.push(ch);
            }
            Some(_) => current.push(ch),
            None if ch == '\'' || ch == '"' => {
                quote = Some(ch);
                current.push(ch);
            }
            None if ch == ';' => {
                parts.push(current.trim().to_string());
                current.clear();
            }
            None => current.push(ch),
        }
    }

    if !current.is_empty() || conn_str.ends_with(';') {
        parts.push(current.trim().to_string());
    }

    parts
}

fn unquote_connection_string_value(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let first = trimmed.chars().next();
        let last = trimmed.chars().last();
        if matches!(
            (first, last),
            (Some('"'), Some('"')) | (Some('\''), Some('\''))
        ) {
            return trimmed[1..trimmed.len() - 1].to_string();
        }
    }
    trimmed.to_string()
}

pub fn parse_connection_string(conn_str: &str) -> Result<ConnectionConfig, String> {
    let mut config = ConnectionConfig::default();
    let mut pairs: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    for part in split_connection_string_parts(conn_str) {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((key, value)) = part.split_once('=') {
            pairs.insert(
                key.trim().to_lowercase(),
                unquote_connection_string_value(value),
            );
        }
    }

    let server = pairs
        .remove("server")
        .or_else(|| pairs.remove("data source"))
        .or_else(|| pairs.remove("addr"))
        .or_else(|| pairs.remove("address"))
        .or_else(|| pairs.remove("network address"))
        .or_else(|| pairs.remove("datasource"))
        .ok_or_else(|| {
            "Connection string must contain a 'Server' or 'Data Source' key".to_string()
        })?;

    config.server = if matches!(server.get(..4), Some(prefix) if prefix.eq_ignore_ascii_case("tcp:"))
    {
        server.get(4..).unwrap_or_default().to_string()
    } else {
        server
    };

    if let Some(port) = pairs.remove("port") {
        config.port = Some(
            port.parse::<u16>()
                .map_err(|e| format!("Invalid port '{}': {}", port, e))?,
        );
    }

    if let Some(db) = pairs
        .remove("database")
        .or_else(|| pairs.remove("initial catalog"))
        .or_else(|| pairs.remove("catalog"))
    {
        if !db.is_empty() {
            config.database = Some(db);
        }
    }

    let user = pairs
        .remove("user id")
        .or_else(|| pairs.remove("uid"))
        .or_else(|| pairs.remove("user"))
        .or_else(|| pairs.remove("username"));

    let pass = pairs.remove("password").or_else(|| pairs.remove("pwd"));

    let integrated = pairs
        .remove("integrated security")
        .or_else(|| pairs.remove("trusted_connection"))
        .or_else(|| pairs.remove("trusted"));

    let use_integrated = integrated
        .as_deref()
        .map(|v| {
            v.eq_ignore_ascii_case("sspi")
                || v.eq_ignore_ascii_case("true")
                || v.eq_ignore_ascii_case("yes")
                || v == "1"
        })
        .unwrap_or(false);

    if use_integrated {
        config.use_windows_auth = true;
    } else if let Some(u) = user {
        config.username = Some(u);
        config.password = pass;
    } else if let Some(p) = pass {
        config.username = Some(String::new());
        config.password = Some(p);
    }

    if let Some(encrypt) = pairs.remove("encrypt") {
        config.encrypt = encrypt.eq_ignore_ascii_case("true")
            || encrypt.eq_ignore_ascii_case("yes")
            || encrypt == "1"
            || encrypt.eq_ignore_ascii_case("strict");
    }

    if let Some(trust) = pairs
        .remove("trustservercertificate")
        .or_else(|| pairs.remove("trust server certificate"))
    {
        config.trust_server_certificate =
            trust.eq_ignore_ascii_case("true") || trust.eq_ignore_ascii_case("yes") || trust == "1";
    }

    config.connection_string = Some(conn_str.to_string());
    Ok(config)
}

pub fn strip_password_from_connection_string(conn_str: &str) -> String {
    split_connection_string_parts(conn_str)
        .into_iter()
        .filter_map(|part| {
            let trimmed = part.trim();
            if trimmed.is_empty() {
                return None;
            }

            let key = trimmed
                .split_once('=')
                .map(|(key, _)| key.trim().to_ascii_lowercase());

            match key.as_deref() {
                Some("password") | Some("pwd") => None,
                _ => Some(trimmed.to_string()),
            }
        })
        .collect::<Vec<_>>()
        .join(";")
}

pub async fn connect(
    config: &ConnectionConfig,
    cached_port: Option<u16>,
) -> Result<(SqlClient, Option<u16>), String> {
    let (host, instance, parsed_port) = parse_server(&config.server);

    let mut tib_config = Config::new();
    tib_config.host(&host);

    let port = parsed_port.unwrap_or_else(|| {
        config
            .port
            .unwrap_or(if instance.is_some() { 1434 } else { 1433 })
    });
    tib_config.port(port);

    if let Some(inst) = &instance {
        tib_config.instance_name(inst);
    }

    if let Some(db) = &config.database {
        if !db.is_empty() {
            tib_config.database(db);
        }
    }

    if config.use_windows_auth {
        #[cfg(windows)]
        tib_config.authentication(AuthMethod::Integrated);
        #[cfg(not(windows))]
        return Err("Windows authentication is only supported on Windows".to_string());
    } else {
        let user = config.username.as_deref().unwrap_or("");
        let pass = config.password.as_deref().unwrap_or("");
        tib_config.authentication(AuthMethod::sql_server(user, pass));
    }

    if config.trust_server_certificate {
        tib_config.trust_cert();
    }
    tib_config.encryption(if config.encrypt {
        EncryptionLevel::Required
    } else {
        EncryptionLevel::Off
    });

    tib_config.application_name("SQLQueryStudio");

    #[cfg(windows)]
    {
        if is_local_sql_host(&host) {
            if let Some(client) =
                try_named_pipe_connection(&tib_config, &host, instance.as_deref()).await?
            {
                return Ok((client, None));
            }
        }
    }

    if instance.is_some() {
        if let Some(cached) = cached_port {
            if let Ok(tcp) = TcpStream::connect(format!("{}:{}", host, cached)).await {
                configure_tcp_stream(&tcp);
                let stream = TransportStream::Tcp(tcp);
                let mut direct_config = tib_config.clone();
                direct_config.port(cached);
                if let Ok(mut client) = Client::connect(direct_config, stream.compat_write()).await
                {
                    init_session(&mut client).await?;
                    return Ok((client, Some(cached)));
                }
            }
        }
    }

    let tcp = if instance.is_some() {
        TcpStream::connect_named(&tib_config)
            .await
            .map_err(|e| e.to_string())
    } else {
        TcpStream::connect(tib_config.get_addr())
            .await
            .map_err(|e| e.to_string())
    };

    let tcp = match tcp {
        Ok(tcp) => tcp,
        Err(err) => {
            #[cfg(windows)]
            {
                // Only fall back to named pipes for remote, named instances when the
                // TCP failure looks like "TCP listener unavailable" — i.e. SQL Browser
                // couldn't resolve the instance, or the resolved port refused the
                // connection. For DNS failures or generic timeouts the named-pipe path
                // would also fail (and slowly), so we skip it.
                if instance.is_some() && !is_local_sql_host(&host) {
                    let lower = err.to_ascii_lowercase();
                    let should_try_pipe = lower.contains("refused")
                        || lower.contains("10061")
                        || lower.contains("could not be made")
                        || lower.contains("instance")
                        || lower.contains("browser");
                    if should_try_pipe {
                        let pipe_attempt = tokio::time::timeout(
                            std::time::Duration::from_secs(3),
                            try_named_pipe_connection(&tib_config, &host, instance.as_deref()),
                        )
                        .await;
                        if let Ok(Ok(Some(client))) = pipe_attempt {
                            return Ok((client, None));
                        }
                    }
                }
            }

            return Err(format!(
                "TCP connection to '{}:{}' failed: {}",
                host, port, err
            ));
        }
    };

    let resolved_port = tcp.peer_addr().ok().map(|a| a.port());
    configure_tcp_stream(&tcp);
    let stream = TransportStream::Tcp(tcp);

    let mut client = Client::connect(tib_config, stream.compat_write())
        .await
        .map_err(|e| format!("SQL Server connection failed: {}", e))?;

    init_session(&mut client).await?;
    Ok((client, resolved_port))
}

/// Send the same SET options SSMS sends when opening a new connection.
/// These persist for the lifetime of the connection.
async fn init_session(client: &mut SqlClient) -> Result<(), String> {
    client
        .simple_query(concat!(
            "SET ANSI_NULLS ON;",
            "SET ANSI_PADDING ON;",
            "SET ANSI_WARNINGS ON;",
            "SET ARITHABORT ON;",
            "SET CONCAT_NULL_YIELDS_NULL ON;",
            "SET NUMERIC_ROUNDABORT OFF;",
            "SET QUOTED_IDENTIFIER ON;",
            "SET TEXTSIZE 2147483647;",
        ))
        .await
        .map_err(|e| format!("Failed to initialize session: {}", e))?
        .into_results()
        .await
        .map_err(|e| format!("Failed to initialize session: {}", e))?;
    Ok(())
}

pub async fn ping_connection(client: &mut SqlClient) -> Result<(), TiberiusError> {
    client
        .simple_query("SELECT 1")
        .await?
        .into_results()
        .await?;
    Ok(())
}
