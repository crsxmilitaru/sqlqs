use crate::db::BackupScheduleRequest;

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

pub fn build_create_schedule_sql(request: &BackupScheduleRequest) -> Result<String, String> {
    ensure_non_empty(&request.database, "Database")?;
    ensure_non_empty(&request.destination_folder, "Destination folder")?;
    let backup_type = normalize_backup_type(&request.backup_type)?;
    let active_start_time = parse_schedule_time(&request.time)?;
    let (freq_type, freq_interval) = schedule_frequency_sql(request)?;
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

    Ok(format!(
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
    ))
}

pub fn build_delete_schedule_sql(job_name: &str) -> Result<String, String> {
    ensure_non_empty(job_name, "Job name")?;
    if !job_name
        .trim()
        .to_ascii_lowercase()
        .starts_with("sqlqs backup - ")
    {
        return Err("Only SQL Query Studio backup jobs can be deleted here".to_string());
    }
    Ok(format!(
        "USE [msdb]; EXEC dbo.sp_delete_job @job_name = {}, @delete_unused_schedule = 1;",
        quote_literal(job_name.trim())
    ))
}

pub const LIST_SCHEDULES_SQL: &str =
    "SELECT CONVERT(nvarchar(36), j.job_id), j.name, CAST(j.enabled AS bit), s.name, \
ISNULL(js.next_run_date, 0), ISNULL(js.next_run_time, 0) \
FROM msdb.dbo.sysjobs j \
LEFT JOIN msdb.dbo.sysjobschedules js ON j.job_id = js.job_id \
LEFT JOIN msdb.dbo.sysschedules s ON js.schedule_id = s.schedule_id \
WHERE j.name LIKE N'SQLQS Backup - %' \
ORDER BY j.name";

pub fn format_sql_agent_datetime(date: i32, time: i32) -> Option<String> {
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
