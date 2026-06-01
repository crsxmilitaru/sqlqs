use sqlqs_lib::sidecar::commands::{connection, query, scripting};
use sqlqs_lib::sidecar::contracts::connection::SqlConnectionConfig;
use sqlqs_lib::sidecar::contracts::scripting::ScriptOptions;
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
async fn script_real_table_via_smo() {
    let Some(config) = live_test_config() else {
        eprintln!("skipping: set SQLQS_TEST_SERVER to run");
        return;
    };

    let handle = SidecarSupervisor::spawn().await.expect("sidecar spawns");
    let rpc = handle.rpc();
    let opened = connection::open(&rpc, config).await.expect("open");

    // Create a real table in master.dbo with various features so SMO has something interesting to script.
    let setup = "
        IF OBJECT_ID('master.dbo.sqlqs_smo_test') IS NOT NULL DROP TABLE master.dbo.sqlqs_smo_test;
        CREATE TABLE master.dbo.sqlqs_smo_test (
            id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_sqlqs_smo_test PRIMARY KEY,
            name NVARCHAR(100) NOT NULL,
            created_at DATETIME2 NOT NULL CONSTRAINT DF_sqlqs_smo_created DEFAULT SYSUTCDATETIME(),
            score DECIMAL(10,2) NULL,
            CONSTRAINT chk_sqlqs_smo_score CHECK (score IS NULL OR score >= 0)
        );
        CREATE INDEX IX_sqlqs_smo_test_name ON master.dbo.sqlqs_smo_test (name);
    ";
    query::execute(&rpc, &opened.connection_id, setup, None)
        .await
        .expect("setup should succeed");

    let response = scripting::script_object(
        &rpc,
        &opened.connection_id,
        "master",
        "dbo",
        "sqlqs_smo_test",
        "TABLE",
        Some(ScriptOptions::ssms_defaults()),
    )
    .await
    .expect("scripting.scriptObject should succeed");

    eprintln!(
        "[test] SMO script ({} chars):\n{}",
        response.script.len(),
        response.script
    );

    let s = response.script.to_lowercase();
    assert!(
        s.contains("create table"),
        "script must include CREATE TABLE"
    );
    assert!(s.contains("identity"), "script must preserve IDENTITY");
    assert!(s.contains("primary key"), "script must include primary key");
    assert!(
        s.contains("ix_sqlqs_smo_test_name") || s.contains("create index"),
        "script should include the secondary index"
    );
    assert!(
        s.contains("default"),
        "script should include the DEFAULT clause"
    );
    assert!(
        s.contains("check"),
        "script should include the CHECK constraint"
    );

    query::execute(
        &rpc,
        &opened.connection_id,
        "DROP TABLE IF EXISTS master.dbo.sqlqs_smo_test",
        None,
    )
    .await
    .ok();

    connection::close(&rpc, &opened.connection_id).await.ok();
    handle.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn script_existing_system_view_via_smo() {
    let Some(config) = live_test_config() else {
        return;
    };
    let handle = SidecarSupervisor::spawn().await.expect("sidecar spawns");
    let rpc = handle.rpc();
    let opened = connection::open(&rpc, config).await.expect("open");

    // Pick a stable system view that exists on every SQL Server instance.
    let response = scripting::script_object(
        &rpc,
        &opened.connection_id,
        "master",
        "sys",
        "all_objects",
        "VIEW",
        Some(ScriptOptions::ssms_defaults()),
    )
    .await
    .expect("scripting.scriptObject should succeed for sys.all_objects");

    eprintln!(
        "[test] sys.all_objects script ({} chars)",
        response.script.len()
    );
    assert!(!response.script.is_empty(), "script should not be empty");
    assert!(
        response.script.to_lowercase().contains("create view"),
        "should contain CREATE VIEW"
    );

    connection::close(&rpc, &opened.connection_id).await.ok();
    handle.shutdown().await;
}
