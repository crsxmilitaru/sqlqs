use sqlqs_lib::sidecar::commands::{connection, query};
use sqlqs_lib::sidecar::contracts::connection::SqlConnectionConfig;
use sqlqs_lib::sidecar::SidecarSupervisor;

fn live_test_config() -> Option<SqlConnectionConfig> {
    let server = std::env::var("SQLQS_TEST_SERVER").ok()?;
    Some(SqlConnectionConfig {
        server,
        port: None,
        database: None,
        username: std::env::var("SQLQS_TEST_USERNAME").ok(),
        password: std::env::var("SQLQS_TEST_PASSWORD").ok(),
        use_windows_auth: std::env::var("SQLQS_TEST_WINDOWS_AUTH")
            .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
            .unwrap_or(true),
        encrypt: false,
        trust_server_certificate: true,
        connection_string: None,
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn print_and_raiserror_message_shapes() {
    let Some(config) = live_test_config() else {
        return;
    };
    let handle = SidecarSupervisor::spawn().await.expect("sidecar spawns");
    let rpc = handle.rpc();
    let opened = connection::open(&rpc, config).await.expect("open");

    let response = query::execute(
        &rpc,
        &opened.connection_id,
        "PRINT 'Hello from PRINT';\
         RAISERROR ('Informational via raiserror', 0, 1) WITH NOWAIT;\
         RAISERROR ('Warning via raiserror', 10, 2) WITH NOWAIT;\
         SELECT 1 AS x;",
        None,
    )
    .await
    .expect("query.execute should succeed (RAISERROR severity <= 10 should not abort)");

    eprintln!("=== {} messages ===", response.messages.len());
    for (i, msg) in response.messages.iter().enumerate() {
        eprintln!("[{}] {}", i, msg);
    }
    eprintln!("=== result_sets={} ===", response.result_sets.len());

    assert_eq!(
        response.messages.len(),
        3,
        "expected PRINT + 2 RAISERROR messages"
    );
    assert_eq!(
        response.result_sets.len(),
        1,
        "the SELECT must still produce its result set"
    );

    let print_msg = &response.messages[0];
    assert!(
        print_msg.starts_with("Msg 0, Level 0,"),
        "PRINT must use Msg 0/Level 0; got: {print_msg}"
    );
    assert!(
        print_msg.contains("\nHello from PRINT"),
        "PRINT body on second line; got: {print_msg}"
    );

    let info_msg = &response.messages[1];
    assert!(
        info_msg.starts_with("Msg 50000, Level 0,"),
        "RAISERROR severity 0 -> Level 0; got: {info_msg}"
    );
    assert!(info_msg.contains("\nInformational via raiserror"));

    let warn_msg = &response.messages[2];
    assert!(
        warn_msg.starts_with("Msg 50000, Level"),
        "RAISERROR severity 10 -> Level 10; got: {warn_msg}"
    );
    assert!(warn_msg.contains("\nWarning via raiserror"));

    let aborted = query::execute(
        &rpc,
        &opened.connection_id,
        "RAISERROR ('boom', 16, 3) WITH NOWAIT; SELECT 1;",
        None,
    )
    .await;
    assert!(
        aborted.is_err(),
        "severity-16 RAISERROR must surface as an Err, not a message"
    );
    eprintln!("[test] severity-16 RAISERROR returned: {:?}", aborted.err());

    connection::close(&rpc, &opened.connection_id).await.ok();
    handle.shutdown().await;
}
