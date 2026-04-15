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
}

fn default_true() -> bool {
    true
}

// ---------------------------------------------------------------------------
// Identifier & literal helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SQL comment stripping & table-name extraction
// ---------------------------------------------------------------------------

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
    let normalized = strip_comments(sql);
    if normalized.is_empty() {
        return None;
    }
    for keyword in &["from", "update"] {
        if let Some(name) = extract_after_keyword(&normalized, keyword) {
            return Some(name);
        }
    }
    None
}

fn extract_after_keyword(sql: &str, keyword: &str) -> Option<String> {
    let lower = sql.to_lowercase();
    let mut search_start = 0;

    while let Some(pos) = lower[search_start..].find(keyword) {
        let abs_pos = search_start + pos;

        // word boundary before
        if abs_pos > 0 {
            let prev = sql.as_bytes()[abs_pos - 1];
            if prev.is_ascii_alphanumeric() || prev == b'_' {
                search_start = abs_pos + keyword.len();
                continue;
            }
        }
        // word boundary after
        let after_pos = abs_pos + keyword.len();
        if after_pos < sql.len() {
            let next = sql.as_bytes()[after_pos];
            if next.is_ascii_alphanumeric() || next == b'_' {
                search_start = after_pos;
                continue;
            }
        }

        let rest = sql[after_pos..].trim_start();
        if rest.is_empty() {
            return None;
        }

        let name = parse_table_identifier(rest)?;
        let trimmed = name.trim_end_matches(|c: char| c == ';' || c == ',');
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
        search_start = after_pos;
    }
    None
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

// ---------------------------------------------------------------------------
// Row-level SQL builders (UPDATE / DELETE / INSERT)
// ---------------------------------------------------------------------------

fn find_column_index(columns: &[ColumnDef], name: &str) -> Option<usize> {
    columns.iter().position(|col| col.name == name).or_else(|| {
        let matches: Vec<usize> = columns
            .iter()
            .enumerate()
            .filter_map(|(index, col)| col.name.eq_ignore_ascii_case(name).then_some(index))
            .collect();
        if matches.len() == 1 {
            matches.first().copied()
        } else {
            None
        }
    })
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

            let qcol = quote_identifier(&col.name);
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

pub fn build_update_sql(
    table_name: &str,
    columns: &[ColumnDef],
    row: &[serde_json::Value],
    primary_key_columns: &[String],
) -> Result<String, String> {
    let set_clause: Vec<String> = columns
        .iter()
        .zip(row.iter())
        .filter(|(col, _)| !col.is_identity)
        .map(|(col, val)| format!("  {} = {}", quote_identifier(&col.name), sql_literal(val)))
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
    let pairs: Vec<_> = columns
        .iter()
        .zip(row.iter())
        .filter(|(col, _)| !col.is_identity)
        .collect();
    let col_names: Vec<String> = pairs
        .iter()
        .map(|(c, _)| quote_identifier(&c.name))
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
    let set_clause: Vec<String> = columns
        .iter()
        .enumerate()
        .filter(|(_, col)| !col.is_identity)
        .filter_map(|(i, col)| {
            let new_val = new_row.get(i)?;
            let old_val = old_row.get(i)?;
            if old_val == new_val {
                return None;
            }
            Some(format!(
                "  {} = {}",
                quote_identifier(&col.name),
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

// ---------------------------------------------------------------------------
// Export helpers (CSV / JSON)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Object-script generation (explorer menu & jump palette)
// ---------------------------------------------------------------------------

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
        // TABLE / VIEW -------------------------------------------------------
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
        ("TABLE" | "VIEW", "script_drop") => {
            let (kind, flag) = if object_type == "VIEW" {
                ("VIEW", "V")
            } else {
                ("TABLE", "U")
            };
            Some(format!(
                "IF OBJECT_ID({}, {flag_lit}) IS NOT NULL\n\tDROP {kind} {full}\nGO",
                quote_string_literal(&full),
                flag_lit = quote_string_literal(flag),
            ))
        }
        ("TABLE" | "VIEW", "get_last_modified")
        | ("PROCEDURE" | "FUNCTION" | "TRIGGER", "get_last_modified") => {
            let qdb = quote_identifier(database);
            Some(format!(
                "SELECT\n\t[name] AS [Object],\n\t[type_desc] AS [Type],\n\t[create_date] AS [CreatedDate],\n\t[modify_date] AS [ModifiedDate]\nFROM {qdb}.sys.objects\nWHERE object_id = OBJECT_ID({full_lit})",
                full_lit = quote_string_literal(&full),
            ))
        }

        // PROCEDURE ----------------------------------------------------------
        ("PROCEDURE", "exec") | ("PROCEDURE", "jump") => Some(format!("EXEC {full}")),

        // FUNCTION -----------------------------------------------------------
        ("FUNCTION", "script_select") | ("FUNCTION", "jump") => Some(format!("SELECT {full}()")),

        // TRIGGER ------------------------------------------------------------
        ("TRIGGER", "trigger_details") => {
            let qdb = quote_identifier(database);
            Some(format!(
                "SELECT\n\tt.name AS [Trigger],\n\tOBJECT_NAME(t.parent_id) AS [ParentTable],\n\tSCHEMA_NAME(o.schema_id) AS [Schema],\n\tt.is_disabled AS [IsDisabled],\n\tt.is_instead_of_trigger AS [IsInsteadOf],\n\to.create_date AS [CreatedDate],\n\to.modify_date AS [ModifiedDate]\nFROM {qdb}.sys.triggers t\nJOIN {qdb}.sys.objects o ON t.object_id = o.object_id\nWHERE t.object_id = OBJECT_ID({full_lit})",
                full_lit = quote_string_literal(&full),
            ))
        }
        ("TRIGGER", "enable_trigger") => {
            let qdb = quote_identifier(database);
            Some(format!(
                "DECLARE @parent NVARCHAR(256) = OBJECT_NAME((SELECT parent_id FROM {qdb}.sys.triggers WHERE object_id = OBJECT_ID({full_lit})));\nEXEC('ENABLE TRIGGER {qs}.{qn} ON {qs}.' + QUOTENAME(@parent))",
                full_lit = quote_string_literal(&full),
            ))
        }
        ("TRIGGER", "disable_trigger") => {
            let qdb = quote_identifier(database);
            Some(format!(
                "DECLARE @parent NVARCHAR(256) = OBJECT_NAME((SELECT parent_id FROM {qdb}.sys.triggers WHERE object_id = OBJECT_ID({full_lit})));\nEXEC('DISABLE TRIGGER {qs}.{qn} ON {qs}.' + QUOTENAME(@parent))",
                full_lit = quote_string_literal(&full),
            ))
        }

        // TYPE ---------------------------------------------------------------
        ("TYPE", "view_definition") | ("TYPE", "jump") => {
            let qdb = quote_identifier(database);
            Some(format!(
                "SELECT\n\tt.name AS [TypeName],\n\tSCHEMA_NAME(t.schema_id) AS [Schema],\n\tTYPE_NAME(t.system_type_id) AS [BaseType],\n\tt.max_length AS [MaxLength],\n\tt.precision AS [Precision],\n\tt.scale AS [Scale],\n\tt.is_nullable AS [IsNullable],\n\tt.is_table_type AS [IsTableType]\nFROM {qdb}.sys.types t\nWHERE t.name = {name_lit}\n\tAND SCHEMA_NAME(t.schema_id) = {schema_lit}",
                name_lit = quote_string_literal(name),
                schema_lit = quote_string_literal(schema),
            ))
        }
        ("TYPE", "script_drop") => Some(format!("DROP TYPE {full}")),

        // Default SELECT for unknown types
        (_, "jump") => Some(format!("SELECT * FROM {full}")),

        _ => None,
    }
}

/// Build SQL using column metadata (for script_select_columns, script_insert, script_update, script_delete, script_create view).
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

/// Build SQL using an object definition (for view_definition, script_alter of procs/views/etc).
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

/// Fallback SQL when object definition cannot be retrieved.
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

/// Simple CREATE→ALTER replacement in SQL definitions.
fn alter_replace(definition: &str, keyword_pattern: &str) -> String {
    // Build a case-insensitive search for "CREATE <keyword>"
    // keyword_pattern can be e.g. "PROC(?:EDURE)?" but we only need simple matching here.
    // We'll do a simple case-insensitive search for "CREATE " followed by the keyword.
    let lower = definition.to_lowercase();
    let keywords: Vec<&str> = match keyword_pattern {
        "PROC(?:EDURE)?" => vec!["procedure", "proc"],
        "FUNCTION" => vec!["function"],
        "TRIGGER" => vec!["trigger"],
        "VIEW" => vec!["view"],
        _ => vec![],
    };

    for kw in keywords {
        let pattern = format!("create ");
        if let Some(create_pos) = lower.find(&pattern) {
            let after_create = &lower[create_pos + 7..].trim_start();
            if after_create.starts_with(kw) {
                // Find the actual position in the original string
                let rest_start = create_pos + 7;
                let trimmed_offset =
                    lower[rest_start..].len() - lower[rest_start..].trim_start().len();
                let kw_start = rest_start + trimmed_offset;
                let kw_end = kw_start + kw.len();
                // Preserve the original case of the keyword
                let original_kw = &definition[kw_start..kw_end];
                return format!(
                    "{}ALTER {}{}",
                    &definition[..create_pos],
                    original_kw,
                    &definition[kw_end..]
                );
            }
        }
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
        }
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
}
