use super::connection::SqlClient;

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
