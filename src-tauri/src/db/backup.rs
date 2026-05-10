use super::connection::SqlClient;
use super::types::{
    BackupDatabaseRequest, BackupDefaults, BackupFileInfo, BackupOperationResult,
    BackupScheduleInfo, BackupScheduleRequest, RestoreDatabaseRequest,
};

fn quote_ident(value: &str) -> String {
    format!("[{}]", value.replace(']', "]]"))
}

fn quote_literal(value: &str) -> String {
    format!("N'{}'", value.replace('\'', "''"))
}

fn ensure_non_empty(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{} is required", label))
    } else {
        Ok(())
    }
}

fn normalize_backup_type(value: &str) -> Result<&'static str, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "full" => Ok("full"),
        "differential" => Ok("differential"),
        "log" => Ok("log"),
        _ => Err("Backup type must be full, differential, or log".to_string()),
    }
}

fn backup_extension(backup_type: &str) -> &'static str {
    if backup_type == "log" {
        "trn"
    } else {
        "bak"
    }
}

fn sanitize_backup_file_part(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() || ch.is_whitespace() => '_',
            ch => ch,
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();

    if sanitized.is_empty() {
        "database".to_string()
    } else {
        sanitized
    }
}

fn join_server_path(folder: &str, file_name: &str) -> String {
    let trimmed = folder.trim().trim_end_matches(&['\\', '/'][..]);
    if trimmed.is_empty() {
        return file_name.to_string();
    }

    let separator = if trimmed.contains('/') && !trimmed.contains('\\') {
        '/'
    } else {
        '\\'
    };
    format!("{}{}{}", trimmed, separator, file_name)
}

fn build_backup_options(
    backup_type: &str,
    overwrite: Option<bool>,
    copy_only: bool,
    compression: bool,
    checksum: bool,
) -> Result<Vec<&'static str>, String> {
    if backup_type == "differential" && copy_only {
        return Err("COPY_ONLY cannot be combined with a differential backup".to_string());
    }

    let mut options = Vec::new();
    if backup_type == "differential" {
        options.push("DIFFERENTIAL");
    }
    if copy_only {
        options.push("COPY_ONLY");
    }
    if compression {
        options.push("COMPRESSION");
    }
    if checksum {
        options.push("CHECKSUM");
    }
    if let Some(overwrite) = overwrite {
        options.push(if overwrite { "INIT" } else { "NOINIT" });
    }
    options.push("STATS = 10");
    Ok(options)
}

fn build_backup_command(
    database: &str,
    destination_path_sql: &str,
    backup_type: &str,
    overwrite: Option<bool>,
    copy_only: bool,
    compression: bool,
    checksum: bool,
) -> Result<String, String> {
    ensure_non_empty(database, "Database")?;
    let backup_type = normalize_backup_type(backup_type)?;
    let options = build_backup_options(backup_type, overwrite, copy_only, compression, checksum)?;
    let verb = if backup_type == "log" {
        "LOG"
    } else {
        "DATABASE"
    };
    Ok(format!(
        "BACKUP {} {} TO DISK = {} WITH {}",
        verb,
        quote_ident(database.trim()),
        destination_path_sql,
        options.join(", ")
    ))
}

async fn execute_administrative_batch(
    client: &mut SqlClient,
    sql: &str,
    action: &str,
) -> Result<BackupOperationResult, String> {
    let start = std::time::Instant::now();
    client
        .simple_query(sql)
        .await
        .map_err(|e| format!("{} failed: {}", action, e))?
        .into_results()
        .await
        .map_err(|e| format!("{} failed: {}", action, e))?;

    Ok(BackupOperationResult {
        message: format!("{} completed successfully.", action),
        elapsed_ms: start.elapsed().as_millis() as u64,
    })
}

pub async fn get_backup_defaults(client: &mut SqlClient) -> Result<BackupDefaults, String> {
    let sql = concat!(
        "SELECT ",
        "CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS nvarchar(4000)),",
        "CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS nvarchar(4000)),",
        "CAST(SERVERPROPERTY('InstanceDefaultLogPath') AS nvarchar(4000))"
    );
    let stream = client
        .query(sql, &[])
        .await
        .map_err(|e| format!("Failed to read SQL Server default paths: {}", e))?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| format!("Failed to parse SQL Server default paths: {}", e))?;

    let row = rows.first();
    Ok(BackupDefaults {
        backup_directory: row
            .and_then(|r| r.try_get::<&str, _>(0).ok().flatten())
            .map(String::from),
        data_directory: row
            .and_then(|r| r.try_get::<&str, _>(1).ok().flatten())
            .map(String::from),
        log_directory: row
            .and_then(|r| r.try_get::<&str, _>(2).ok().flatten())
            .map(String::from),
    })
}

pub async fn backup_database(
    client: &mut SqlClient,
    request: BackupDatabaseRequest,
) -> Result<BackupOperationResult, String> {
    ensure_non_empty(&request.destination_path, "Destination path")?;
    let command = build_backup_command(
        &request.database,
        &quote_literal(request.destination_path.trim()),
        &request.backup_type,
        Some(request.overwrite),
        request.copy_only,
        request.compression,
        request.checksum,
    )?;
    execute_administrative_batch(client, &command, "Backup").await
}

pub async fn inspect_backup_file(
    client: &mut SqlClient,
    source_path: &str,
) -> Result<Vec<BackupFileInfo>, String> {
    ensure_non_empty(source_path, "Source backup file")?;
    let sql = format!(
        "RESTORE FILELISTONLY FROM DISK = {}",
        quote_literal(source_path.trim())
    );
    let stream = client
        .query(&sql, &[])
        .await
        .map_err(|e| format!("Failed to inspect backup file: {}", e))?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| format!("Failed to read backup file metadata: {}", e))?;

    Ok(rows
        .iter()
        .filter_map(|row| {
            let logical_name = row.try_get::<&str, _>(0).ok().flatten()?;
            let physical_name = row.try_get::<&str, _>(1).ok().flatten().unwrap_or("");
            let file_type = row.try_get::<&str, _>(2).ok().flatten().unwrap_or("");
            let size_bytes = row
                .try_get::<i64, _>(4)
                .ok()
                .flatten()
                .or_else(|| row.try_get::<i32, _>(4).ok().flatten().map(i64::from))
                .or_else(|| {
                    row.try_get::<tiberius::numeric::Decimal, _>(4)
                        .ok()
                        .flatten()
                        .and_then(|value| value.to_string().split('.').next()?.parse::<i64>().ok())
                })
                .unwrap_or(0);
            Some(BackupFileInfo {
                logical_name: logical_name.to_string(),
                physical_name: physical_name.to_string(),
                file_type: file_type.to_string(),
                size_bytes,
            })
        })
        .collect())
}

pub async fn restore_database(
    client: &mut SqlClient,
    request: RestoreDatabaseRequest,
) -> Result<BackupOperationResult, String> {
    ensure_non_empty(&request.source_path, "Source backup file")?;
    ensure_non_empty(&request.target_database, "Target database")?;

    let target = request.target_database.trim();
    let target_ident = quote_ident(target);
    let target_literal = quote_literal(target);

    let mut options = Vec::new();
    if request.replace_existing {
        options.push("REPLACE".to_string());
    }
    options.push(
        if request.recovery {
            "RECOVERY"
        } else {
            "NORECOVERY"
        }
        .to_string(),
    );
    if request.restricted_user {
        options.push("RESTRICTED_USER".to_string());
    }
    for file_move in request.file_moves {
        ensure_non_empty(&file_move.logical_name, "Logical file name")?;
        ensure_non_empty(&file_move.physical_name, "Physical file path")?;
        options.push(format!(
            "MOVE {} TO {}",
            quote_literal(file_move.logical_name.trim()),
            quote_literal(file_move.physical_name.trim())
        ));
    }
    options.push("STATS = 10".to_string());

    let single_user_start = if request.replace_existing {
        format!(
            "IF DB_ID({target_literal}) IS NOT NULL ALTER DATABASE {target_ident} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;"
        )
    } else {
        String::new()
    };
    let final_user_mode = if request.replace_existing && request.recovery {
        if request.restricted_user {
            format!(
                "IF DB_ID({target_literal}) IS NOT NULL AND DATABASEPROPERTYEX({target_literal}, 'Status') <> N'RESTORING' ALTER DATABASE {target_ident} SET RESTRICTED_USER;"
            )
        } else {
            format!(
                "IF DB_ID({target_literal}) IS NOT NULL AND DATABASEPROPERTYEX({target_literal}, 'Status') <> N'RESTORING' ALTER DATABASE {target_ident} SET MULTI_USER;"
            )
        }
    } else {
        String::new()
    };
    let catch_user_mode = if request.replace_existing {
        format!(
            "IF DB_ID({target_literal}) IS NOT NULL AND DATABASEPROPERTYEX({target_literal}, 'Status') <> N'RESTORING' ALTER DATABASE {target_ident} SET MULTI_USER;"
        )
    } else {
        String::new()
    };

    let sql = format!(
        "USE [master];\n\
         BEGIN TRY\n\
         {single_user_start}\n\
         RESTORE DATABASE {target_ident} FROM DISK = {source_path} WITH {options};\n\
         {final_user_mode}\n\
         END TRY\n\
         BEGIN CATCH\n\
         {catch_user_mode}\n\
         THROW;\n\
         END CATCH;",
        source_path = quote_literal(request.source_path.trim()),
        options = options.join(", ")
    );

    execute_administrative_batch(client, &sql, "Restore").await
}

fn parse_schedule_time(value: &str) -> Result<i32, String> {
    let trimmed = value.trim();
    let parts: Vec<&str> = trimmed.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return Err("Schedule time must use HH:MM or HH:MM:SS".to_string());
    }

    let hour = parts[0]
        .parse::<i32>()
        .map_err(|_| "Schedule hour is invalid".to_string())?;
    let minute = parts[1]
        .parse::<i32>()
        .map_err(|_| "Schedule minute is invalid".to_string())?;
    let second = if parts.len() == 3 {
        parts[2]
            .parse::<i32>()
            .map_err(|_| "Schedule second is invalid".to_string())?
    } else {
        0
    };

    if !(0..=23).contains(&hour) || !(0..=59).contains(&minute) || !(0..=59).contains(&second) {
        return Err("Schedule time is outside the valid range".to_string());
    }

    Ok(hour * 10000 + minute * 100 + second)
}

fn normalize_job_name(value: &str, database: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        format!("SQLQS Backup - {}", database.trim())
    } else if trimmed.to_ascii_lowercase().starts_with("sqlqs backup - ") {
        trimmed.to_string()
    } else {
        format!("SQLQS Backup - {}", trimmed)
    }
}

fn schedule_frequency_sql(request: &BackupScheduleRequest) -> Result<(i32, i32), String> {
    match request.frequency.trim().to_ascii_lowercase().as_str() {
        "daily" => Ok((4, 1)),
        "weekly" => {
            let mask: i32 = request.weekly_days.iter().copied().sum();
            if mask <= 0 {
                return Err("Choose at least one weekday for a weekly schedule".to_string());
            }
            Ok((8, mask))
        }
        "monthly" => {
            let day = request.monthly_day.unwrap_or(1);
            if !(1..=31).contains(&day) {
                return Err("Monthly schedule day must be between 1 and 31".to_string());
            }
            Ok((16, day))
        }
        _ => Err("Schedule frequency must be daily, weekly, or monthly".to_string()),
    }
}

pub async fn create_backup_schedule(
    client: &mut SqlClient,
    request: BackupScheduleRequest,
) -> Result<BackupOperationResult, String> {
    ensure_non_empty(&request.database, "Database")?;
    ensure_non_empty(&request.destination_folder, "Destination folder")?;
    let backup_type = normalize_backup_type(&request.backup_type)?;
    let active_start_time = parse_schedule_time(&request.time)?;
    let (freq_type, freq_interval) = schedule_frequency_sql(&request)?;
    let job_name = normalize_job_name(&request.job_name, &request.database);
    let schedule_name = format!("{} Schedule", job_name);
    let extension = backup_extension(backup_type);
    let file_prefix = join_server_path(
        request.destination_folder.trim(),
        &format!(
            "{}_{}_",
            sanitize_backup_file_part(&request.database),
            backup_type
        ),
    );
    let file_name_expr = format!(
        "{} + CONVERT(char(8), GETDATE(), 112) + N'_' + REPLACE(CONVERT(char(8), GETDATE(), 108), ':', '') + N'.{}'",
        quote_literal(&file_prefix),
        extension,
    );
    let command = build_backup_command(
        &request.database,
        "@backup_path",
        backup_type,
        Some(true),
        request.copy_only,
        request.compression,
        request.checksum,
    )?;
    let job_step_command = format!(
        "DECLARE @backup_path nvarchar(4000) = {};\n{};",
        file_name_expr, command
    );

    let sql = format!(
        "USE [msdb];\n\
         IF EXISTS (SELECT 1 FROM dbo.sysjobs WHERE [name] = {job_name})\n\
         BEGIN\n\
           EXEC dbo.sp_delete_job @job_name = {job_name}, @delete_unused_schedule = 1;\n\
         END;\n\
         DECLARE @active_start_date int = CONVERT(int, CONVERT(char(8), GETDATE(), 112));\n\
         EXEC dbo.sp_add_job @job_name = {job_name}, @enabled = 1, @description = {description};\n\
         EXEC dbo.sp_add_jobstep @job_name = {job_name}, @step_name = N'Run backup', @subsystem = N'TSQL', @database_name = N'master', @command = {command};\n\
         EXEC dbo.sp_add_schedule @schedule_name = {schedule_name}, @enabled = 1, @freq_type = {freq_type}, @freq_interval = {freq_interval}, @freq_recurrence_factor = 1, @freq_subday_type = 1, @active_start_date = @active_start_date, @active_start_time = {active_start_time};\n\
         EXEC dbo.sp_attach_schedule @job_name = {job_name}, @schedule_name = {schedule_name};\n\
         EXEC dbo.sp_add_jobserver @job_name = {job_name}, @server_name = N'(LOCAL)';",
        job_name = quote_literal(&job_name),
        description = quote_literal("SQL Query Studio backup schedule"),
        command = quote_literal(&job_step_command),
        schedule_name = quote_literal(&schedule_name),
    );

    execute_administrative_batch(client, &sql, "Schedule creation").await
}

fn format_sql_agent_datetime(date: i32, time: i32) -> Option<String> {
    if date <= 0 {
        return None;
    }
    let year = date / 10000;
    let month = (date / 100) % 100;
    let day = date % 100;
    let hour = time / 10000;
    let minute = (time / 100) % 100;
    let second = time % 100;
    Some(format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        year, month, day, hour, minute, second
    ))
}

pub async fn list_backup_schedules(
    client: &mut SqlClient,
) -> Result<Vec<BackupScheduleInfo>, String> {
    let sql = concat!(
        "SELECT CONVERT(nvarchar(36), j.job_id), j.name, CAST(j.enabled AS bit), s.name, ",
        "ISNULL(js.next_run_date, 0), ISNULL(js.next_run_time, 0) ",
        "FROM msdb.dbo.sysjobs j ",
        "LEFT JOIN msdb.dbo.sysjobschedules js ON j.job_id = js.job_id ",
        "LEFT JOIN msdb.dbo.sysschedules s ON js.schedule_id = s.schedule_id ",
        "WHERE j.name LIKE N'SQLQS Backup - %' ",
        "ORDER BY j.name"
    );
    let stream = client
        .query(sql, &[])
        .await
        .map_err(|e| format!("Failed to list backup schedules: {}", e))?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| format!("Failed to read backup schedules: {}", e))?;

    Ok(rows
        .iter()
        .filter_map(|row| {
            let job_id = row.try_get::<&str, _>(0).ok().flatten()?;
            let job_name = row.try_get::<&str, _>(1).ok().flatten().unwrap_or("");
            let enabled = row.try_get::<bool, _>(2).ok().flatten().unwrap_or(false);
            let schedule_name = row.try_get::<&str, _>(3).ok().flatten().map(String::from);
            let next_run_date = row.try_get::<i32, _>(4).ok().flatten().unwrap_or(0);
            let next_run_time = row.try_get::<i32, _>(5).ok().flatten().unwrap_or(0);
            Some(BackupScheduleInfo {
                job_id: job_id.to_string(),
                job_name: job_name.to_string(),
                enabled,
                schedule_name,
                next_run: format_sql_agent_datetime(next_run_date, next_run_time),
            })
        })
        .collect())
}

pub async fn delete_backup_schedule(
    client: &mut SqlClient,
    job_name: &str,
) -> Result<BackupOperationResult, String> {
    ensure_non_empty(job_name, "Job name")?;
    if !job_name
        .trim()
        .to_ascii_lowercase()
        .starts_with("sqlqs backup - ")
    {
        return Err("Only SQL Query Studio backup jobs can be deleted here".to_string());
    }
    let sql = format!(
        "USE [msdb]; EXEC dbo.sp_delete_job @job_name = {}, @delete_unused_schedule = 1;",
        quote_literal(job_name.trim())
    );
    execute_administrative_batch(client, &sql, "Schedule deletion").await
}
