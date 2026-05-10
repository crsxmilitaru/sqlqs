use super::connection::SqlClient;
use super::types::{ColumnInfo, DatabaseObject, DatabaseSchemaCatalogEntry};

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

/// Generates a compact schema summary for AI tool context.
pub async fn get_ai_schema_summary(client: &mut SqlClient) -> Result<String, String> {
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
