use futures_util::TryStreamExt;
use serde::{Deserialize, Serialize};
use std::pin::Pin;
use std::task::{Context, Poll};
use tiberius::{AuthMethod, Client, Config, EncryptionLevel, QueryItem, Row, SqlBrowser};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

#[derive(Debug, Clone, Serialize, Deserialize)]
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseObject {
    pub name: String,
    pub schema_name: String,
    pub object_type: String,
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

pub async fn connect(config: &ConnectionConfig) -> Result<SqlClient, String> {
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

    let tcp_result = if instance.is_some() {
        TcpStream::connect_named(&tib_config)
            .await
            .map_err(|e| e.to_string())
    } else {
        TcpStream::connect(tib_config.get_addr())
            .await
            .map_err(|e| e.to_string())
    };

    let stream = match tcp_result {
        Ok(tcp) => {
            tcp.set_nodelay(true).ok();
            TransportStream::Tcp(tcp)
        }
        Err(tcp_err) => {
            #[cfg(windows)]
            {
                if host.eq_ignore_ascii_case("localhost") || host == "." || host == "127.0.0.1" {
                    let pipe_name = match &instance {
                        Some(inst) => format!(r"\\.\pipe\MSSQL${}\sql\query", inst),
                        None => r"\\.\pipe\sql\query".to_string(),
                    };

                    match tokio::net::windows::named_pipe::ClientOptions::new().open(&pipe_name) {
                        Ok(pipe) => TransportStream::NamedPipe(pipe),
                        Err(pipe_err) => {
                            return Err(format!(
                                "TCP failed ({}) and Named Pipe fallback failed ({})",
                                tcp_err, pipe_err
                            ))
                        }
                    }
                } else {
                    return Err(format!(
                        "TCP connection to '{}:{}' failed: {}",
                        host, port, tcp_err
                    ));
                }
            }
            #[cfg(not(windows))]
            return Err(format!(
                "TCP connection to '{}:{}' failed: {}",
                host, port, tcp_err
            ));
        }
    };

    let client = Client::connect(tib_config, stream.compat_write())
        .await
        .map_err(|e| format!("SQL Server connection failed: {}", e))?;

    Ok(client)
}

pub async fn execute_query(client: &mut SqlClient, sql: &str) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    let messages = Vec::new();
    let mut result_sets = Vec::new();
    let mut current_columns = Vec::new();
    let mut current_rows = Vec::new();

    let mut stream = client
        .query(sql, &[])
        .await
        .map_err(|e| format!("Query failed: {}", e))?;

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

    let rows_affected = if result_sets.is_empty() {
        get_last_rowcount(client).await?
    } else {
        result_sets.iter().map(|rs| rs.rows.len() as u64).sum()
    };

    Ok(QueryResult {
        result_sets,
        rows_affected,
        messages,
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

pub async fn get_tables(
    client: &mut SqlClient,
    database: &str,
) -> Result<Vec<DatabaseObject>, String> {
    let sql = format!(
        "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM [{db}].INFORMATION_SCHEMA.TABLES ORDER BY TABLE_SCHEMA, TABLE_NAME",
        db = database.replace(']', "]]")
    );
    let stream = client
        .query(&sql, &[])
        .await
        .map_err(|e| format!("Failed to list tables: {}", e))?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| format!("Failed to read tables: {}", e))?;

    Ok(rows
        .iter()
        .filter_map(|r| {
            let schema = r.try_get::<&str, _>(0).ok().flatten()?;
            let name = r.try_get::<&str, _>(1).ok().flatten()?;
            let obj_type = r.try_get::<&str, _>(2).ok().flatten()?;
            Some(DatabaseObject {
                schema_name: schema.to_string(),
                name: name.to_string(),
                object_type: if obj_type.contains("VIEW") {
                    "VIEW".to_string()
                } else {
                    "TABLE".to_string()
                },
            })
        })
        .collect())
}

pub async fn get_columns(
    client: &mut SqlClient,
    database: &str,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    let sql = format!(
        "SELECT COLUMN_NAME, DATA_TYPE + CASE \
            WHEN CHARACTER_MAXIMUM_LENGTH IS NOT NULL THEN '(' + CAST(CHARACTER_MAXIMUM_LENGTH AS VARCHAR) + ')' \
            WHEN DATA_TYPE IN ('decimal','numeric') THEN '(' + CAST(NUMERIC_PRECISION AS VARCHAR) + ',' + CAST(NUMERIC_SCALE AS VARCHAR) + ')' \
            ELSE '' END AS full_type \
         FROM [{db}].INFORMATION_SCHEMA.COLUMNS \
         WHERE TABLE_SCHEMA = '{sch}' AND TABLE_NAME = '{tbl}' \
         ORDER BY ORDINAL_POSITION",
        db = database.replace(']', "]]"),
        sch = schema.replace('\'', "''"),
        tbl = table.replace('\'', "''")
    );
    let stream = client
        .query(&sql, &[])
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
            Some(ColumnInfo {
                name: name.to_string(),
                type_name: type_name.to_string(),
            })
        })
        .collect())
}
