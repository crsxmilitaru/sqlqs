use futures_util::TryStreamExt;
use serde::{Deserialize, Serialize};
use std::pin::Pin;
use std::task::{Context, Poll};
use tiberius::{AuthMethod, Client, Config, EncryptionLevel, QueryItem, Row, SqlBrowser};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ConnectionConfig {
    pub server: String,
    pub port: Option<u16>,
    pub database: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub use_windows_auth: bool,
    pub encrypt: bool,
    pub trust_server_certificate: bool,
}

impl std::fmt::Debug for ConnectionConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConnectionConfig")
            .field("server", &self.server)
            .field("port", &self.port)
            .field("database", &self.database)
            .field("username", &self.username)
            .field("password", &self.password.as_ref().map(|_| "[REDACTED]"))
            .field("use_windows_auth", &self.use_windows_auth)
            .field("encrypt", &self.encrypt)
            .field("trust_server_certificate", &self.trust_server_certificate)
            .finish()
    }
}

impl Default for ConnectionConfig {
    fn default() -> Self {
        Self {
            server: String::new(),
            port: None,
            database: None,
            username: None,
            password: None,
            use_windows_auth: false,
            encrypt: false,
            trust_server_certificate: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub result_sets: Vec<ResultSet>,
    pub rows_affected: u64,
    pub messages: Vec<String>,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResultSet {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub type_name: String,
    pub is_identity: bool,
    pub is_nullable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseObject {
    pub name: String,
    pub schema_name: String,
    pub object_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DatabaseSchemaCatalogEntry {
    pub table_name: String,
    pub schema_name: String,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerDatabaseObject {
    pub database: String,
    pub name: String,
    pub schema_name: String,
    pub object_type: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ServerObjectIndexStatus {
    pub initialized: bool,
    pub indexing: bool,
    pub database_count: usize,
    pub processed_database_count: usize,
    pub failed_databases: Vec<String>,
    pub object_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerObjectSearchResponse {
    pub results: Vec<ServerDatabaseObject>,
    pub total_matches: usize,
    pub initialized: bool,
    pub indexing: bool,
    pub database_count: usize,
    pub processed_database_count: usize,
    pub failed_databases: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct CachedServerObjectIndex {
    pub initialized: bool,
    pub indexing: bool,
    pub database_count: usize,
    pub processed_database_count: usize,
    pub failed_databases: Vec<String>,
    objects: Vec<SearchableServerObject>,
}

#[derive(Debug, Clone)]
struct SearchableServerObject {
    object: ServerDatabaseObject,
    database_lower: String,
    schema_lower: String,
    name_lower: String,
    qualified_lower: String,
    database_qualified_lower: String,
    haystack_lower: String,
    type_rank: i32,
}

impl SearchableServerObject {
    fn new(database: String, object: DatabaseObject) -> Self {
        let database_lower = database.to_lowercase();
        let schema_lower = object.schema_name.to_lowercase();
        let name_lower = object.name.to_lowercase();
        let qualified_lower = format!("{}.{}", schema_lower, name_lower);
        let database_qualified_lower = format!("{}.{}", database_lower, qualified_lower);
        let haystack_lower = format!(
            "{} {} {} {} {}",
            database_lower,
            qualified_lower,
            name_lower,
            schema_lower,
            object_type_label(&object.object_type).to_lowercase()
        );
        let type_rank = object_type_rank(&object.object_type);

        Self {
            object: ServerDatabaseObject {
                database,
                name: object.name,
                schema_name: object.schema_name,
                object_type: object.object_type,
            },
            database_lower,
            schema_lower,
            name_lower,
            qualified_lower,
            database_qualified_lower,
            haystack_lower,
            type_rank,
        }
    }
}

impl CachedServerObjectIndex {
    pub fn start() -> Self {
        Self {
            initialized: true,
            indexing: true,
            ..Self::default()
        }
    }

    pub fn status(&self) -> ServerObjectIndexStatus {
        ServerObjectIndexStatus {
            initialized: self.initialized,
            indexing: self.indexing,
            database_count: self.database_count,
            processed_database_count: self.processed_database_count,
            failed_databases: self.failed_databases.clone(),
            object_count: self.objects.len(),
        }
    }

    pub fn set_database_count(&mut self, database_count: usize) {
        self.database_count = database_count;
    }

    pub fn add_database_objects(
        &mut self,
        database: String,
        database_objects: Vec<DatabaseObject>,
    ) {
        self.objects.extend(
            database_objects
                .into_iter()
                .map(|object| SearchableServerObject::new(database.clone(), object)),
        );
        self.processed_database_count += 1;
    }

    pub fn add_failed_database(&mut self, database: String) {
        self.failed_databases.push(database);
        self.processed_database_count += 1;
    }

    pub fn finish(&mut self) {
        self.indexing = false;
    }
}

fn object_type_label(object_type: &str) -> &'static str {
    match object_type {
        "TABLE" => "Table",
        "VIEW" => "View",
        "PROCEDURE" => "Procedure",
        "FUNCTION" => "Function",
        "TRIGGER" => "Trigger",
        "TYPE" => "Type",
        _ => "Object",
    }
}

fn object_type_rank(object_type: &str) -> i32 {
    match object_type {
        "TABLE" => 0,
        "VIEW" => 1,
        "PROCEDURE" => 2,
        "FUNCTION" => 3,
        "TRIGGER" => 4,
        "TYPE" => 5,
        _ => 99,
    }
}

fn get_object_search_score(
    object: &SearchableServerObject,
    terms: &[&str],
    preferred_database: Option<&str>,
) -> Option<i32> {
    let preferred_bonus = if preferred_database
        .map(|database| object.database_lower == database)
        .unwrap_or(false)
    {
        -20
    } else {
        0
    };

    if terms.is_empty() {
        return Some(object.type_rank + preferred_bonus);
    }

    let mut score = preferred_bonus;

    for term in terms {
        if term.is_empty() {
            continue;
        }

        if object.qualified_lower == *term
            || object.name_lower == *term
            || object.database_qualified_lower == *term
        {
            score -= 60;
            continue;
        }

        if object.name_lower.starts_with(term) {
            continue;
        }

        if object.qualified_lower.starts_with(term) {
            score += 8;
            continue;
        }

        if object.schema_lower.starts_with(term) {
            score += 16;
            continue;
        }

        if object.database_lower.starts_with(term) {
            score += 20;
            continue;
        }

        if let Some(index) = object.qualified_lower.find(term) {
            score += 28 + index as i32;
            continue;
        }

        if let Some(index) = object.haystack_lower.find(term) {
            score += 52 + index as i32;
            continue;
        }

        return None;
    }

    Some(score + object.type_rank)
}

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

/// Establishes connection to SQL Server.
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
        let is_local = host.eq_ignore_ascii_case("localhost") || host == "." || host == "127.0.0.1";
        if is_local {
            let pipe_name = match &instance {
                Some(inst) => format!(r"\\.\pipe\MSSQL${}\sql\query", inst),
                None => r"\\.\pipe\sql\query".to_string(),
            };
            if let Ok(pipe) = tokio::net::windows::named_pipe::ClientOptions::new().open(&pipe_name)
            {
                let stream = TransportStream::NamedPipe(pipe);
                let mut client = Client::connect(tib_config, stream.compat_write())
                    .await
                    .map_err(|e| format!("SQL Server connection failed: {}", e))?;
                init_session(&mut client).await?;
                return Ok((client, None));
            }
        }
    }

    if instance.is_some() {
        if let Some(cached) = cached_port {
            if let Ok(tcp) = TcpStream::connect(format!("{}:{}", host, cached)).await {
                tcp.set_nodelay(true).ok();
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
    }
    .map_err(|e| format!("TCP connection to '{}:{}' failed: {}", host, port, e))?;

    let resolved_port = tcp.peer_addr().ok().map(|a| a.port());
    tcp.set_nodelay(true).ok();
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

/// Split SQL text on GO batch separators, respecting strings, comments,
/// and `GO N` repeat counts — matching SSMS behavior.
fn split_batches(sql: &str) -> Vec<String> {
    let mut batches = Vec::new();
    let mut current_batch = String::new();
    let mut in_block_comment = false;

    for line in sql.lines() {
        if in_block_comment {
            if let Some(end) = line.find("*/") {
                let rest = &line[end + 2..];
                in_block_comment = rest.contains("/*");
            }
            if !current_batch.is_empty() {
                current_batch.push('\n');
            }
            current_batch.push_str(line);
            continue;
        }

        let trimmed = line.trim();

        let is_go = if trimmed.len() >= 2 && trimmed[..2].eq_ignore_ascii_case("go") {
            let after_go = trimmed[2..].trim();
            after_go.is_empty() || after_go.bytes().all(|b| b.is_ascii_digit())
        } else {
            false
        };

        if is_go {
            if !current_batch.trim().is_empty() {
                let repeat: usize = trimmed[2..].trim().parse().unwrap_or(1).max(1);
                for _ in 0..repeat {
                    batches.push(current_batch.clone());
                }
            }
            current_batch = String::new();
        } else {
            if !current_batch.is_empty() {
                current_batch.push('\n');
            }
            current_batch.push_str(line);

            let check = strip_strings_and_line_comments(line);
            let opens = check.matches("/*").count();
            let closes = check.matches("*/").count();
            if opens > closes {
                in_block_comment = true;
            }
        }
    }
    if !current_batch.trim().is_empty() {
        batches.push(current_batch);
    }
    batches
}

/// Remove string literals and single-line comments so we can safely
/// detect block comment boundaries without false positives.
fn strip_strings_and_line_comments(line: &str) -> String {
    let mut result = String::with_capacity(line.len());
    let bytes = line.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if i + 1 < len && bytes[i] == b'-' && bytes[i + 1] == b'-' {
            break;
        }
        if bytes[i] == b'\'' {
            i += 1;
            while i < len {
                if bytes[i] == b'\'' {
                    i += 1;
                    if i < len && bytes[i] == b'\'' {
                        i += 1;
                        continue;
                    }
                    break;
                }
                i += 1;
            }
            continue;
        }
        if bytes[i] == b'[' {
            i += 1;
            while i < len && bytes[i] != b']' {
                i += 1;
            }
            if i < len {
                i += 1;
            }
            continue;
        }
        result.push(bytes[i] as char);
        i += 1;
    }
    result
}

struct BatchResult {
    result_sets: Vec<ResultSet>,
    rows_affected: u64,
    messages: Vec<String>,
}

async fn execute_single_batch(client: &mut SqlClient, sql: &str) -> Result<BatchResult, String> {
    let mut result_sets = Vec::new();
    let mut current_columns = Vec::new();
    let mut current_rows = Vec::new();

    let mut stream = client
        .simple_query(sql)
        .await
        .map_err(|e| format!("{}", e))?;

    while let Some(item) = stream
        .try_next()
        .await
        .map_err(|e| format!("Error reading results: {}", e))?
    {
        match item {
            QueryItem::Metadata(meta) => {
                if !current_columns.is_empty() || !current_rows.is_empty() {
                    result_sets.push(ResultSet {
                        columns: current_columns,
                        rows: current_rows,
                    });
                    current_rows = Vec::new();
                }
                current_columns = meta
                    .columns()
                    .iter()
                    .map(|c| ColumnInfo {
                        name: c.name().to_string(),
                        type_name: format!("{:?}", c.column_type()),
                        is_identity: false,
                        is_nullable: true,
                    })
                    .collect();
            }
            QueryItem::Row(row) => {
                let row_data = extract_row(&row, current_columns.len());
                current_rows.push(row_data);
            }
        }
    }
    drop(stream);

    if !current_columns.is_empty() || !current_rows.is_empty() {
        result_sets.push(ResultSet {
            columns: current_columns,
            rows: current_rows,
        });
    }

    let mut messages = Vec::new();

    if result_sets.is_empty() {
        let rows = get_last_rowcount(client).await?;
        if rows > 0 {
            messages.push(format!("({} row(s) affected)", rows));
        } else {
            messages.push("Commands completed successfully.".to_string());
        }
        Ok(BatchResult {
            result_sets,
            rows_affected: rows,
            messages,
        })
    } else {
        let total: u64 = result_sets.iter().map(|rs| rs.rows.len() as u64).sum();
        for rs in &result_sets {
            messages.push(format!("({} row(s) affected)", rs.rows.len()));
        }
        Ok(BatchResult {
            result_sets,
            rows_affected: total,
            messages,
        })
    }
}

/// Executes SQL query (supports 'GO' batches).
pub async fn execute_query(client: &mut SqlClient, sql: &str) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    let batches = split_batches(sql);

    let mut all_result_sets = Vec::new();
    let mut total_rows_affected: u64 = 0;
    let mut all_messages = Vec::new();

    for (i, batch) in batches.iter().enumerate() {
        let result = execute_single_batch(client, batch).await.map_err(|e| {
            if batches.len() > 1 {
                format!("Batch {} failed: {}", i + 1, e)
            } else {
                format!("Query failed: {}", e)
            }
        })?;
        all_result_sets.extend(result.result_sets);
        total_rows_affected += result.rows_affected;
        all_messages.extend(result.messages);
    }

    Ok(QueryResult {
        result_sets: all_result_sets,
        rows_affected: total_rows_affected,
        messages: all_messages,
        elapsed_ms: start.elapsed().as_millis() as u64,
    })
}

async fn get_last_rowcount(client: &mut SqlClient) -> Result<u64, String> {
    let stream = client
        .query("SELECT CAST(@@ROWCOUNT AS BIGINT)", &[])
        .await
        .map_err(|e| format!("Failed to read @@ROWCOUNT: {}", e))?;

    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| format!("Failed to parse @@ROWCOUNT: {}", e))?;

    let affected = rows
        .first()
        .and_then(|r| r.try_get::<i64, _>(0).ok().flatten())
        .unwrap_or(0);

    Ok(affected.max(0) as u64)
}

fn extract_row(row: &Row, col_count: usize) -> Vec<serde_json::Value> {
    (0..col_count)
        .map(|i| {
            if let Some(val) = row.try_get::<&str, _>(i).ok().flatten() {
                serde_json::Value::String(val.to_string())
            } else if let Some(val) = row.try_get::<i32, _>(i).ok().flatten() {
                serde_json::json!(val)
            } else if let Some(val) = row.try_get::<i64, _>(i).ok().flatten() {
                serde_json::json!(val)
            } else if let Some(val) = row.try_get::<i16, _>(i).ok().flatten() {
                serde_json::json!(val)
            } else if let Some(val) = row.try_get::<f32, _>(i).ok().flatten() {
                serde_json::json!(val)
            } else if let Some(val) = row.try_get::<f64, _>(i).ok().flatten() {
                serde_json::json!(val)
            } else if let Some(val) = row.try_get::<bool, _>(i).ok().flatten() {
                serde_json::json!(val)
            } else if let Some(val) = row.try_get::<uuid::Uuid, _>(i).ok().flatten() {
                serde_json::Value::String(val.to_string())
            } else if let Some(val) = row.try_get::<chrono::NaiveDateTime, _>(i).ok().flatten() {
                serde_json::Value::String(val.format("%Y-%m-%d %H:%M:%S%.3f").to_string())
            } else if let Some(val) = row.try_get::<chrono::NaiveDate, _>(i).ok().flatten() {
                serde_json::Value::String(val.format("%Y-%m-%d").to_string())
            } else if let Some(val) = row.try_get::<chrono::NaiveTime, _>(i).ok().flatten() {
                serde_json::Value::String(val.format("%H:%M:%S%.3f").to_string())
            } else if let Some(val) = row.try_get::<&[u8], _>(i).ok().flatten() {
                let hex = val
                    .iter()
                    .map(|byte| format!("{:02X}", byte))
                    .collect::<String>();
                serde_json::Value::String(format!("0x{}", hex))
            } else if let Some(val) = row
                .try_get::<tiberius::numeric::Decimal, _>(i)
                .ok()
                .flatten()
            {
                let d: tiberius::numeric::Decimal = val;
                serde_json::Value::String(format!("{}", d))
            } else {
                serde_json::Value::Null
            }
        })
        .collect()
}

/// Lists server databases.
pub async fn get_databases(client: &mut SqlClient) -> Result<Vec<String>, String> {
    let sql = "SELECT name FROM sys.databases ORDER BY name";
    let stream = client
        .query(sql, &[])
        .await
        .map_err(|e| format!("Failed to list databases: {}", e))?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| format!("Failed to read databases: {}", e))?;

    Ok(rows
        .iter()
        .filter_map(|r| r.try_get::<&str, _>(0).ok().flatten().map(String::from))
        .collect())
}

/// Returns the names of identity columns for a given table (resolved from OBJECT_ID).
pub async fn get_identity_columns(
    client: &mut SqlClient,
    table_name: &str,
) -> Result<Vec<String>, String> {
    let sql = format!(
        "SELECT c.name FROM sys.columns c WHERE c.object_id = OBJECT_ID('{}') AND c.is_identity = 1",
        table_name.replace('\'', "''")
    );
    let stream = client
        .query(sql.as_str(), &[])
        .await
        .map_err(|e| format!("Failed to query identity columns: {}", e))?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| format!("Failed to read identity columns: {}", e))?;
    Ok(rows
        .iter()
        .filter_map(|r| r.try_get::<&str, _>(0).ok().flatten().map(String::from))
        .collect())
}

/// Returns the names of primary key columns for a given table (resolved from OBJECT_ID).
pub async fn get_primary_key_columns(
    client: &mut SqlClient,
    table_name: &str,
) -> Result<Vec<String>, String> {
    let sql = format!(
        "SELECT c.name \
         FROM sys.indexes i \
         JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id \
         JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id \
         WHERE i.object_id = OBJECT_ID('{}') AND i.is_primary_key = 1 \
         ORDER BY ic.key_ordinal",
        table_name.replace('\'', "''")
    );
    let stream = client
        .query(sql.as_str(), &[])
        .await
        .map_err(|e| format!("Failed to query primary key columns: {}", e))?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| format!("Failed to read primary key columns: {}", e))?;
    Ok(rows
        .iter()
        .filter_map(|r| r.try_get::<&str, _>(0).ok().flatten().map(String::from))
        .collect())
}

/// Gets active database name.
pub async fn get_current_database_name(client: &mut SqlClient) -> Result<Option<String>, String> {
    let stream = client
        .query("SELECT DB_NAME()", &[])
        .await
        .map_err(|e| format!("Failed to read current database: {}", e))?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| format!("Failed to parse current database: {}", e))?;

    Ok(rows
        .first()
        .and_then(|row| row.try_get::<&str, _>(0).ok().flatten().map(String::from)))
}

/// Generates schema summary for context.
pub async fn get_schema_summary(client: &mut SqlClient) -> Result<String, String> {
    let sql = r#"
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

    let stream = client
        .query(sql, &[])
        .await
        .map_err(|e| format!("Failed to build schema summary: {}", e))?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| format!("Failed to read schema summary: {}", e))?;

    let mut summary_lines: Vec<String> = Vec::new();
    let mut current_key = String::new();
    let mut current_object = String::new();
    let mut current_columns: Vec<String> = Vec::new();

    for row in rows {
        let schema = row.try_get::<&str, _>(0).ok().flatten().unwrap_or("dbo");
        let table = row.try_get::<&str, _>(1).ok().flatten().unwrap_or("");
        let object_type = row.try_get::<&str, _>(2).ok().flatten().unwrap_or("TABLE");
        let column_name = row.try_get::<&str, _>(3).ok().flatten();
        let data_type = row.try_get::<&str, _>(4).ok().flatten();
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
            current_object = object_type.to_string();
        }

        if let Some(column_name) = column_name {
            let type_name = data_type.unwrap_or("sql_variant");
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

    Ok(summary_lines.join("\n"))
}

/// Lists database objects.
pub async fn get_tables(
    client: &mut SqlClient,
    database: &str,
) -> Result<Vec<DatabaseObject>, String> {
    let db = database.replace(']', "]]");
    let sql = format!(
        "SELECT schema_name, object_name, object_type FROM ( \
           SELECT s.name AS schema_name, o.name AS object_name, \
             CASE o.type \
               WHEN 'U'  THEN 'TABLE' \
               WHEN 'V'  THEN 'VIEW' \
               WHEN 'P'  THEN 'PROCEDURE' \
               WHEN 'FN' THEN 'FUNCTION' \
               WHEN 'IF' THEN 'FUNCTION' \
               WHEN 'TF' THEN 'FUNCTION' \
               WHEN 'TR' THEN 'TRIGGER' \
             END AS object_type \
           FROM [{db}].sys.objects o \
           JOIN [{db}].sys.schemas s ON o.schema_id = s.schema_id \
           WHERE o.type IN ('U','V','P','FN','IF','TF','TR') \
           UNION ALL \
           SELECT s.name AS schema_name, t.name AS object_name, 'TYPE' AS object_type \
           FROM [{db}].sys.types t \
           JOIN [{db}].sys.schemas s ON t.schema_id = s.schema_id \
           WHERE t.is_user_defined = 1 \
         ) x ORDER BY object_type, schema_name, object_name",
        db = db
    );
    let stream = client
        .query(&sql, &[])
        .await
        .map_err(|e| format!("Failed to list objects: {}", e))?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| format!("Failed to read objects: {}", e))?;

    Ok(rows
        .iter()
        .filter_map(|r| {
            let schema = r.try_get::<&str, _>(0).ok().flatten()?;
            let name = r.try_get::<&str, _>(1).ok().flatten()?;
            let obj_type = r.try_get::<&str, _>(2).ok().flatten()?;
            Some(DatabaseObject {
                schema_name: schema.to_string(),
                name: name.to_string(),
                object_type: obj_type.to_string(),
            })
        })
        .collect())
}

pub fn search_server_objects(
    index: &CachedServerObjectIndex,
    query: &str,
    preferred_database: Option<&str>,
    limit: usize,
) -> ServerObjectSearchResponse {
    let normalized_query = query.trim().to_lowercase();
    let terms: Vec<&str> = normalized_query
        .split_whitespace()
        .filter(|term| !term.is_empty())
        .collect();
    let preferred_database = preferred_database.map(str::to_lowercase);
    let mut ranked: Vec<(i32, &SearchableServerObject)> = Vec::new();

    for object in &index.objects {
        if let Some(score) = get_object_search_score(object, &terms, preferred_database.as_deref())
        {
            ranked.push((score, object));
        }
    }

    ranked.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then(left.1.type_rank.cmp(&right.1.type_rank))
            .then(left.1.object.database.cmp(&right.1.object.database))
            .then(left.1.object.schema_name.cmp(&right.1.object.schema_name))
            .then(left.1.object.name.cmp(&right.1.object.name))
    });

    let total_matches = ranked.len();
    let results = ranked
        .into_iter()
        .take(limit)
        .map(|(_, object)| object.object.clone())
        .collect();

    ServerObjectSearchResponse {
        results,
        total_matches,
        initialized: index.initialized,
        indexing: index.indexing,
        database_count: index.database_count,
        processed_database_count: index.processed_database_count,
        failed_databases: index.failed_databases.clone(),
    }
}

/// Retrieves a table/view catalog with columns for editor autocomplete.
pub async fn get_database_schema_catalog(
    client: &mut SqlClient,
    database: &str,
) -> Result<Vec<DatabaseSchemaCatalogEntry>, String> {
    let sql = format!(
        "SELECT \
            s.name AS schema_name, \
            o.name AS object_name, \
            c.name AS column_name \
         FROM [{db}].sys.objects o \
         JOIN [{db}].sys.schemas s ON o.schema_id = s.schema_id \
         LEFT JOIN [{db}].sys.columns c ON o.object_id = c.object_id \
         WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0 \
         ORDER BY s.name, o.name, c.column_id",
        db = database.replace(']', "]]"),
    );

    let stream = client
        .query(&sql, &[])
        .await
        .map_err(|e| format!("Failed to load schema catalog: {}", e))?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| format!("Failed to read schema catalog: {}", e))?;

    let mut catalog: Vec<DatabaseSchemaCatalogEntry> = Vec::new();

    for row in &rows {
        let schema_name = row.try_get::<&str, _>(0).ok().flatten().unwrap_or("dbo");
        let table_name = row.try_get::<&str, _>(1).ok().flatten().unwrap_or("");
        let column_name = row.try_get::<&str, _>(2).ok().flatten();

        if table_name.is_empty() {
            continue;
        }

        let needs_new_entry = catalog
            .last()
            .map(|entry| entry.schema_name != schema_name || entry.table_name != table_name)
            .unwrap_or(true);

        if needs_new_entry {
            catalog.push(DatabaseSchemaCatalogEntry {
                table_name: table_name.to_string(),
                schema_name: schema_name.to_string(),
                columns: Vec::new(),
            });
        }

        if let Some(column_name) = column_name {
            if let Some(entry) = catalog.last_mut() {
                entry.columns.push(column_name.to_string());
            }
        }
    }

    Ok(catalog)
}

/// Retrieves column information for a specific table.
pub async fn get_columns(
    client: &mut SqlClient,
    database: &str,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    let sql = format!(
        "SELECT c.COLUMN_NAME, c.DATA_TYPE + CASE \
            WHEN c.CHARACTER_MAXIMUM_LENGTH IS NOT NULL THEN '(' + \
                CASE WHEN c.CHARACTER_MAXIMUM_LENGTH = -1 THEN 'max' \
                ELSE CAST(c.CHARACTER_MAXIMUM_LENGTH AS VARCHAR) END + ')' \
            WHEN c.DATA_TYPE IN ('decimal','numeric') THEN '(' + CAST(c.NUMERIC_PRECISION AS VARCHAR) + ',' + CAST(c.NUMERIC_SCALE AS VARCHAR) + ')' \
            ELSE '' END AS full_type, \
         COLUMNPROPERTY(OBJECT_ID('[{db}].[' + c.TABLE_SCHEMA + '].[' + c.TABLE_NAME + ']'), c.COLUMN_NAME, 'IsIdentity') AS is_identity, \
         CASE WHEN c.IS_NULLABLE = 'YES' THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS is_nullable \
         FROM [{db}].INFORMATION_SCHEMA.COLUMNS c \
         WHERE c.TABLE_SCHEMA = @P1 AND c.TABLE_NAME = @P2 \
         ORDER BY c.ORDINAL_POSITION",
        db = database.replace(']', "]]"),
    );
    let stream = client
        .query(&sql, &[&schema, &table])
        .await
        .map_err(|e| format!("Failed to list columns: {}", e))?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| format!("Failed to read columns: {}", e))?;

    Ok(rows
        .iter()
        .filter_map(|r| {
            let name = r.try_get::<&str, _>(0).ok().flatten()?;
            let type_name = r.try_get::<&str, _>(1).ok().flatten()?;
            let is_identity = r.try_get::<i32, _>(2).ok().flatten().unwrap_or(0) == 1;
            let is_nullable = r.try_get::<bool, _>(3).ok().flatten().unwrap_or(true);
            Some(ColumnInfo {
                name: name.to_string(),
                type_name: type_name.to_string(),
                is_identity,
                is_nullable,
            })
        })
        .collect())
}

/// Retrieves table column metadata using a table name resolved from OBJECT_ID.
pub async fn get_table_column_metadata(
    client: &mut SqlClient,
    table_name: &str,
) -> Result<Vec<ColumnInfo>, String> {
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
        table_name.replace('\'', "''")
    );
    let stream = client
        .query(sql.as_str(), &[])
        .await
        .map_err(|e| format!("Failed to query table column metadata: {}", e))?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| format!("Failed to read table column metadata: {}", e))?;

    Ok(rows
        .iter()
        .filter_map(|r| {
            let name = r.try_get::<&str, _>(0).ok().flatten()?;
            let type_name = r.try_get::<&str, _>(1).ok().flatten()?;
            let is_identity = r.try_get::<bool, _>(2).ok().flatten().unwrap_or(false);
            let is_nullable = r.try_get::<bool, _>(3).ok().flatten().unwrap_or(true);
            Some(ColumnInfo {
                name: name.to_string(),
                type_name: type_name.to_string(),
                is_identity,
                is_nullable,
            })
        })
        .collect())
}

/// Retrieves table indexes.
pub async fn get_indexes(
    client: &mut SqlClient,
    database: &str,
    schema: &str,
    table: &str,
) -> Result<String, String> {
    let sql = format!(
        "SELECT i.name AS index_name, \
         i.type_desc AS index_type, \
         i.is_unique, \
         i.is_primary_key, \
         STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns \
         FROM [{db}].sys.indexes i \
         JOIN [{db}].sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id \
         JOIN [{db}].sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id \
         JOIN [{db}].sys.objects o ON i.object_id = o.object_id \
         JOIN [{db}].sys.schemas s ON o.schema_id = s.schema_id \
         WHERE s.name = @P1 AND o.name = @P2 AND i.name IS NOT NULL \
         GROUP BY i.name, i.type_desc, i.is_unique, i.is_primary_key \
         ORDER BY i.is_primary_key DESC, i.name",
        db = database.replace(']', "]]"),
    );
    let stream = client
        .query(&sql, &[&schema, &table])
        .await
        .map_err(|e| format!("Failed to get indexes: {}", e))?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| format!("Failed to read indexes: {}", e))?;

    let mut lines: Vec<String> = Vec::new();
    for row in &rows {
        let name = row.try_get::<&str, _>(0).ok().flatten().unwrap_or("");
        let idx_type = row.try_get::<&str, _>(1).ok().flatten().unwrap_or("");
        let is_unique = row.try_get::<bool, _>(2).ok().flatten().unwrap_or(false);
        let is_pk = row.try_get::<bool, _>(3).ok().flatten().unwrap_or(false);
        let columns = row.try_get::<&str, _>(4).ok().flatten().unwrap_or("");

        let mut flags = Vec::new();
        if is_pk {
            flags.push("PRIMARY KEY");
        }
        if is_unique && !is_pk {
            flags.push("UNIQUE");
        }
        let flag_str = if flags.is_empty() {
            String::new()
        } else {
            format!(" [{}]", flags.join(", "))
        };

        lines.push(format!("{}{} ({}) — {}", name, flag_str, columns, idx_type));
    }

    if lines.is_empty() {
        Ok("No indexes found.".to_string())
    } else {
        Ok(lines.join("\n"))
    }
}

/// Retrieves foreign keys.
pub async fn get_foreign_keys(
    client: &mut SqlClient,
    database: &str,
    schema: &str,
    table: &str,
) -> Result<String, String> {
    let sql = format!(
        "SELECT fk.name AS fk_name, \
         STRING_AGG(pc.name, ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS parent_columns, \
         rs.name AS ref_schema, rt.name AS ref_table, \
         STRING_AGG(rc.name, ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS ref_columns \
         FROM [{db}].sys.foreign_keys fk \
         JOIN [{db}].sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id \
         JOIN [{db}].sys.columns pc ON fkc.parent_object_id = pc.object_id AND fkc.parent_column_id = pc.column_id \
         JOIN [{db}].sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id \
         JOIN [{db}].sys.objects pt ON fk.parent_object_id = pt.object_id \
         JOIN [{db}].sys.schemas ps ON pt.schema_id = ps.schema_id \
         JOIN [{db}].sys.objects rt ON fk.referenced_object_id = rt.object_id \
         JOIN [{db}].sys.schemas rs ON rt.schema_id = rs.schema_id \
         WHERE ps.name = @P1 AND pt.name = @P2 \
         GROUP BY fk.name, rs.name, rt.name \
         ORDER BY fk.name",
        db = database.replace(']', "]]"),
    );
    let stream = client
        .query(&sql, &[&schema, &table])
        .await
        .map_err(|e| format!("Failed to get foreign keys: {}", e))?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| format!("Failed to read foreign keys: {}", e))?;

    let mut lines: Vec<String> = Vec::new();
    for row in &rows {
        let name = row.try_get::<&str, _>(0).ok().flatten().unwrap_or("");
        let parent_cols = row.try_get::<&str, _>(1).ok().flatten().unwrap_or("");
        let ref_schema = row.try_get::<&str, _>(2).ok().flatten().unwrap_or("");
        let ref_table = row.try_get::<&str, _>(3).ok().flatten().unwrap_or("");
        let ref_cols = row.try_get::<&str, _>(4).ok().flatten().unwrap_or("");
        lines.push(format!(
            "{}: ({}) → [{}].[{}]({})",
            name, parent_cols, ref_schema, ref_table, ref_cols
        ));
    }

    if lines.is_empty() {
        Ok("No foreign keys found.".to_string())
    } else {
        Ok(lines.join("\n"))
    }
}

/// Generates CREATE TABLE script including PKs and defaults.
pub async fn generate_create_script(
    client: &mut SqlClient,
    database: &str,
    schema: &str,
    table: &str,
) -> Result<String, String> {
    let db = database.replace(']', "]]");

    let col_sql = format!(
        "SELECT \
            c.name, \
            tp.name AS type_name, \
            c.max_length, \
            c.precision, \
            c.scale, \
            c.is_nullable, \
            c.is_identity, \
            CAST(ISNULL(ic.seed_value, 0) AS BIGINT) AS seed_value, \
            CAST(ISNULL(ic.increment_value, 0) AS BIGINT) AS increment_value, \
            c.is_computed, \
            cc.definition AS computed_definition \
         FROM [{db}].sys.columns c \
         JOIN [{db}].sys.types tp ON c.user_type_id = tp.user_type_id \
         LEFT JOIN [{db}].sys.identity_columns ic ON c.object_id = ic.object_id AND c.column_id = ic.column_id \
         LEFT JOIN [{db}].sys.computed_columns cc ON c.object_id = cc.object_id AND c.column_id = cc.column_id \
         JOIN [{db}].sys.objects o ON c.object_id = o.object_id \
         JOIN [{db}].sys.schemas s ON o.schema_id = s.schema_id \
         WHERE s.name = @P1 AND o.name = @P2 \
         ORDER BY c.column_id",
        db = db,
    );

    let pk_sql = format!(
        "SELECT \
            i.name AS index_name, \
            col.name AS column_name, \
            ic.is_descending_key \
         FROM [{db}].sys.indexes i \
         JOIN [{db}].sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id \
         JOIN [{db}].sys.columns col ON ic.object_id = col.object_id AND ic.column_id = col.column_id \
         JOIN [{db}].sys.objects o ON i.object_id = o.object_id \
         JOIN [{db}].sys.schemas s ON o.schema_id = s.schema_id \
         WHERE s.name = @P1 AND o.name = @P2 AND i.is_primary_key = 1 \
         ORDER BY ic.key_ordinal",
        db = db,
    );

    let def_sql = format!(
        "SELECT \
            col.name AS column_name, \
            dc.definition \
         FROM [{db}].sys.default_constraints dc \
         JOIN [{db}].sys.columns col ON dc.parent_object_id = col.object_id AND dc.parent_column_id = col.column_id \
         JOIN [{db}].sys.objects o ON dc.parent_object_id = o.object_id \
         JOIN [{db}].sys.schemas s ON o.schema_id = s.schema_id \
         WHERE s.name = @P1 AND o.name = @P2 \
         ORDER BY col.column_id",
        db = db,
    );

    let col_rows = {
        let stream = client
            .query(&col_sql, &[&schema, &table])
            .await
            .map_err(|e| format!("Failed to read columns: {}", e))?;
        stream
            .into_first_result()
            .await
            .map_err(|e| format!("Failed to parse columns: {}", e))?
    };
    let pk_rows = {
        let stream = client
            .query(&pk_sql, &[&schema, &table])
            .await
            .map_err(|e| format!("Failed to read primary key: {}", e))?;
        stream
            .into_first_result()
            .await
            .map_err(|e| format!("Failed to parse primary key: {}", e))?
    };
    let def_rows = {
        let stream = client
            .query(&def_sql, &[&schema, &table])
            .await
            .map_err(|e| format!("Failed to read defaults: {}", e))?;
        stream
            .into_first_result()
            .await
            .map_err(|e| format!("Failed to parse defaults: {}", e))?
    };

    let mut col_defs: Vec<String> = Vec::new();
    let mut has_lob = false;

    for row in &col_rows {
        let name = row.try_get::<&str, _>(0).ok().flatten().unwrap_or("");
        let type_name = row.try_get::<&str, _>(1).ok().flatten().unwrap_or("");
        let max_length: i16 = row.try_get::<i16, _>(2).ok().flatten().unwrap_or(0);
        let precision: u8 = row.try_get::<u8, _>(3).ok().flatten().unwrap_or(0);
        let scale: u8 = row.try_get::<u8, _>(4).ok().flatten().unwrap_or(0);
        let is_nullable = row.try_get::<bool, _>(5).ok().flatten().unwrap_or(true);
        let is_identity = row.try_get::<bool, _>(6).ok().flatten().unwrap_or(false);
        let seed: i64 = row.try_get::<i64, _>(7).ok().flatten().unwrap_or(0);
        let increment: i64 = row.try_get::<i64, _>(8).ok().flatten().unwrap_or(0);
        let is_computed = row.try_get::<bool, _>(9).ok().flatten().unwrap_or(false);
        let computed_def = row.try_get::<&str, _>(10).ok().flatten();

        if is_computed {
            let expr = computed_def.unwrap_or("NULL");
            col_defs.push(format!("\t[{}] AS {}", name, expr));
            continue;
        }

        let type_str = match type_name.to_lowercase().as_str() {
            "varchar" | "char" | "varbinary" => {
                if max_length == -1 {
                    has_lob = true;
                    format!("[{}](max)", type_name)
                } else {
                    format!("[{}]({})", type_name, max_length)
                }
            }
            "nvarchar" | "nchar" => {
                if max_length == -1 {
                    has_lob = true;
                    format!("[{}](max)", type_name)
                } else {
                    format!("[{}]({})", type_name, max_length / 2)
                }
            }
            "decimal" | "numeric" => {
                format!("[{}]({},{})", type_name, precision, scale)
            }
            "datetime2" | "datetimeoffset" | "time" => {
                if scale > 0 {
                    format!("[{}]({})", type_name, scale)
                } else {
                    format!("[{}]", type_name)
                }
            }
            "text" | "ntext" | "image" | "xml" => {
                has_lob = true;
                format!("[{}]", type_name)
            }
            _ => format!("[{}]", type_name),
        };

        let identity_str = if is_identity {
            format!(" IDENTITY({},{})", seed, increment)
        } else {
            String::new()
        };

        let null_str = if is_nullable { " NULL" } else { " NOT NULL" };

        col_defs.push(format!(
            "\t[{}] {}{}{}",
            name, type_str, identity_str, null_str
        ));
    }

    let on_primary = if has_lob {
        ") ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]"
    } else {
        ") ON [PRIMARY]"
    };

    let sch_escaped = schema.replace(']', "]]");
    let tbl_escaped = table.replace(']', "]]");

    let mut script = String::new();
    script.push_str("SET ANSI_NULLS ON\nGO\n");
    script.push_str("SET QUOTED_IDENTIFIER ON\nGO\n");
    script.push_str(&format!(
        "CREATE TABLE [{}].[{}](\n{}\n{}\nGO\n",
        sch_escaped,
        tbl_escaped,
        col_defs.join(",\n"),
        on_primary
    ));

    if !pk_rows.is_empty() {
        let mut pk_cols: Vec<String> = Vec::new();
        for row in &pk_rows {
            let col_name = row.try_get::<&str, _>(1).ok().flatten().unwrap_or("");
            let is_desc = row.try_get::<bool, _>(2).ok().flatten().unwrap_or(false);
            let dir = if is_desc { "DESC" } else { "ASC" };
            pk_cols.push(format!("\t[{}] {}", col_name, dir));
        }

        script.push_str(&format!(
            "ALTER TABLE [{}].[{}] ADD PRIMARY KEY CLUSTERED \n(\n{}\n)\
            WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, \
            IGNORE_DUP_KEY = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) \
            ON [PRIMARY]\nGO\n",
            sch_escaped,
            tbl_escaped,
            pk_cols.join(",\n")
        ));
    }

    for row in &def_rows {
        let col_name = row.try_get::<&str, _>(0).ok().flatten().unwrap_or("");
        let definition = row.try_get::<&str, _>(1).ok().flatten().unwrap_or("");
        script.push_str(&format!(
            "ALTER TABLE [{}].[{}] ADD DEFAULT {} FOR [{}]\nGO\n",
            sch_escaped, tbl_escaped, definition, col_name
        ));
    }

    Ok(script)
}

/// Retrieves object definition.
pub async fn get_object_definition(
    client: &mut SqlClient,
    database: &str,
    schema: &str,
    name: &str,
) -> Result<String, String> {
    let sql = format!(
        "SELECT OBJECT_DEFINITION(OBJECT_ID('[{db}].[{sch}].[{nm}]'))",
        db = database.replace(']', "]]"),
        sch = schema.replace(']', "]]"),
        nm = name.replace(']', "]]")
    );
    let stream = client
        .query(&sql, &[])
        .await
        .map_err(|e| format!("Failed to get definition: {}", e))?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| format!("Failed to read definition: {}", e))?;

    let definition = rows
        .first()
        .and_then(|r| r.try_get::<&str, _>(0).ok().flatten().map(String::from))
        .unwrap_or_default();

    if definition.is_empty() {
        Ok("Definition not available (object may not exist or may be encrypted).".to_string())
    } else {
        Ok(definition)
    }
}
