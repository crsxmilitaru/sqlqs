use futures_util::TryStreamExt;
use tiberius::{QueryItem, Row};

use super::connection::SqlClient;
use super::types::{ColumnInfo, QueryResult, ResultSet};

/// Split SQL text on GO batch separators, respecting strings, comments,
/// and `GO N` repeat counts — matching SSMS behavior.
fn split_batches(sql: &str) -> Vec<String> {
    let mut batches = Vec::new();
    let mut current_batch = String::new();
    let mut in_block_comment = false;

    for line in sql.lines() {
        if in_block_comment {
            // We're inside a block comment — append the line verbatim and
            // re-scan to figure out whether the block is still open at EOL.
            in_block_comment = update_block_comment_state(line, true);
            if !current_batch.is_empty() {
                current_batch.push('\n');
            }
            current_batch.push_str(line);
            continue;
        }

        let trimmed = line.trim();

        // Slice with `get` so a leading multi-byte UTF-8 char (e.g. CJK in a
        // comment) doesn't panic on a non-char-boundary index.
        let go_prefix = trimmed.get(..2);
        let go_suffix = trimmed.get(2..).unwrap_or("");
        let is_go = go_prefix.is_some_and(|p| p.eq_ignore_ascii_case("go")) && {
            let after_go = go_suffix.trim();
            after_go.is_empty() || after_go.bytes().all(|b| b.is_ascii_digit())
        };

        if is_go {
            if !current_batch.trim().is_empty() {
                let repeat: usize = go_suffix.trim().parse().unwrap_or(1).max(1);
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
            in_block_comment = update_block_comment_state(line, false);
        }
    }
    if !current_batch.trim().is_empty() {
        batches.push(current_batch);
    }
    batches
}

/// Returns whether a line ends inside a block comment, given the starting
/// state. Tracks string literals and quoted identifiers so that `/*` or `*/`
/// inside `'...'` or `[...]` does not toggle the comment state. Once a `--`
/// line comment starts, the rest of the line is ignored — block comment state
/// at EOL inherits the state at the `--`.
fn update_block_comment_state(line: &str, mut in_block: bool) -> bool {
    let bytes = line.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    let mut in_string = false;
    let mut in_quoted_ident = false;

    while i < len {
        let b = bytes[i];

        if in_block {
            if i + 1 < len && b == b'*' && bytes[i + 1] == b'/' {
                in_block = false;
                i += 2;
            } else {
                i += 1;
            }
            continue;
        }

        if in_string {
            if b == b'\'' {
                if i + 1 < len && bytes[i + 1] == b'\'' {
                    i += 2; // escaped quote
                } else {
                    in_string = false;
                    i += 1;
                }
            } else {
                i += 1;
            }
            continue;
        }

        if in_quoted_ident {
            if b == b']' {
                if i + 1 < len && bytes[i + 1] == b']' {
                    i += 2; // escaped ]
                } else {
                    in_quoted_ident = false;
                    i += 1;
                }
            } else {
                i += 1;
            }
            continue;
        }

        if i + 1 < len && b == b'-' && bytes[i + 1] == b'-' {
            // Line comment runs to EOL — block state can't change beyond here.
            return in_block;
        }
        if i + 1 < len && b == b'/' && bytes[i + 1] == b'*' {
            in_block = true;
            i += 2;
            continue;
        }
        if b == b'\'' {
            in_string = true;
            i += 1;
            continue;
        }
        if b == b'[' {
            in_quoted_ident = true;
            i += 1;
            continue;
        }
        i += 1;
    }
    in_block
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
                        truncated: false,
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
            truncated: false,
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

pub async fn execute_query(
    client: &mut SqlClient,
    sql: &str,
    max_rows: Option<u64>,
) -> Result<QueryResult, String> {
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

    let mut row_limit_applied: Option<u64> = None;
    if let Some(limit) = max_rows.filter(|n| *n > 0) {
        let limit_usize = limit as usize;
        for rs in all_result_sets.iter_mut() {
            if rs.rows.len() > limit_usize {
                rs.rows.truncate(limit_usize);
                rs.truncated = true;
                row_limit_applied = Some(limit);
            }
        }
    }

    Ok(QueryResult {
        result_sets: all_result_sets,
        rows_affected: total_rows_affected,
        messages: all_messages,
        elapsed_ms: start.elapsed().as_millis() as u64,
        row_limit_applied,
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
    (0..col_count).map(|i| extract_cell(row, i)).collect()
}

/// Reads one cell from a row. Tries each Rust type in turn:
/// `Ok(Some(_))` → return the value, `Ok(None)` → SQL NULL (return JSON null),
/// `Err(_)` → type doesn't match this column, try the next type. If no type
/// matches, surface the column's reported type so the cell isn't silently
/// blank for things like geography/geometry/hierarchyid/sql_variant.
fn extract_cell(row: &Row, i: usize) -> serde_json::Value {
    macro_rules! try_cell {
        ($ty:ty, $convert:expr) => {
            match row.try_get::<$ty, _>(i) {
                Ok(Some(val)) => return $convert(val),
                Ok(None) => return serde_json::Value::Null,
                Err(_) => {}
            }
        };
    }

    try_cell!(&str, |v: &str| serde_json::Value::String(v.to_string()));
    try_cell!(i32, |v: i32| serde_json::json!(v));
    try_cell!(i64, |v: i64| serde_json::json!(v));
    try_cell!(i16, |v: i16| serde_json::json!(v));
    try_cell!(u8, |v: u8| serde_json::json!(v));
    try_cell!(f32, |v: f32| serde_json::json!(v));
    try_cell!(f64, |v: f64| serde_json::json!(v));
    try_cell!(bool, |v: bool| serde_json::json!(v));
    try_cell!(uuid::Uuid, |v: uuid::Uuid| serde_json::Value::String(
        v.to_string()
    ));
    try_cell!(
        chrono::DateTime<chrono::FixedOffset>,
        |v: chrono::DateTime<chrono::FixedOffset>| serde_json::Value::String(
            v.format("%Y-%m-%d %H:%M:%S%.7f %:z").to_string()
        )
    );
    try_cell!(chrono::NaiveDateTime, |v: chrono::NaiveDateTime| {
        serde_json::Value::String(v.format("%Y-%m-%d %H:%M:%S%.3f").to_string())
    });
    try_cell!(chrono::NaiveDate, |v: chrono::NaiveDate| {
        serde_json::Value::String(v.format("%Y-%m-%d").to_string())
    });
    try_cell!(chrono::NaiveTime, |v: chrono::NaiveTime| {
        serde_json::Value::String(v.format("%H:%M:%S%.3f").to_string())
    });
    try_cell!(
        tiberius::numeric::Decimal,
        |v: tiberius::numeric::Decimal| serde_json::Value::String(format!("{}", v))
    );
    try_cell!(&[u8], |v: &[u8]| {
        let hex = v
            .iter()
            .map(|byte| format!("{:02X}", byte))
            .collect::<String>();
        serde_json::Value::String(format!("0x{}", hex))
    });

    // No Rust type matched — the column is something we don't decode
    // (e.g. geography, geometry, hierarchyid, sql_variant). Surface the
    // column type so it isn't a blank cell.
    match row.columns().get(i).map(|c| c.column_type()) {
        Some(ty) => serde_json::Value::String(format!("<{:?} not supported>", ty)),
        None => serde_json::Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn block_state_simple_open_close_on_one_line() {
        // /* opens, */ closes — net state: closed.
        assert!(!update_block_comment_state("SELECT /* hi */ 1", false));
    }

    #[test]
    fn block_state_open_close_then_reopen_on_one_line() {
        // The previous version's substring count failed here: opens=2, closes=1 → true,
        // but if we have "*/ a /* b */ c", a single rest.contains("/*") wrongly stays open.
        // The new scanner handles it byte-by-byte.
        assert!(update_block_comment_state("/* a */ b /*", false));
    }

    #[test]
    fn block_state_multiple_close_open_pairs() {
        // /* a */ b */ c /* — outside-block "*/" is stray text in normal mode
        // (not toggled). Then /* opens again. End: open.
        assert!(update_block_comment_state("/* a */ b */ c /*", false));
        // /* a */ /* b */ — fully balanced, end: closed.
        assert!(!update_block_comment_state("/* a */ /* b */", false));
    }

    #[test]
    fn block_state_ignores_block_markers_inside_strings() {
        // /* inside a string literal must not toggle the comment state.
        assert!(!update_block_comment_state("SELECT 'a /* b' FROM t", false));
        assert!(!update_block_comment_state("SELECT 'a */ b' FROM t", false));
    }

    #[test]
    fn block_state_ignores_block_markers_inside_quoted_idents() {
        assert!(!update_block_comment_state("SELECT [a /* b] FROM t", false));
    }

    #[test]
    fn block_state_line_comment_freezes_state() {
        // -- starts a line comment; trailing /* must not flip the state.
        assert!(!update_block_comment_state("SELECT 1 -- /* nope", false));
        // But if we entered the line already in a block, we still are at EOL.
        assert!(update_block_comment_state(
            "still in block -- not a line comment here",
            true
        ));
    }

    #[test]
    fn split_batches_handles_go_with_repeat() {
        let sql = "SELECT 1\nGO 3";
        let batches = split_batches(sql);
        assert_eq!(batches.len(), 3);
        for b in &batches {
            assert!(b.contains("SELECT 1"));
        }
    }

    #[test]
    fn split_batches_skips_go_inside_block_comment() {
        let sql = "SELECT 1\n/* a\nGO\nb */\nSELECT 2";
        let batches = split_batches(sql);
        assert_eq!(batches.len(), 1);
        assert!(batches[0].contains("SELECT 1"));
        assert!(batches[0].contains("SELECT 2"));
        assert!(batches[0].contains("/* a"));
    }

    #[test]
    fn split_batches_handles_close_then_reopen_on_same_line() {
        // The previous heuristic could miss this and treat a later `GO`
        // as data instead of a batch separator (or vice versa).
        let sql = "/* first */ SELECT 1 /*\nGO\nstill in block */\nGO\nSELECT 2";
        let batches = split_batches(sql);
        // First batch is everything up to the second standalone GO.
        // Inner GO is inside the open block comment from line 1's trailing /*.
        assert_eq!(batches.len(), 2);
        assert!(batches[0].contains("SELECT 1"));
        assert!(batches[1].contains("SELECT 2"));
    }

    #[test]
    fn split_batches_does_not_treat_go_in_string_as_separator() {
        let sql = "SELECT 'GO'\nSELECT 1";
        let batches = split_batches(sql);
        assert_eq!(batches.len(), 1);
    }

    #[test]
    fn split_batches_does_not_panic_on_multibyte_leading_char() {
        let sql = "中文 SELECT 1\nGO\nSELECT 2";
        let batches = split_batches(sql);
        assert_eq!(batches.len(), 2);
    }
}
