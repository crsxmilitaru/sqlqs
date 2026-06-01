use sqlqs_lib::sidecar::SidecarSupervisor;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sidecar_spawns_and_responds_to_health_ping() {
    let handle = SidecarSupervisor::spawn()
        .await
        .expect("sidecar should spawn");

    let pong = handle.ping().await.expect("health.ping should succeed");

    assert!(
        !pong.sidecar_version.is_empty(),
        "version should be non-empty"
    );
    assert_eq!(pong.protocol_version, 1, "protocol version should be 1");
    assert!(
        pong.runtime_description.contains(".NET"),
        "runtime description should mention .NET, got: {}",
        pong.runtime_description
    );
    assert!(pong.process_id > 0, "process id should be positive");
    assert!(
        pong.uptime_milliseconds < 60_000,
        "uptime should be under a minute for a fresh process"
    );

    let second = handle.ping().await.expect("second ping should succeed");
    assert!(
        second.uptime_milliseconds >= pong.uptime_milliseconds,
        "uptime should be monotonic"
    );

    handle.shutdown().await;
}
