use sqlqs_lib::sidecar::commands::{connection, query, xe};
use sqlqs_lib::sidecar::contracts::connection::SqlConnectionConfig;
use sqlqs_lib::sidecar::contracts::xe::{StartXeSessionRequest, StopXeSessionRequest};
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
async fn xe_session_captures_query_completion_events() {
    let Some(config) = live_test_config() else {
        eprintln!("skipping: set SQLQS_TEST_SERVER to run");
        return;
    };

    let handle = SidecarSupervisor::spawn().await.expect("sidecar spawns");
    let rpc = handle.rpc();
    let opened = connection::open(&rpc, config).await.expect("open");

    let session_name = "sqlqs_test_xe_session";
    let start = xe::start_session(
        &rpc,
        StartXeSessionRequest {
            connection_id: opened.connection_id.clone(),
            session_name: session_name.to_string(),
            events: Some(vec!["sqlserver.sql_batch_completed".to_string()]),
            max_memory_kb: 4096,
            max_events_retained: 1000,
        },
    )
    .await
    .expect("xe.startSession");
    eprintln!(
        "[test] started XE session '{}' with events: {:?}",
        start.session_name, start.events
    );

    // Drive a few queries to populate the ring buffer
    for i in 0..5 {
        let sql = format!("SELECT {} AS marker_{}", i, i);
        query::execute(&rpc, &opened.connection_id, &sql, None)
            .await
            .expect("driver query should succeed");
    }

    // Ring buffer has MAX_DISPATCH_LATENCY = 1 second — give the dispatcher a moment.
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

    let read = xe::read_session(&rpc, &opened.connection_id, session_name)
        .await
        .expect("xe.readSession");
    eprintln!(
        "[test] ring_buffer returned {} events ({} dropped)",
        read.events.len(),
        read.dropped_event_count
    );

    assert!(
        !read.events.is_empty(),
        "expected at least one sql_batch_completed event after driving 5 SELECTs"
    );
    let names: Vec<&str> = read.events.iter().map(|e| e.name.as_str()).collect();
    assert!(
        names.iter().any(|n| *n == "sql_batch_completed"),
        "expected 'sql_batch_completed' in {:?}",
        names
    );

    // Sample a couple of events
    for ev in read.events.iter().take(3) {
        eprintln!(
            "[test] event {} @ {} fields=[{}]",
            ev.name,
            ev.timestamp_utc,
            ev.fields
                .iter()
                .take(3)
                .map(|(k, v)| format!("{}=\"{}\"", k, v.chars().take(40).collect::<String>()))
                .collect::<Vec<_>>()
                .join(", ")
        );
    }

    xe::stop_session(
        &rpc,
        StopXeSessionRequest {
            connection_id: opened.connection_id.clone(),
            session_name: session_name.to_string(),
            drop: true,
        },
    )
    .await
    .expect("xe.stopSession");

    connection::close(&rpc, &opened.connection_id).await.ok();
    handle.shutdown().await;
}
