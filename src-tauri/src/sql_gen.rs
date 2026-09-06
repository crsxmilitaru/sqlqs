use std::io::Write as IoWrite;
use std::path::PathBuf;

use serde::Deserialize;

#[derive(Deserialize, Clone)]
pub struct ColumnDef {
    pub name: String,
    #[allow(dead_code)]
    pub type_name: String,
    #[serde(default)]
    pub is_identity: bool,
    #[allow(dead_code)]
    #[serde(default = "default_true")]
    pub is_nullable: bool,
    #[serde(default)]
    pub base_table_name: Option<String>,
    #[allow(dead_code)]
    #[serde(default)]
    pub base_schema_name: Option<String>,
    #[serde(default)]
    pub base_column_name: Option<String>,
    #[serde(default)]
    pub is_expression: bool,
}

fn default_true() -> bool {
    true
}

pub fn quote_identifier(name: &str) -> String {
    format!("[{}]", name.replace(']', "]]"))
}

pub fn quote_string_literal(value: &str) -> String {
    format!("N'{}'", value.replace('\'', "''"))
}

pub fn build_full_name(database: &str, schema: &str, name: &str) -> String {
    format!(
        "{}.{}.{}",
        quote_identifier(database),
        quote_identifier(schema),
        quote_identifier(name)
    )
}

pub fn sql_literal(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::Bool(b) => if *b { "1" } else { "0" }.to_string(),
        serde_json::Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                if f.is_finite() {
                    return n.to_string();
                }
            }
            "NULL".to_string()
        }
        serde_json::Value::String(s) => quote_string_literal(s),
        other => {
            let text = serde_json::to_string(other).unwrap_or_else(|_| other.to_string());
            quote_string_literal(&text)
        }
    }
}

pub fn strip_comments(sql: &str) -> String {
    let mut result = String::with_capacity(sql.len());
    let bytes = sql.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    let mut in_block = false;
    let mut in_line = false;

    while i < len {
        if in_block {
            if i + 1 < len && bytes[i] == b'*' && bytes[i + 1] == b'/' {
                in_block = false;
                i += 2;
            } else {
                i += 1;
            }
        } else if in_line {
            if bytes[i] == b'\n' {
                in_line = false;
                result.push(' ');
            }
            i += 1;
        } else if i + 1 < len && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            in_block = true;
            result.push(' ');
            i += 2;
        } else if i + 1 < len && bytes[i] == b'-' && bytes[i + 1] == b'-' {
            in_line = true;
            i += 2;
        } else {
            result.push(bytes[i] as char);
            i += 1;
        }
    }

    result.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn extract_table_name(sql: &str) -> Option<String> {
    extract_result_set_table_names(sql).into_iter().next()
}

pub fn extract_result_set_table_names(sql: &str) -> Vec<String> {
    let normalized = strip_comments(sql);
    if normalized.is_empty() {
        return Vec::new();
    }

    let lower = normalized.to_lowercase();
    let bytes = normalized.as_bytes();
    let mut names = Vec::new();
    let mut depth = 0i32;
    let mut i = 0usize;
    let mut in_string = false;
    let mut in_quoted_ident = false;

    while i < bytes.len() {
        let b = bytes[i];

        if in_string {
            if b == b'\'' {
                if i + 1 < bytes.len() && bytes[i + 1] == b'\'' {
                    i += 2;
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
                if i + 1 < bytes.len() && bytes[i + 1] == b']' {
                    i += 2;
                } else {
                    in_quoted_ident = false;
                    i += 1;
                }
            } else {
                i += 1;
            }
            continue;
        }

        match b {
            b'\'' => {
                in_string = true;
                i += 1;
            }
            b'[' => {
                in_quoted_ident = true;
                i += 1;
            }
            b'(' => {
                depth += 1;
                i += 1;
            }
            b')' => {
                depth = depth.saturating_sub(1);
                i += 1;
            }
            _ if depth == 0 => {
                let mut matched = false;
                for keyword in ["from", "update"] {
                    if lower[i..].starts_with(keyword) {
                        let end = i + keyword.len();
                        let prev_ok = i == 0 || {
                            let prev = bytes[i - 1];
                            !prev.is_ascii_alphanumeric() && prev != b'_'
                        };
                        let next_ok = end >= bytes.len() || {
                            let next = bytes[end];
                            !next.is_ascii_alphanumeric() && next != b'_'
                        };
                        if prev_ok && next_ok {
                            if let Some(name) = parse_table_identifier(normalized[end..].trim_start())
                            {
                                let trimmed = name.trim_end_matches([';', ',']).to_string();
                                if !trimmed.is_empty() {
                                    names.push(trimmed);
                                }
                            }
                            i = end;
                            matched = true;
                            break;
                        }
                    }
                }
                if !matched {
                    i += 1;
                }
            }
            _ => i += 1,
        }
    }

    names
}

fn parse_table_identifier(s: &str) -> Option<String> {
    let mut result = String::new();
    let mut chars = s.chars().peekable();

    loop {
        match chars.peek() {
            Some(&'[') => {
                result.push(chars.next().unwrap());
                loop {
                    match chars.next() {
                        Some(']') => {
                            result.push(']');
                            if chars.peek() == Some(&']') {
                                result.push(chars.next().unwrap());
                            } else {
                                break;
                            }
                        }
                        Some(c) => result.push(c),
                        None => break,
                    }
                }
            }
            Some(&'"') => {
                result.push(chars.next().unwrap());
                loop {
                    match chars.next() {
                        Some('"') => {
                            result.push('"');
                            if chars.peek() == Some(&'"') {
                                result.push(chars.next().unwrap());
                            } else {
                                break;
                            }
                        }
                        Some(c) => result.push(c),
                        None => break,
                    }
                }
            }
            Some(&c) if c.is_ascii_alphanumeric() || c == '_' => {
                while let Some(&c) = chars.peek() {
                    if c.is_ascii_alphanumeric() || c == '_' {
                        result.push(chars.next().unwrap());
                    } else {
                        break;
                    }
                }
            }
            _ => break,
        }
        if chars.peek() == Some(&'.') {
            result.push(chars.next().unwrap());
        } else {
            break;
        }
    }

    if result.is_empty() {
        None
    } else {
        Some(result)
    }
}

fn find_column_index(columns: &[ColumnDef], name: &str) -> Option<usize> {
    columns
        .iter()
        .position(|col| col.name == name)
        .or_else(|| {
            columns
                .iter()
                .position(|col| col.base_column_name.as_deref() == Some(name))
        })
        .or_else(|| {
            let matches: Vec<usize> = columns
                .iter()
                .enumerate()
                .filter_map(|(index, col)| {
                    if col.name.eq_ignore_ascii_case(name) {
                        return Some(index);
                    }
                    if col
                        .base_column_name
                        .as_deref()
                        .map(|n| n.eq_ignore_ascii_case(name))
                        .unwrap_or(false)
                    {
                        return Some(index);
                    }
                    None
                })
                .collect();
            if matches.len() == 1 {
                matches.first().copied()
            } else {
                None
            }
        })
}

fn column_sql_name(col: &ColumnDef) -> &str {
    col.base_column_name.as_deref().unwrap_or(&col.name)
}

fn column_belongs_to_table(col: &ColumnDef, target_table: Option<&str>) -> bool {
    if col.is_expression {
        return false;
    }
    match (&col.base_table_name, target_table) {
        (Some(base), Some(target)) => base.eq_ignore_ascii_case(target),
        (None, _) => true,
        (Some(_), None) => false,
    }
}

fn bare_table_name(table_name: &str) -> String {
    let after_dot = table_name.rsplit('.').next().unwrap_or(table_name);
    let trimmed = after_dot.trim();
    if let Some(inner) = trimmed.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
        inner.replace("]]", "]")
    } else {
        trimmed.to_string()
    }
}

pub fn build_where_clause(
    columns: &[ColumnDef],
    row: &[serde_json::Value],
    primary_key_columns: &[String],
) -> Result<String, String> {
    if primary_key_columns.is_empty() {
        return Err("A primary key is required for this action".to_string());
    }

    let predicates: Result<Vec<String>, String> = primary_key_columns
        .iter()
        .map(|column_name| {
            let index = find_column_index(columns, column_name).ok_or_else(|| {
                format!("Result set is missing primary key column '{}'", column_name)
            })?;
            let col = columns
                .get(index)
                .ok_or_else(|| format!("Unknown primary key column '{}'", column_name))?;
            let val = row.get(index).ok_or_else(|| {
                format!(
                    "Result row is missing a value for primary key column '{}'",
                    column_name
                )
            })?;

            let qcol = quote_identifier(column_sql_name(col));
            if val.is_null() {
                Ok(format!("{qcol} IS NULL"))
            } else {
                Ok(format!("{qcol} = {}", sql_literal(val)))
            }
        })
        .collect();

    Ok(predicates?.join("\n  AND "))
}

fn wrap_single_row_dml(sql: &str) -> String {
    format!(
        "BEGIN TRY\n  BEGIN TRAN;\n{}\n  IF @@ROWCOUNT <> 1\n  BEGIN\n    ROLLBACK;\n    THROW 50000, 'Expected 1 row', 1;\n  END\n  COMMIT;\nEND TRY\nBEGIN CATCH\n  IF XACT_STATE() <> 0\n    ROLLBACK;\n  THROW;\nEND CATCH;",
        sql.lines()
            .map(|line| format!("  {line}"))
            .collect::<Vec<_>>()
            .join("\n")
    )
}

fn resolve_target_base_table(
    columns: &[ColumnDef],
    primary_key_columns: &[String],
) -> Option<String> {
    for pk_name in primary_key_columns {
        if let Some(idx) = find_column_index(columns, pk_name) {
            if let Some(base) = columns.get(idx).and_then(|c| c.base_table_name.clone()) {
                return Some(base);
            }
        }
    }
    None
}

pub fn build_update_sql(
    table_name: &str,
    columns: &[ColumnDef],
    row: &[serde_json::Value],
    primary_key_columns: &[String],
) -> Result<String, String> {
    let target_base = resolve_target_base_table(columns, primary_key_columns);
    let set_clause: Vec<String> = columns
        .iter()
        .zip(row.iter())
        .filter(|(col, _)| !col.is_identity && column_belongs_to_table(col, target_base.as_deref()))
        .map(|(col, val)| format!("  {} = {}", quote_identifier(column_sql_name(col)), sql_literal(val)))
        .collect();
    if set_clause.is_empty() {
        return Err("No editable columns are available for this row".to_string());
    }
    let where_clause = build_where_clause(columns, row, primary_key_columns)?;
    let dml = format!(
        "UPDATE {table_name}\nSET\n{}\nWHERE\n  {where_clause};",
        set_clause.join(",\n"),
    );
    Ok(wrap_single_row_dml(&dml))
}

pub fn build_delete_sql(
    table_name: &str,
    columns: &[ColumnDef],
    row: &[serde_json::Value],
    primary_key_columns: &[String],
) -> Result<String, String> {
    build_delete_sql_with_primary_key(table_name, columns, row, primary_key_columns)
}

pub fn build_insert_sql(
    table_name: &str,
    columns: &[ColumnDef],
    row: &[serde_json::Value],
) -> String {
    let target = bare_table_name(table_name);
    let pairs: Vec<_> = columns
        .iter()
        .zip(row.iter())
        .filter(|(col, _)| !col.is_identity && column_belongs_to_table(col, Some(&target)))
        .collect();
    let col_names: Vec<String> = pairs
        .iter()
        .map(|(c, _)| quote_identifier(column_sql_name(c)))
        .collect();
    let values: Vec<String> = pairs.iter().map(|(_, v)| sql_literal(v)).collect();
    if pairs.is_empty() {
        format!("-- Insert row into {table_name}\nINSERT INTO {table_name}\nDEFAULT VALUES;")
    } else {
        format!(
            "-- Insert row into {table_name}\nINSERT INTO {table_name} ({})\nVALUES ({});",
            col_names.join(", "),
            values.join(", ")
        )
    }
}

pub fn build_update_sql_with_edits(
    table_name: &str,
    columns: &[ColumnDef],
    old_row: &[serde_json::Value],
    new_row: &[serde_json::Value],
    primary_key_columns: &[String],
) -> Result<String, String> {
    let target_base = resolve_target_base_table(columns, primary_key_columns);
    let set_clause: Vec<String> = columns
        .iter()
        .enumerate()
        .filter(|(_, col)| !col.is_identity && column_belongs_to_table(col, target_base.as_deref()))
        .filter_map(|(i, col)| {
            let new_val = new_row.get(i)?;
            let old_val = old_row.get(i)?;
            if old_val == new_val {
                return None;
            }
            Some(format!(
                "  {} = {}",
                quote_identifier(column_sql_name(col)),
                sql_literal(new_val)
            ))
        })
        .collect();
    if set_clause.is_empty() {
        return Err("No changes were made to this row".to_string());
    }
    let where_clause = build_where_clause(columns, old_row, primary_key_columns)?;
    let dml = format!(
        "UPDATE {table_name}\nSET\n{}\nWHERE\n  {where_clause};",
        set_clause.join(",\n"),
    );
    Ok(wrap_single_row_dml(&dml))
}

pub fn build_delete_sql_with_primary_key(
    table_name: &str,
    columns: &[ColumnDef],
    row: &[serde_json::Value],
    primary_key_columns: &[String],
) -> Result<String, String> {
    let where_clause = build_where_clause(columns, row, primary_key_columns)?;
    let dml = format!("DELETE FROM {table_name}\nWHERE\n  {where_clause};");
    Ok(wrap_single_row_dml(&dml))
}

pub fn export_csv(
    path: &str,
    columns: &[ColumnDef],
    rows: &[Vec<serde_json::Value>],
) -> Result<(), String> {
    let file = std::fs::File::create(PathBuf::from(path))
        .map_err(|e| format!("Failed to create CSV file: {e}"))?;
    let mut w = std::io::BufWriter::new(file);

    let header: Vec<String> = columns
        .iter()
        .map(|c| format!("\"{}\"", c.name.replace('"', "\"\"")))
        .collect();
    writeln!(w, "{}", header.join(",")).map_err(|e| format!("CSV write error: {e}"))?;

    for row in rows {
        let line: Vec<String> = row
            .iter()
            .map(|cell| match cell {
                serde_json::Value::Null => String::new(),
                serde_json::Value::String(s) => format!("\"{}\"", s.replace('"', "\"\"")),
                other => {
                    let text = match other {
                        serde_json::Value::Bool(b) => b.to_string(),
                        serde_json::Value::Number(n) => n.to_string(),
                        _ => serde_json::to_string(other).unwrap_or_default(),
                    };
                    format!("\"{}\"", text.replace('"', "\"\""))
                }
            })
            .collect();
        writeln!(w, "{}", line.join(",")).map_err(|e| format!("CSV write error: {e}"))?;
    }
    w.flush().map_err(|e| format!("CSV flush error: {e}"))?;
    Ok(())
}

pub fn export_json(
    path: &str,
    columns: &[ColumnDef],
    rows: &[Vec<serde_json::Value>],
) -> Result<(), String> {
    let data: Vec<serde_json::Map<String, serde_json::Value>> = rows
        .iter()
        .map(|row| {
            let mut obj = serde_json::Map::new();
            for (i, col) in columns.iter().enumerate() {
                let val = row.get(i).cloned().unwrap_or(serde_json::Value::Null);
                obj.insert(col.name.clone(), val);
            }
            obj
        })
        .collect();

    let json =
        serde_json::to_string_pretty(&data).map_err(|e| format!("JSON serialize error: {e}"))?;
    std::fs::write(PathBuf::from(path), json).map_err(|e| format!("JSON write error: {e}"))?;
    Ok(())
}

pub fn export_xlsx(
    path: &str,
    columns: &[ColumnDef],
    rows: &[Vec<serde_json::Value>],
) -> Result<(), String> {
    use rust_xlsxwriter::{Format, FormatBorder, Workbook};

    let mut workbook = Workbook::new();
    let sheet = workbook
        .add_worksheet()
        .set_name("Results")
        .map_err(|e| format!("XLSX worksheet error: {e}"))?;

    let header_format = Format::new()
        .set_bold()
        .set_background_color("#E7E6E6")
        .set_border_bottom(FormatBorder::Thin);

    for (col_idx, col) in columns.iter().enumerate() {
        sheet
            .write_string_with_format(0, col_idx as u16, &col.name, &header_format)
            .map_err(|e| format!("XLSX header write error: {e}"))?;
    }

    let mut col_widths: Vec<f64> = columns
        .iter()
        .map(|c| (c.name.chars().count() as f64).max(8.0))
        .collect();

    for (ri, row) in rows.iter().enumerate() {
        let row_idx = (ri + 1) as u32;
        for (ci, cell) in row.iter().enumerate() {
            let col_idx = ci as u16;
            match cell {
                serde_json::Value::Null => {}
                serde_json::Value::Bool(b) => {
                    sheet
                        .write_boolean(row_idx, col_idx, *b)
                        .map_err(|e| format!("XLSX write error: {e}"))?;
                    if let Some(w) = col_widths.get_mut(ci) {
                        *w = w.max(5.0);
                    }
                }
                serde_json::Value::Number(n) => {
                    if let Some(f) = n.as_f64() {
                        sheet
                            .write_number(row_idx, col_idx, f)
                            .map_err(|e| format!("XLSX write error: {e}"))?;
                    } else {
                        sheet
                            .write_string(row_idx, col_idx, n.to_string())
                            .map_err(|e| format!("XLSX write error: {e}"))?;
                    }
                    if let Some(w) = col_widths.get_mut(ci) {
                        *w = w.max(n.to_string().chars().count() as f64);
                    }
                }
                serde_json::Value::String(s) => {
                    sheet
                        .write_string(row_idx, col_idx, s)
                        .map_err(|e| format!("XLSX write error: {e}"))?;
                    if let Some(w) = col_widths.get_mut(ci) {
                        *w = w.max(s.chars().count() as f64);
                    }
                }
                other => {
                    let text = serde_json::to_string(other).unwrap_or_default();
                    sheet
                        .write_string(row_idx, col_idx, &text)
                        .map_err(|e| format!("XLSX write error: {e}"))?;
                    if let Some(w) = col_widths.get_mut(ci) {
                        *w = w.max(text.chars().count() as f64);
                    }
                }
            }
        }
    }

    for (ci, width) in col_widths.iter().enumerate() {
        let capped = (width + 2.0).min(60.0);
        sheet
            .set_column_width(ci as u16, capped)
            .map_err(|e| format!("XLSX column width error: {e}"))?;
    }

    sheet
        .set_freeze_panes(1, 0)
        .map_err(|e| format!("XLSX freeze error: {e}"))?;

    workbook
        .save(PathBuf::from(path))
        .map_err(|e| format!("XLSX save error: {e}"))?;
    Ok(())
}

pub fn generate_object_script_static(
    database: &str,
    schema: &str,
    name: &str,
    object_type: &str,
    action: &str,
) -> Option<String> {
    let full = build_full_name(database, schema, name);
    let qs = quote_identifier(schema);
    let qn = quote_identifier(name);

    match (object_type, action) {
        ("TABLE" | "VIEW", "select_top_100") | ("TABLE" | "VIEW", "jump") => {
            Some(format!("SELECT TOP 100 * FROM {full}"))
        }
        ("TABLE" | "VIEW", "select_bottom_100") => Some(format!(
            "SELECT * FROM (\n  SELECT TOP 100 * FROM {full} ORDER BY 1 DESC\n) t ORDER BY 1 ASC"
        )),
        ("TABLE" | "VIEW", "select_all") => Some(format!("SELECT * FROM {full}")),
        ("TABLE" | "VIEW", "count") => Some(format!("SELECT COUNT(*) AS [TotalRows] FROM {full}")),
        ("TABLE", "script_alter_table") => Some(format!(
            "ALTER TABLE {full}\nADD [NewColumn] NVARCHAR(255) NULL\nGO"
        )),
        ("TABLE", "script_drop") => {
            Some(format!(
                "IF OBJECT_ID({}) IS NOT NULL\n\tDROP TABLE {full}\nGO",
                quote_string_literal(&full),
            ))
        }
        ("VIEW", "script_drop") => {
            let qdb = quote_identifier(database);
            let target_ident = format!("{qs}.{qn}");
            let target_lit = quote_string_literal(&target_ident);
            let drop_sql = quote_string_literal(&format!(
                "IF OBJECT_ID({target_lit}, 'V') IS NOT NULL\n\tDROP VIEW {qs}.{qn}"
            ));
            Some(format!("EXEC {qdb}.sys.sp_executesql {drop_sql}"))
        }
        ("PROCEDURE", "script_drop") => {
            let qdb = quote_identifier(database);
            let target_ident = format!("{qs}.{qn}");
            let target_lit = quote_string_literal(&target_ident);
            let drop_sql = quote_string_literal(&format!(
                "IF OBJECT_ID({target_lit}, 'P') IS NOT NULL\n\tDROP PROCEDURE {qs}.{qn}"
            ));
            Some(format!("EXEC {qdb}.sys.sp_executesql {drop_sql}"))
        }
        ("FUNCTION", "script_drop") => {
            let qdb = quote_identifier(database);
            let target_ident = format!("{qs}.{qn}");
            let target_lit = quote_string_literal(&target_ident);
            let drop_sql = quote_string_literal(&format!(
                "IF OBJECT_ID({target_lit}) IS NOT NULL\n\tDROP FUNCTION {qs}.{qn}"
            ));
            Some(format!("EXEC {qdb}.sys.sp_executesql {drop_sql}"))
        }
        ("TRIGGER", "script_drop") => {
            let qdb = quote_identifier(database);
            let schema_lit = quote_string_literal(schema);
            let name_lit = quote_string_literal(name);
            let drop_sql = quote_string_literal(&format!(
                "IF EXISTS (SELECT 1 FROM sys.triggers t JOIN sys.objects o ON o.object_id = t.object_id JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE s.name = {schema_lit} AND t.name = {name_lit})\n\tDROP TRIGGER {qs}.{qn}"
            ));
            Some(format!("EXEC {qdb}.sys.sp_executesql {drop_sql}"))
        }
        ("TABLE", "properties") => {
            let qdb = quote_identifier(database);
            Some(format!(
                "SELECT\n\ts.name AS [Schema],\n\tt.name AS [Name],\n\t'TABLE' AS [Type],\n\tt.create_date AS [CreatedDate],\n\tt.modify_date AS [ModifiedDate],\n\tISNULL(ps.row_count, 0) AS [RowCount],\n\tCAST(ISNULL(ps.reserved_kb, 0) / 1024.0 AS DECIMAL(18, 2)) AS [TotalSizeMB],\n\tCAST(ISNULL(ps.used_kb, 0) / 1024.0 AS DECIMAL(18, 2)) AS [UsedSizeMB],\n\t(SELECT COUNT(*) FROM {qdb}.sys.columns WHERE object_id = t.object_id) AS [Columns],\n\t(SELECT COUNT(*) FROM {qdb}.sys.indexes WHERE object_id = t.object_id AND type > 0) AS [Indexes]\nFROM {qdb}.sys.tables t\nJOIN {qdb}.sys.schemas s ON s.schema_id = t.schema_id\nOUTER APPLY (\n\tSELECT\n\t\tSUM(CASE WHEN dps.index_id IN (0, 1) THEN dps.row_count ELSE 0 END) AS row_count,\n\t\tSUM(dps.reserved_page_count) * 8 AS reserved_kb,\n\t\tSUM(dps.used_page_count) * 8 AS used_kb\n\tFROM {qdb}.sys.dm_db_partition_stats dps\n\tWHERE dps.object_id = t.object_id\n) ps\nWHERE t.object_id = OBJECT_ID({full_lit})",
                full_lit = quote_string_literal(&full),
            ))
        }
        ("VIEW", "properties") => {
            let qdb = quote_identifier(database);
            Some(format!(
                "SELECT\n\ts.name AS [Schema],\n\tv.name AS [Name],\n\t'VIEW' AS [Type],\n\tv.create_date AS [CreatedDate],\n\tv.modify_date AS [ModifiedDate],\n\tv.is_schema_bound AS [IsSchemaBound],\n\tv.with_check_option AS [WithCheckOption],\n\t(SELECT COUNT(*) FROM {qdb}.sys.columns WHERE object_id = v.object_id) AS [Columns],\n\tLEN(m.definition) AS [DefinitionLength]\nFROM {qdb}.sys.views v\nJOIN {qdb}.sys.schemas s ON s.schema_id = v.schema_id\nLEFT JOIN {qdb}.sys.sql_modules m ON m.object_id = v.object_id\nWHERE v.object_id = OBJECT_ID({full_lit})",
                full_lit = quote_string_literal(&full),
            ))
        }
        ("PROCEDURE" | "FUNCTION", "properties") => {
            let qdb = quote_identifier(database);
            Some(format!(
                "SELECT\n\ts.name AS [Schema],\n\to.name AS [Name],\n\to.type_desc AS [Type],\n\to.create_date AS [CreatedDate],\n\to.modify_date AS [ModifiedDate],\n\tLEN(m.definition) AS [DefinitionLength],\n\tm.is_schema_bound AS [IsSchemaBound],\n\tm.uses_ansi_nulls AS [UsesAnsiNulls],\n\tm.uses_quoted_identifier AS [UsesQuotedIdentifier],\n\t(SELECT COUNT(*) FROM {qdb}.sys.parameters WHERE object_id = o.object_id) AS [Parameters]\nFROM {qdb}.sys.objects o\nJOIN {qdb}.sys.schemas s ON s.schema_id = o.schema_id\nLEFT JOIN {qdb}.sys.sql_modules m ON m.object_id = o.object_id\nWHERE o.object_id = OBJECT_ID({full_lit})",
                full_lit = quote_string_literal(&full),
            ))
        }
        ("TRIGGER", "properties") => {
            let qdb = quote_identifier(database);
            let schema_lit = quote_string_literal(schema);
            let name_lit = quote_string_literal(name);
            Some(format!(
                "SELECT\n\tt.name AS [Name],\n\ts.name AS [Schema],\n\tparent.name AS [ParentTable],\n\to.create_date AS [CreatedDate],\n\to.modify_date AS [ModifiedDate],\n\tt.is_disabled AS [IsDisabled],\n\tt.is_instead_of_trigger AS [IsInsteadOf],\n\tLEN(m.definition) AS [DefinitionLength]\nFROM {qdb}.sys.triggers t\nJOIN {qdb}.sys.objects o ON t.object_id = o.object_id\nJOIN {qdb}.sys.schemas s ON s.schema_id = o.schema_id\nLEFT JOIN {qdb}.sys.objects parent ON parent.object_id = t.parent_id\nLEFT JOIN {qdb}.sys.sql_modules m ON m.object_id = t.object_id\nWHERE s.name = {schema_lit} AND t.name = {name_lit}",
            ))
        }

        ("PROCEDURE", "exec") | ("PROCEDURE", "jump") => Some(format!("EXEC {full}")),

        ("FUNCTION", "script_select") | ("FUNCTION", "jump") => Some(format!("SELECT {full}()")),

        ("TRIGGER", "trigger_details") => {
            let qdb = quote_identifier(database);
            let schema_lit = quote_string_literal(schema);
            let name_lit = quote_string_literal(name);
            Some(format!(
                "SELECT\n\tt.name AS [Trigger],\n\tparent.name AS [ParentTable],\n\ts.name AS [Schema],\n\tt.is_disabled AS [IsDisabled],\n\tt.is_instead_of_trigger AS [IsInsteadOf],\n\to.create_date AS [CreatedDate],\n\to.modify_date AS [ModifiedDate]\nFROM {qdb}.sys.triggers t\nJOIN {qdb}.sys.objects o ON t.object_id = o.object_id\nJOIN {qdb}.sys.schemas s ON s.schema_id = o.schema_id\nLEFT JOIN {qdb}.sys.objects parent ON parent.object_id = t.parent_id\nWHERE s.name = {schema_lit} AND t.name = {name_lit}",
            ))
        }
        ("TRIGGER", "enable_trigger") => {
            let qdb = quote_identifier(database);
            let schema_lit = quote_string_literal(schema);
            let name_lit = quote_string_literal(name);
            Some(format!(
                "EXEC {qdb}.sys.sp_executesql N'DECLARE @parent SYSNAME = (SELECT parent.name FROM sys.triggers t JOIN sys.objects o ON o.object_id = t.object_id JOIN sys.schemas s ON s.schema_id = o.schema_id JOIN sys.objects parent ON parent.object_id = t.parent_id WHERE s.name = @schema AND t.name = @name); DECLARE @sql NVARCHAR(MAX) = N''ENABLE TRIGGER '' + QUOTENAME(@schema) + N''.'' + QUOTENAME(@name) + N'' ON '' + QUOTENAME(@schema) + N''.'' + QUOTENAME(@parent); EXEC(@sql)', N'@schema SYSNAME, @name SYSNAME', @schema = {schema_lit}, @name = {name_lit}",
            ))
        }
        ("TRIGGER", "disable_trigger") => {
            let qdb = quote_identifier(database);
            let schema_lit = quote_string_literal(schema);
            let name_lit = quote_string_literal(name);
            Some(format!(
                "EXEC {qdb}.sys.sp_executesql N'DECLARE @parent SYSNAME = (SELECT parent.name FROM sys.triggers t JOIN sys.objects o ON o.object_id = t.object_id JOIN sys.schemas s ON s.schema_id = o.schema_id JOIN sys.objects parent ON parent.object_id = t.parent_id WHERE s.name = @schema AND t.name = @name); DECLARE @sql NVARCHAR(MAX) = N''DISABLE TRIGGER '' + QUOTENAME(@schema) + N''.'' + QUOTENAME(@name) + N'' ON '' + QUOTENAME(@schema) + N''.'' + QUOTENAME(@parent); EXEC(@sql)', N'@schema SYSNAME, @name SYSNAME', @schema = {schema_lit}, @name = {name_lit}",
            ))
        }

        ("TYPE", "view_definition") | ("TYPE", "jump") => {
            let qdb = quote_identifier(database);
            Some(format!(
                "SELECT\n\tt.name AS [TypeName],\n\ts.name AS [Schema],\n\tbase.name AS [BaseType],\n\tt.max_length AS [MaxLength],\n\tt.precision AS [Precision],\n\tt.scale AS [Scale],\n\tt.is_nullable AS [IsNullable],\n\tt.is_table_type AS [IsTableType]\nFROM {qdb}.sys.types t\nJOIN {qdb}.sys.schemas s ON s.schema_id = t.schema_id\nLEFT JOIN {qdb}.sys.types base ON base.user_type_id = t.system_type_id AND base.user_type_id = base.system_type_id\nWHERE t.name = {name_lit}\n\tAND s.name = {schema_lit}",
                name_lit = quote_string_literal(name),
                schema_lit = quote_string_literal(schema),
            ))
        }
        ("TYPE", "script_drop") => {
            let qdb = quote_identifier(database);
            let target_ident = format!("{qs}.{qn}");
            let target_lit = quote_string_literal(&target_ident);
            let drop_sql = quote_string_literal(&format!(
                "IF TYPE_ID({target_lit}) IS NOT NULL\n\tDROP TYPE {qs}.{qn}"
            ));
            Some(format!("EXEC {qdb}.sys.sp_executesql {drop_sql}"))
        }

        ("TABLE" | "VIEW" | "PROCEDURE" | "FUNCTION" | "TRIGGER", "referencing_entities") => {
            let qdb = quote_identifier(database);
            let target_lit = quote_string_literal(&format!("{}.{}", schema, name));
            Some(format!(
                "EXEC {qdb}.sys.sp_executesql N'SELECT DISTINCT referencing_schema_name AS [Schema], referencing_entity_name AS [Name], referencing_class_desc AS [Class] FROM sys.dm_sql_referencing_entities(@target, N''OBJECT'') WHERE referencing_entity_name IS NOT NULL ORDER BY 1, 2', N'@target NVARCHAR(517)', @target = {target_lit}"
            ))
        }
        ("TABLE" | "VIEW" | "PROCEDURE" | "FUNCTION" | "TRIGGER", "referenced_entities") => {
            let qdb = quote_identifier(database);
            let target_lit = quote_string_literal(&format!("{}.{}", schema, name));
            Some(format!(
                "EXEC {qdb}.sys.sp_executesql N'SELECT DISTINCT ISNULL(referenced_database_name, N'''') AS [Database], ISNULL(referenced_schema_name, N'''') AS [Schema], referenced_entity_name AS [Name], referenced_class_desc AS [Class] FROM sys.dm_sql_referenced_entities(@target, N''OBJECT'') WHERE referenced_entity_name IS NOT NULL ORDER BY 2, 3', N'@target NVARCHAR(517)', @target = {target_lit}"
            ))
        }
        ("DATABASE", "properties") => {
            let qdb = quote_identifier(database);
            Some(format!(
                "EXEC {qdb}.sys.sp_executesql N'DECLARE @AllocatedMB DECIMAL(18, 2) = NULL;\nDECLARE @UsedMB DECIMAL(18, 2) = NULL;\n\nIF EXISTS (SELECT 1 FROM sys.all_views WHERE name = ''dm_db_xtp_memory_consumers'' AND schema_id = SCHEMA_ID(''sys''))\nBEGIN\n\tBEGIN TRY\n\t\tDECLARE @inner NVARCHAR(MAX) = N''SELECT @A = ISNULL(SUM(allocated_bytes) / 1024.0 / 1024.0, 0), @U = ISNULL(SUM(used_bytes) / 1024.0 / 1024.0, 0) FROM sys.dm_db_xtp_memory_consumers'';\n\t\tEXEC sp_executesql @inner, N''@A DECIMAL(18, 2) OUTPUT, @U DECIMAL(18, 2) OUTPUT'', @A = @AllocatedMB OUTPUT, @U = @UsedMB OUTPUT;\n\tEND TRY\n\tBEGIN CATCH\n\t\tSET @AllocatedMB = NULL;\n\t\tSET @UsedMB = NULL;\n\tEND CATCH\nEND;\n\nSELECT\n\td.name AS [Name],\n\tCONVERT(NVARCHAR(60), DATABASEPROPERTYEX(d.name, ''Status'')) AS [Status],\n\tSUSER_SNAME(d.owner_sid) AS [Owner],\n\td.create_date AS [CreatedDate],\n\tCAST(f.SizeMB AS DECIMAL(18, 2)) AS [SizeMB],\n\tCAST(f.SpaceAvailableMB AS DECIMAL(18, 2)) AS [SpaceAvailableMB],\n\t(SELECT COUNT(*) FROM sys.database_principals WHERE type IN (''S'', ''U'', ''G'') AND principal_id > 4) AS [NumberOfUsers],\n\t@AllocatedMB AS [MemoryAllocatedToMemoryOptimizedObjectsMB],\n\t@UsedMB AS [MemoryUsedByMemoryOptimizedObjectsMB]\nFROM sys.databases d\nCROSS APPLY (\n\tSELECT\n\t\tSUM(CAST(size AS BIGINT)) * 8.0 / 1024 AS SizeMB,\n\t\tSUM(CASE WHEN type = 0 THEN CAST(size AS BIGINT) - CAST(FILEPROPERTY(name, ''SpaceUsed'') AS BIGINT) ELSE 0 END) * 8.0 / 1024 AS SpaceAvailableMB\n\tFROM sys.database_files\n) f\nWHERE d.name = DB_NAME();'",
            ))
        }
        ("TYPE", "properties") => {
            let qdb = quote_identifier(database);
            Some(format!(
                "SELECT\n\tt.name AS [Name],\n\ts.name AS [Schema],\n\tbase.name AS [BaseType],\n\tt.max_length AS [MaxLength],\n\tt.precision AS [Precision],\n\tt.scale AS [Scale],\n\tt.is_nullable AS [IsNullable],\n\tt.is_table_type AS [IsTableType]\nFROM {qdb}.sys.types t\nJOIN {qdb}.sys.schemas s ON s.schema_id = t.schema_id\nLEFT JOIN {qdb}.sys.types base ON base.user_type_id = t.system_type_id AND base.user_type_id = base.system_type_id\nWHERE t.name = {name_lit}\n\tAND s.name = {schema_lit}",
                name_lit = quote_string_literal(name),
                schema_lit = quote_string_literal(schema),
            ))
        }

        ("TABLE" | "VIEW" | "PROCEDURE" | "FUNCTION" | "TRIGGER", "script_rename") => {
            let qdb = quote_identifier(database);
            let old_qualified = format!("{qs}.{qn}");
            Some(format!(
                "-- Rename {object_type} {full}.\n-- NOTE: sp_rename only updates the object's name; module bodies in sys.sql_modules\n-- continue to reference the old name until you ALTER them.\nEXEC {qdb}.sys.sp_rename {old}, N'<NewName>';\nGO",
                qdb = qdb,
                old = quote_string_literal(&old_qualified),
            ))
        }
        ("TYPE", "script_rename") => {
            let qdb = quote_identifier(database);
            let old_qualified = format!("{qs}.{qn}");
            Some(format!(
                "EXEC {qdb}.sys.sp_rename {old}, N'<NewName>', N'USERDATATYPE';\nGO",
                qdb = qdb,
                old = quote_string_literal(&old_qualified),
            ))
        }

        (_, "jump") => Some(format!("SELECT * FROM {full}")),

        _ => None,
    }
}

pub fn generate_object_script_with_columns(
    database: &str,
    schema: &str,
    name: &str,
    object_type: &str,
    action: &str,
    columns: &[crate::db::ColumnInfo],
) -> String {
    let full = build_full_name(database, schema, name);
    let qs = quote_identifier(schema);
    let qn = quote_identifier(name);

    match (object_type, action) {
        ("TABLE" | "VIEW", "script_select_columns") => {
            let col_list: Vec<String> = columns
                .iter()
                .map(|c| format!("\t{}", quote_identifier(&c.name)))
                .collect();
            format!("SELECT\n{}\nFROM {full}", col_list.join(",\n"))
        }
        ("TABLE" | "VIEW", "script_insert") => {
            let filtered: Vec<&crate::db::ColumnInfo> =
                columns.iter().filter(|c| !c.is_identity).collect();
            let col_names: Vec<String> = filtered
                .iter()
                .map(|c| format!("\t{}", quote_identifier(&c.name)))
                .collect();
            let values: Vec<String> = filtered
                .iter()
                .map(|c| format!("\t<{}, {},>", c.name, c.type_name))
                .collect();
            format!(
                "INSERT INTO {full}\n(\n{}\n)\nVALUES\n(\n{}\n)",
                col_names.join(",\n"),
                values.join(",\n")
            )
        }
        ("TABLE" | "VIEW", "script_update") => {
            let filtered: Vec<&crate::db::ColumnInfo> =
                columns.iter().filter(|c| !c.is_identity).collect();
            let set_clauses: Vec<String> = filtered
                .iter()
                .map(|c| {
                    format!(
                        "\t{} = <{}, {},>",
                        quote_identifier(&c.name),
                        c.name,
                        c.type_name
                    )
                })
                .collect();
            format!(
                "UPDATE {full}\nSET\n{}\nWHERE\n\t<search_condition,,>",
                set_clauses.join(",\n")
            )
        }
        ("TABLE" | "VIEW", "script_delete") => {
            let hint = if let Some(first) = columns.first() {
                format!(
                    "{} = <{}, {},>",
                    quote_identifier(&first.name),
                    first.name,
                    first.type_name
                )
            } else {
                "<search_condition,,>".to_string()
            };
            format!("DELETE FROM {full}\nWHERE\n\t{hint}")
        }
        ("VIEW", "script_create") => {
            let col_list: Vec<String> = columns
                .iter()
                .map(|c| format!("\t{}", quote_identifier(&c.name)))
                .collect();
            format!(
                "SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\nCREATE VIEW {qs}.{qn}\nAS\nSELECT\n{}\nFROM {qs}.[<source_table>]\nGO",
                col_list.join(",\n")
            )
        }
        _ => format!("SELECT * FROM {full}"),
    }
}

pub fn generate_object_script_with_definition(
    _database: &str,
    _schema: &str,
    _name: &str,
    object_type: &str,
    action: &str,
    definition: &str,
) -> String {
    let wrap_definition =
        |def: &str| format!("SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\n{def}\nGO");

    match (object_type, action) {
        ("PROCEDURE" | "FUNCTION" | "TRIGGER", "jump" | "view_definition") => {
            wrap_definition(definition)
        }
        ("PROCEDURE", "script_alter") => {
            let altered = alter_replace(definition, "PROC(?:EDURE)?");
            wrap_definition(&altered)
        }
        ("FUNCTION", "script_alter") => {
            let altered = alter_replace(definition, "FUNCTION");
            wrap_definition(&altered)
        }
        ("TRIGGER", "script_alter") => {
            let altered = alter_replace(definition, "TRIGGER");
            wrap_definition(&altered)
        }
        ("VIEW", "script_alter") => {
            let altered = alter_replace(definition, "VIEW");
            wrap_definition(&altered)
        }
        _ => wrap_definition(definition),
    }
}

pub fn generate_object_script_definition_fallback(
    database: &str,
    schema: &str,
    name: &str,
    object_type: &str,
    action: &str,
) -> String {
    let full = build_full_name(database, schema, name);
    let qs = quote_identifier(schema);
    let qn = quote_identifier(name);

    match (object_type, action) {
        ("PROCEDURE", "jump") => format!("EXEC {full}"),
        ("FUNCTION", "jump") => format!("SELECT {full}()"),
        ("PROCEDURE", "script_alter") => format!(
            "SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\nALTER PROCEDURE {qs}.{qn}\nAS\nBEGIN\n\tSET NOCOUNT ON;\n\t-- TODO\nEND\nGO"
        ),
        ("FUNCTION", "script_alter") => format!(
            "SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\nALTER FUNCTION {qs}.{qn}\n(\n)\nRETURNS <return_type>\nAS\nBEGIN\n\t-- TODO\n\tRETURN <value>\nEND\nGO"
        ),
        ("VIEW", "script_alter") => format!(
            "SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\nALTER VIEW {qs}.{qn}\nAS\nSELECT\n\t*\nFROM {qs}.[<source_table>]\nGO"
        ),
        ("VIEW", "script_create") => format!(
            "SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\nCREATE VIEW {qs}.{qn}\nAS\nSELECT\n\t*\nFROM {qs}.[<source_table>]\nGO"
        ),
        ("TABLE", "script_create") => format!(
            "SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\nCREATE TABLE {qs}.{qn}(\n\t[Id] [int] IDENTITY(1,1) NOT NULL\n) ON [PRIMARY]\nGO"
        ),
        _ => format!(
            "-- Could not retrieve definition for {qs}.{qn}\n-- The object may be encrypted or not accessible."
        ),
    }
}

fn alter_replace(definition: &str, keyword_pattern: &str) -> String {
    let keywords: &[&str] = match keyword_pattern {
        "PROC(?:EDURE)?" => &["procedure", "proc"],
        "FUNCTION" => &["function"],
        "TRIGGER" => &["trigger"],
        "VIEW" => &["view"],
        _ => return definition.to_string(),
    };

    let lower = definition.to_lowercase();
    let bytes = lower.as_bytes();
    let len = bytes.len();

    let is_word_char = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    let boundary_before = |pos: usize| pos == 0 || !is_word_char(bytes[pos - 1]);
    let boundary_after = |pos: usize| pos >= len || !is_word_char(bytes[pos]);
    let skip_ws = |mut pos: usize| {
        while pos < len && bytes[pos].is_ascii_whitespace() {
            pos += 1;
        }
        pos
    };
    let match_kw = |pos: usize, kw: &str| -> Option<usize> {
        let end = pos + kw.len();
        if end <= len && &lower[pos..end] == kw && boundary_after(end) {
            Some(end)
        } else {
            None
        }
    };

    let mut search_from = 0;
    while let Some(rel) = lower[search_from..].find("create") {
        let create_pos = search_from + rel;
        let create_end = create_pos + "create".len();

        if !boundary_before(create_pos) || !boundary_after(create_end) {
            search_from = create_pos + 1;
            continue;
        }

        let mut cursor = skip_ws(create_end);

        if let Some(or_end) = match_kw(cursor, "or") {
            let after_or = skip_ws(or_end);
            if let Some(alter_end) = match_kw(after_or, "alter") {
                cursor = skip_ws(alter_end);
            }
        }

        for kw in keywords {
            if let Some(kw_end) = match_kw(cursor, kw) {
                let original_kw = &definition[cursor..kw_end];
                return format!(
                    "{}ALTER {}{}",
                    &definition[..create_pos],
                    original_kw,
                    &definition[kw_end..]
                );
            }
        }

        search_from = create_pos + 1;
    }

    definition.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn col(name: &str) -> ColumnDef {
        ColumnDef {
            name: name.to_string(),
            type_name: "int".to_string(),
            is_identity: false,
            is_nullable: true,
            base_table_name: None,
            base_schema_name: None,
            base_column_name: None,
            is_expression: false,
        }
    }

    fn col_on(name: &str, base_table: &str, base_column: &str) -> ColumnDef {
        ColumnDef {
            base_table_name: Some(base_table.to_string()),
            base_column_name: Some(base_column.to_string()),
            ..col(name)
        }
    }

    #[test]
    fn extract_result_set_table_names_maps_multi_select_batch() {
        let sql = "select * from Departments\nselect * from Employees";
        assert_eq!(
            extract_result_set_table_names(sql),
            vec!["Departments".to_string(), "Employees".to_string()]
        );
    }

    #[test]
    fn extract_result_set_table_names_skips_subquery_from() {
        let sql = "select * from Departments where exists (select 1 from Employees)";
        assert_eq!(
            extract_result_set_table_names(sql),
            vec!["Departments".to_string()]
        );
    }

    #[test]
    fn build_where_clause_uses_only_primary_key_columns() {
        let columns = vec![col("Id"), col("Name"), col("Price")];
        let row = vec![json!(42), json!("Widget"), json!(12.99)];
        let where_clause =
            build_where_clause(&columns, &row, &[String::from("Id")]).expect("where clause");

        assert_eq!(where_clause, "[Id] = 42");
    }

    #[test]
    fn build_where_clause_requires_primary_key_columns_in_result_set() {
        let columns = vec![col("Name")];
        let row = vec![json!("Widget")];
        let error = build_where_clause(&columns, &row, &[String::from("Id")])
            .expect_err("missing primary key column should fail");

        assert!(error.contains("primary key column 'Id'"));
    }

    #[test]
    fn build_update_sql_with_edits_wraps_single_row_safety_check() {
        let columns = vec![col("Id"), col("Name")];
        let old_row = vec![json!(7), json!("Before")];
        let new_row = vec![json!(7), json!("After")];
        let sql = build_update_sql_with_edits(
            "[dbo].[Widgets]",
            &columns,
            &old_row,
            &new_row,
            &[String::from("Id")],
        )
        .expect("update sql");

        assert!(sql.contains("BEGIN TRAN;"));
        assert!(sql.contains("IF @@ROWCOUNT <> 1"));
        assert!(sql.contains("THROW 50000, 'Expected 1 row', 1;"));
        assert!(sql.contains("[Id] = 7;"));
        assert!(sql.contains("[Name] = N'After'"));
        assert!(!sql.contains("[Name] = N'Before'"));
        assert!(!sql.contains("[Id] = 7,"));
    }

    #[test]
    fn alter_replace_rewrites_create_to_alter() {
        let sql = "CREATE PROCEDURE [dbo].[Foo] AS SELECT 1";
        let altered = alter_replace(sql, "PROC(?:EDURE)?");
        assert_eq!(altered, "ALTER PROCEDURE [dbo].[Foo] AS SELECT 1");
    }

    #[test]
    fn alter_replace_rewrites_create_or_alter_to_alter() {
        let sql = "CREATE OR ALTER PROCEDURE [dbo].[Foo] AS SELECT 1";
        let altered = alter_replace(sql, "PROC(?:EDURE)?");
        assert_eq!(altered, "ALTER PROCEDURE [dbo].[Foo] AS SELECT 1");
    }

    #[test]
    fn alter_replace_handles_extra_whitespace_in_create_or_alter() {
        let sql = "CREATE   OR\nALTER  VIEW [dbo].[V] AS SELECT 1";
        let altered = alter_replace(sql, "VIEW");
        assert_eq!(altered, "ALTER VIEW [dbo].[V] AS SELECT 1");
    }

    #[test]
    fn alter_replace_preserves_keyword_casing() {
        let sql = "create Function dbo.Foo() RETURNS int AS BEGIN RETURN 1 END";
        let altered = alter_replace(sql, "FUNCTION");
        assert_eq!(
            altered,
            "ALTER Function dbo.Foo() RETURNS int AS BEGIN RETURN 1 END"
        );
    }

    #[test]
    fn alter_replace_skips_create_in_string_or_unrelated_word() {
        let sql = "-- creates foo\nCREATE OR ALTER TRIGGER tr ON dbo.T AFTER INSERT AS SELECT 1";
        let altered = alter_replace(sql, "TRIGGER");
        assert_eq!(
            altered,
            "-- creates foo\nALTER TRIGGER tr ON dbo.T AFTER INSERT AS SELECT 1"
        );
    }

    #[test]
    fn alter_replace_returns_original_when_no_match() {
        let sql = "SELECT 1";
        assert_eq!(alter_replace(sql, "PROC(?:EDURE)?"), sql);
    }

    #[test]
    fn build_update_sql_with_edits_errors_when_no_columns_changed() {
        let columns = vec![col("Id"), col("Name")];
        let row = vec![json!(7), json!("Same")];
        let err = build_update_sql_with_edits(
            "[dbo].[Widgets]",
            &columns,
            &row,
            &row,
            &[String::from("Id")],
        )
        .expect_err("no changes should error");

        assert!(err.contains("No changes"));
    }

    #[test]
    fn build_delete_sql_targets_pk_column_base_table_not_first_table() {
        let columns = vec![
            col_on("X", "A", "X"),
            col_on("Id", "B", "Id"),
        ];
        let row = vec![json!("some"), json!(42)];
        let sql = build_delete_sql("[dbo].[B]", &columns, &row, &[String::from("Id")])
            .expect("delete sql");

        assert!(sql.contains("DELETE FROM [dbo].[B]"));
        assert!(sql.contains("[Id] = 42"));
    }

    #[test]
    fn build_update_sql_with_edits_filters_out_other_tables_columns() {
        let columns = vec![
            col_on("Id", "Customers", "Id"),
            col_on("Name", "Customers", "Name"),
            col_on("OrderId", "Orders", "OrderId"),
        ];
        let old_row = vec![json!(1), json!("Acme"), json!(99)];
        let new_row = vec![json!(1), json!("Acme Co"), json!(99)];
        let sql = build_update_sql_with_edits(
            "[dbo].[Customers]",
            &columns,
            &old_row,
            &new_row,
            &[String::from("Id")],
        )
        .expect("update sql");

        assert!(sql.contains("UPDATE [dbo].[Customers]"));
        assert!(sql.contains("[Name] = N'Acme Co'"));
        assert!(!sql.contains("OrderId"));
        assert!(!sql.contains("[OrderId]"));
    }

    #[test]
    fn build_where_clause_matches_pk_by_base_column_name_when_aliased() {
        let columns = vec![col_on("CustomerId", "Customers", "Id")];
        let row = vec![json!(7)];
        let where_clause =
            build_where_clause(&columns, &row, &[String::from("Id")]).expect("where clause");

        assert_eq!(where_clause, "[Id] = 7");
    }

    #[test]
    fn build_insert_sql_excludes_expression_and_other_table_columns() {
        let mut computed = col("FullName");
        computed.is_expression = true;
        let columns = vec![
            col_on("Id", "Customers", "Id"),
            col_on("Name", "Customers", "Name"),
            col_on("OrderId", "Orders", "OrderId"),
            computed,
        ];
        let row = vec![json!(1), json!("Acme"), json!(99), json!("Acme Full")];
        let sql = build_insert_sql("[dbo].[Customers]", &columns, &row);

        assert!(sql.contains("INSERT INTO [dbo].[Customers]"));
        assert!(sql.contains("[Id]"));
        assert!(sql.contains("[Name]"));
        assert!(!sql.contains("OrderId"));
        assert!(!sql.contains("FullName"));
    }

    #[test]
    fn bare_table_name_unquotes_escaped_brackets() {
        assert_eq!(bare_table_name("[Customers]]"), "Customers]");
        assert_eq!(bare_table_name("[dbo].[Customers]]"), "Customers]");
        assert_eq!(bare_table_name("[[Customers]]]"), "[Customers]");
        assert_eq!(bare_table_name("[dbo].[Customers]"), "Customers");
        assert_eq!(bare_table_name("Customers"), "Customers");
    }

    #[test]
    fn build_insert_sql_matches_base_table_with_bracket_in_name() {
        let columns = vec![
            col_on("Id", "Customers]", "Id"),
            col_on("Name", "Customers]", "Name"),
            col_on("OrderId", "Orders", "OrderId"),
        ];
        let row = vec![json!(1), json!("Acme"), json!(99)];
        let sql = build_insert_sql("[dbo].[Customers]]", &columns, &row);

        assert!(sql.contains("INSERT INTO [dbo].[Customers]]"));
        assert!(sql.contains("[Id]"));
        assert!(sql.contains("[Name]"));
        assert!(!sql.contains("OrderId"));
        assert!(!sql.contains("DEFAULT VALUES"));
    }
}
