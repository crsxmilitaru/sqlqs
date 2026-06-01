use sqlqs_lib::sidecar::commands::{connection, query};
use sqlqs_lib::sidecar::contracts::connection::SqlConnectionConfig;
use sqlqs_lib::sidecar::SidecarSupervisor;
use tokio_util::sync::CancellationToken;

fn live_test_config() -> Option<SqlConnectionConfig> {
    let server = std::env::var("SQLQS_TEST_SERVER").ok()?;
    let username = std::env::var("SQLQS_TEST_USERNAME").ok();
    let password = std::env::var("SQLQS_TEST_PASSWORD").ok();
    let windows_auth = std::env::var("SQLQS_TEST_WINDOWS_AUTH")
        .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
        .unwrap_or(username.is_none() && password.is_none());
    let trust = std::env::var("SQLQS_TEST_TRUST_CERT")
        .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
        .unwrap_or(true);
    let encrypt = std::env::var("SQLQS_TEST_ENCRYPT")
        .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
        .unwrap_or(false);

    Some(SqlConnectionConfig {
        server,
        port: None,
        database: None,
        username,
        password,
        use_windows_auth: windows_auth,
        encrypt,
        trust_server_certificate: trust,
        connection_string: None,
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn execute_simple_select_returns_typed_rows() {
    let Some(config) = live_test_config() else {
        eprintln!("skipping: set SQLQS_TEST_SERVER to run");
        return;
    };

    let handle = SidecarSupervisor::spawn().await.expect("sidecar spawns");
    let rpc = handle.rpc();
    let opened = connection::open(&rpc, config).await.expect("open");

    let response = query::execute(
        &rpc,
        &opened.connection_id,
        "SELECT 1 AS one, CAST(2.5 AS DECIMAL(5,2)) AS two_point_five, N'hello' AS greeting, NULL AS nothing, CAST(GETDATE() AS DATETIME2) AS now",
        None,
    )
    .await
    .expect("query.execute should succeed");

    assert_eq!(response.result_sets.len(), 1);
    let rs = &response.result_sets[0];
    assert_eq!(rs.columns.len(), 5);
    assert_eq!(rs.rows.len(), 1);
    assert_eq!(rs.columns[0].name, "one");
    assert_eq!(rs.columns[3].name, "nothing");
    assert!(
        rs.rows[0][3].is_null(),
        "NULL cell should serialize as JSON null"
    );
    eprintln!("[test] elapsed_ms={}", response.elapsed_ms);
    eprintln!("[test] row: {:?}", rs.rows[0]);

    connection::close(&rpc, &opened.connection_id).await.ok();
    handle.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn execute_multi_resultset_and_messages() {
    let Some(config) = live_test_config() else {
        return;
    };
    let handle = SidecarSupervisor::spawn().await.expect("sidecar spawns");
    let rpc = handle.rpc();
    let opened = connection::open(&rpc, config).await.expect("open");

    let response = query::execute(
        &rpc,
        &opened.connection_id,
        "PRINT 'first message'; SELECT 1 AS a; PRINT 'second message'; SELECT 2 AS b, 3 AS c;",
        None,
    )
    .await
    .expect("multi-resultset query should succeed");

    assert_eq!(response.result_sets.len(), 2, "should see two result sets");
    assert_eq!(response.result_sets[0].columns[0].name, "a");
    assert_eq!(response.result_sets[1].columns.len(), 2);
    assert!(
        response
            .messages
            .iter()
            .any(|m| m.contains("first message")),
        "messages: {:?}",
        response.messages
    );
    assert!(
        response
            .messages
            .iter()
            .any(|m| m.contains("second message")),
        "messages: {:?}",
        response.messages
    );
    eprintln!(
        "[test] {} result sets, {} messages",
        response.result_sets.len(),
        response.messages.len()
    );

    connection::close(&rpc, &opened.connection_id).await.ok();
    handle.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn execute_cancellation_via_cancel_request() {
    let Some(config) = live_test_config() else {
        return;
    };
    let handle = SidecarSupervisor::spawn().await.expect("sidecar spawns");
    let rpc = handle.rpc();
    let opened = connection::open(&rpc, config).await.expect("open");

    let cancel = CancellationToken::new();
    let exec = tokio::spawn({
        let rpc = rpc.clone();
        let id = opened.connection_id.clone();
        let cancel = cancel.clone();
        async move {
            query::execute_cancellable(
                &rpc,
                &id,
                "WAITFOR DELAY '00:00:30'; SELECT 1",
                None,
                cancel,
            )
            .await
        }
    });

    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    cancel.cancel();

    let start = std::time::Instant::now();
    let result = exec.await.expect("task joins");
    let elapsed = start.elapsed();

    assert!(
        result.is_err(),
        "cancelled WAITFOR should fail; got Ok in {:?}",
        elapsed
    );
    assert!(
        elapsed < std::time::Duration::from_secs(5),
        "cancel should fire fast; took {:?}",
        elapsed
    );
    eprintln!(
        "[test] cancellation came back in {:?}: {:?}",
        elapsed,
        result.err()
    );

    connection::close(&rpc, &opened.connection_id).await.ok();
    handle.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn execute_respects_max_rows_truncation() {
    let Some(config) = live_test_config() else {
        return;
    };
    let handle = SidecarSupervisor::spawn().await.expect("sidecar spawns");
    let rpc = handle.rpc();
    let opened = connection::open(&rpc, config).await.expect("open");

    let response = query::execute(
        &rpc,
        &opened.connection_id,
        "SELECT TOP 100 number FROM master.dbo.spt_values WHERE type='P' AND number BETWEEN 1 AND 100",
        Some(10),
    )
    .await
    .expect("limited query");

    assert_eq!(response.result_sets.len(), 1);
    assert_eq!(
        response.result_sets[0].rows.len(),
        10,
        "should be truncated to 10 rows"
    );
    assert!(response.result_sets[0].truncated);
    assert_eq!(response.row_limit_applied, Some(10));
    eprintln!(
        "[test] truncated to 10/100 rows, row_limit_applied={:?}",
        response.row_limit_applied
    );

    connection::close(&rpc, &opened.connection_id).await.ok();
    handle.shutdown().await;
}
