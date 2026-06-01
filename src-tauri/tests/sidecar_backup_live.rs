use sqlqs_lib::sidecar::commands::{backup, connection, query};
use sqlqs_lib::sidecar::contracts::backup::{BackupRequest, RestoreFileMoveDto, RestoreRequest};
use sqlqs_lib::sidecar::contracts::connection::SqlConnectionConfig;
use sqlqs_lib::sidecar::SidecarSupervisor;

fn live_test_config() -> Option<SqlConnectionConfig> {
    let server = std::env::var("SQLQS_TEST_SERVER").ok()?;
    let username = std::env::var("SQLQS_TEST_USERNAME").ok();
    let password = std::env::var("SQLQS_TEST_PASSWORD").ok();
    let windows_auth = std::env::var("SQLQS_TEST_WINDOWS_AUTH")
        .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
        .unwrap_or(username.is_none() && password.is_none());

    Some(SqlConnectionConfig {
        server,
        port: None,
        database: None,
        username,
        password,
        use_windows_auth: windows_auth,
        encrypt: false,
        trust_server_certificate: true,
        connection_string: None,
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn backup_defaults_returns_server_paths() {
    let Some(config) = live_test_config() else {
        eprintln!("skipping: set SQLQS_TEST_SERVER to run");
        return;
    };
    let handle = SidecarSupervisor::spawn().await.expect("sidecar spawns");
    let rpc = handle.rpc();
    let opened = connection::open(&rpc, config).await.expect("open");

    let defaults = backup::defaults(&rpc, &opened.connection_id)
        .await
        .expect("backup.defaults should succeed");
    eprintln!(
        "[test] backup={:?} data={:?} log={:?}",
        defaults.backup_directory, defaults.data_directory, defaults.log_directory
    );
    assert!(
        defaults.backup_directory.is_some() || defaults.data_directory.is_some(),
        "at least one default path should be populated"
    );

    connection::close(&rpc, &opened.connection_id).await.ok();
    handle.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn backup_inspect_restore_roundtrip_against_master() {
    let Some(config) = live_test_config() else {
        return;
    };
    let handle = SidecarSupervisor::spawn().await.expect("sidecar spawns");
    let rpc = handle.rpc();
    let opened = connection::open(&rpc, config).await.expect("open");

    // Use the server's own backup directory so the path is guaranteed writable for the SQL Server service account.
    let defaults = backup::defaults(&rpc, &opened.connection_id)
        .await
        .expect("defaults");
    let backup_dir = defaults
        .backup_directory
        .clone()
        .or(defaults.data_directory.clone())
        .expect("server should advertise a backup or data directory");
    let backup_path = format!(
        "{}\\sqlqs_test_master.bak",
        backup_dir.trim_end_matches('\\')
    );

    let backup_result = backup::run(
        &rpc,
        BackupRequest {
            connection_id: opened.connection_id.clone(),
            database: "master".into(),
            destination_path: backup_path.clone(),
            backup_type: "FULL".into(),
            overwrite: true,
            copy_only: true,
            compression: false,
            checksum: true,
        },
    )
    .await
    .expect("backup.run should succeed");
    eprintln!(
        "[test] backup ok in {} ms: {}",
        backup_result.elapsed_ms, backup_result.message
    );
    assert!(backup_result.message.contains("BACKUP completed"));

    let inspect = backup::inspect(&rpc, &opened.connection_id, &backup_path)
        .await
        .expect("backup.inspect should succeed");
    assert!(!inspect.files.is_empty(), "inspect should list files");
    eprintln!(
        "[test] backup contains {} files: {:?}",
        inspect.files.len(),
        inspect
            .files
            .iter()
            .map(|f| format!("{} ({})", f.logical_name, f.file_type))
            .collect::<Vec<_>>()
    );

    let target_db = "sqlqs_master_restore_test";
    let file_moves: Vec<RestoreFileMoveDto> = inspect
        .files
        .into_iter()
        .map(|f| {
            let phys = std::path::Path::new(&f.physical_name);
            let parent = phys
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let ext = phys.extension().and_then(|e| e.to_str()).unwrap_or("");
            let dot_ext = if ext.is_empty() {
                String::new()
            } else {
                format!(".{ext}")
            };
            let new_path = format!(
                "{}\\{}_{}{}",
                parent.trim_end_matches('\\'),
                target_db,
                f.logical_name,
                dot_ext
            );
            RestoreFileMoveDto {
                logical_name: f.logical_name,
                physical_name: new_path,
            }
        })
        .collect();

    let restore_result = backup::restore(
        &rpc,
        RestoreRequest {
            connection_id: opened.connection_id.clone(),
            source_path: backup_path.clone(),
            target_database: target_db.into(),
            replace_existing: true,
            recovery: true,
            restricted_user: false,
            file_moves,
        },
    )
    .await
    .expect("backup.restore should succeed");
    eprintln!(
        "[test] restore ok in {} ms: {}",
        restore_result.elapsed_ms, restore_result.message
    );
    assert!(restore_result.message.contains("RESTORE completed"));

    // Cleanup: drop the restored DB, delete the backup file
    query::execute(
        &rpc,
        &opened.connection_id,
        &format!(
            "ALTER DATABASE [{db}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{db}];",
            db = target_db
        ),
        None,
    )
    .await
    .ok();
    let _ = std::fs::remove_file(&backup_path);

    connection::close(&rpc, &opened.connection_id).await.ok();
    handle.shutdown().await;
}
