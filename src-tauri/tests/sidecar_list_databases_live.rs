use sqlqs_lib::sidecar::commands::{connection, schema};
use sqlqs_lib::sidecar::contracts::connection::SqlConnectionConfig;
use sqlqs_lib::sidecar::SidecarSupervisor;

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
async fn open_close_and_list_databases_against_local_sql_server() {
    let Some(config) = live_test_config() else {
        eprintln!(
            "skipping: set SQLQS_TEST_SERVER (and optionally SQLQS_TEST_USERNAME/PASSWORD or SQLQS_TEST_WINDOWS_AUTH=true) to run"
        );
        return;
    };

    let handle = SidecarSupervisor::spawn()
        .await
        .expect("sidecar should spawn");
    let rpc = handle.rpc();

    let opened = connection::open(&rpc, config)
        .await
        .expect("connection.open should succeed");

    assert!(!opened.connection_id.is_empty(), "connection id present");
    assert!(!opened.server_version.is_empty(), "server version present");
    eprintln!(
        "[test] connected to {} (version {}); connection id = {}",
        opened.server_name, opened.server_version, opened.connection_id
    );

    let databases = schema::list_databases(&rpc, &opened.connection_id)
        .await
        .expect("schema.listDatabases should succeed");
    assert!(
        !databases.databases.is_empty(),
        "should see at least the system databases"
    );

    let names: Vec<&str> = databases
        .databases
        .iter()
        .map(|d| d.name.as_str())
        .collect();
    assert!(
        names.iter().any(|n| n.eq_ignore_ascii_case("master")),
        "system database 'master' should appear in {:?}",
        names
    );
    eprintln!(
        "[test] sidecar returned {} databases: {:?}",
        names.len(),
        names
    );

    connection::close(&rpc, &opened.connection_id)
        .await
        .expect("connection.close should succeed");

    handle.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn full_schema_introspection_against_local_sql_server() {
    let Some(config) = live_test_config() else {
        eprintln!("skipping: set SQLQS_TEST_SERVER to run");
        return;
    };

    let handle = SidecarSupervisor::spawn().await.expect("sidecar spawns");
    let rpc = handle.rpc();

    let opened = connection::open(&rpc, config).await.expect("open");

    connection::change_database(&rpc, &opened.connection_id, "master")
        .await
        .expect("connection.changeDatabase to master");
    eprintln!("[test] connection.changeDatabase('master') ok");

    let tables = schema::list_tables(&rpc, &opened.connection_id, "master")
        .await
        .expect("schema.listTables(master)");
    eprintln!(
        "[test] schema.listTables(master) -> {} objects",
        tables.objects.len()
    );

    let catalog = schema::list_schema_catalog(&rpc, &opened.connection_id, "master")
        .await
        .expect("schema.listSchemaCatalog(master)");
    eprintln!(
        "[test] schema.listSchemaCatalog(master) -> {} entries (first 3: {:?})",
        catalog.entries.len(),
        catalog
            .entries
            .iter()
            .take(3)
            .map(|e| format!(
                "{}.{} [{}] ({} cols, {} params)",
                e.schema_name,
                e.object_name,
                e.object_kind,
                e.columns.len(),
                e.parameters.len()
            ))
            .collect::<Vec<_>>()
    );

    if let Some(sample) = tables
        .objects
        .iter()
        .find(|o| o.object_type == "VIEW" || o.object_type == "TABLE")
    {
        let cols = schema::list_columns(
            &rpc,
            &opened.connection_id,
            "master",
            &sample.schema_name,
            &sample.name,
        )
        .await
        .expect("schema.listColumns");
        eprintln!(
            "[test] schema.listColumns(master.{}.{}) -> {} columns",
            sample.schema_name,
            sample.name,
            cols.columns.len()
        );
        assert!(
            !cols.columns.is_empty(),
            "sample object {}.{} should have columns",
            sample.schema_name,
            sample.name
        );

        let _idx = schema::list_indexes(
            &rpc,
            &opened.connection_id,
            "master",
            &sample.schema_name,
            &sample.name,
        )
        .await
        .expect("schema.listIndexes");

        let _fks = schema::list_foreign_keys(
            &rpc,
            &opened.connection_id,
            "master",
            &sample.schema_name,
            &sample.name,
        )
        .await
        .expect("schema.listForeignKeys");
        eprintln!("[test] schema.listIndexes + schema.listForeignKeys ok");
    } else {
        eprintln!(
            "[test] no sample VIEW/TABLE found in master; skipping columns/indexes/FK checks"
        );
    }

    connection::close(&rpc, &opened.connection_id).await.ok();
    handle.shutdown().await;
}
