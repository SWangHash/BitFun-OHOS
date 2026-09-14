//! Account-backed Pages adapter contracts against a local Relay fixture.
use super::*;
use crate::agentic::tools::page_publish_host::PagePublishHostRequest;
use crate::product_runtime::account_pages::{account_availability, deploy, publish};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn request() -> PagePublishHostRequest {
    PagePublishHostRequest {
        slug: "demo".into(),
        visibility: "public".into(),
        title: Some("Demo".into()),
        note: None,
        deploy: true,
        directory: None,
        files: Some(std::collections::HashMap::from([(
            "index.html".into(),
            "Hello".into(),
        )])),
    }
}

async fn logged_in(relay: String) -> Arc<AccountRuntime> {
    let runtime = super::tests::test_runtime();
    *runtime.account_context.write().await = Some(AccountContextState {
        session: AccountSession::new("test-pages-token".into(), "user-a".into(), [0; 32]),
        relay_url: relay,
    });
    runtime
}

fn page() -> Value {
    json!({"slug":"demo", "generation":"generation-a", "visibility":"public", "title":"Demo",
        "file_count":1, "total_bytes":5, "created_at":1, "updated_at":1,
        "url_path":"/p/demo", "deployed_version_id":"v1"})
}

async fn relay(
    responses: Vec<(&'static str, Value)>,
) -> (String, tokio::task::JoinHandle<Vec<Value>>) {
    relay_with_hook(responses, Arc::new(|_| {})).await
}

async fn relay_with_hook(
    responses: Vec<(&'static str, Value)>,
    hook: Arc<dyn Fn(usize) + Send + Sync>,
) -> (String, tokio::task::JoinHandle<Vec<Value>>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let mut bodies = Vec::new();
        for (index, (expected, response)) in responses.into_iter().enumerate() {
            let (mut socket, _) = tokio::time::timeout(Duration::from_secs(10), listener.accept())
                .await
                .unwrap()
                .unwrap();
            let mut data = Vec::new();
            let header_end = loop {
                let mut chunk = [0; 4096];
                let n = socket.read(&mut chunk).await.unwrap();
                assert!(n > 0);
                data.extend_from_slice(&chunk[..n]);
                if let Some(i) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                    break i + 4;
                }
            };
            let headers = String::from_utf8_lossy(&data[..header_end]);
            assert!(
                headers.starts_with(expected),
                "unexpected request: {}",
                headers.lines().next().unwrap()
            );
            assert!(headers
                .to_ascii_lowercase()
                .contains("authorization: bearer test-pages-token"));
            let length: usize = headers
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .map(|v| v.trim().parse().unwrap())
                })
                .unwrap_or(0);
            while data.len() < header_end + length {
                let mut chunk = [0; 4096];
                let n = socket.read(&mut chunk).await.unwrap();
                assert!(n > 0);
                data.extend_from_slice(&chunk[..n]);
            }
            bodies.push(if length == 0 {
                Value::Null
            } else {
                serde_json::from_slice(&data[header_end..header_end + length]).unwrap()
            });
            hook(index);
            let body = response.to_string();
            let wire = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
            socket.write_all(wire.as_bytes()).await.unwrap();
        }
        bodies
    });
    (url, task)
}

#[tokio::test]
async fn page_account_availability_tracks_identity_and_runtime_lifetime() {
    let runtime = logged_in("http://127.0.0.1:1".into()).await;
    let available = account_availability(&runtime);
    assert!(available().await);
    let transition = runtime.begin_account_transition().await;
    assert!(!available().await);
    transition.finish();
    assert!(available().await);
    runtime.mark_token_expired();
    assert!(!available().await);
    assert!(publish(&runtime, request())
        .await
        .unwrap_err()
        .contains("expired"));
    runtime.token_expired.store(false, Ordering::Relaxed);
    *runtime.account_context.write().await = None;
    assert!(!available().await);
    assert!(deploy(&runtime, "demo", "v1")
        .await
        .unwrap_err()
        .contains("not logged in"));
    drop(runtime);
    assert!(!available().await);
}

#[tokio::test]
async fn page_publish_uploads_inline_content_and_deploys_with_legacy_relay() {
    let (url, server) = relay(vec![
        ("GET /api/pages ", json!([])),
        (
            "POST /api/pages/check-files ",
            json!({"needed":["index.html"]}),
        ),
        ("POST /api/pages/upload-files ", json!({})),
        // Old relay payload omits generation; the existing compatibility path remains valid.
        (
            "POST /api/pages/demo/versions ",
            json!({"version_id":"v1", "title":"Demo", "file_count":1,
            "total_bytes":5, "has_worker":false, "note":"", "created_at":1, "deployed":false,
            "preview_url_path":"/preview/demo/v1"}),
        ),
        ("POST /api/pages/demo/deploy ", page()),
    ])
    .await;
    let runtime = logged_in(url.clone()).await;
    let result = publish(&runtime, request()).await.unwrap();
    assert_eq!(result["url"], format!("{url}/p/demo"));
    assert_eq!(result["preview_url"], format!("{url}/preview/demo/v1"));
    assert_eq!(result["deployed"], true);
    assert!(!result.to_string().contains("test-pages-token"));
    let bodies = server.await.unwrap();
    assert_eq!(bodies[1]["files"][0]["path"], "index.html");
    assert_eq!(bodies[2]["files"]["index.html"]["content"], "SGVsbG8=");
    assert_eq!(bodies[4]["version_id"], "v1");
}

#[tokio::test]
async fn page_deploy_uses_saved_generation_without_uploading() {
    let (url, server) = relay(vec![
        ("GET /api/pages ", json!([page()])),
        ("POST /api/pages/demo/deploy ", page()),
    ])
    .await;
    let runtime = logged_in(url.clone()).await;
    let result = deploy(&runtime, "demo", "v1").await.unwrap();
    assert_eq!(result["url"], format!("{url}/p/demo"));
    let bodies = server.await.unwrap();
    assert_eq!(bodies[1]["expected_generation"], "generation-a");
    assert_eq!(bodies[1]["version_id"], "v1");
}

#[tokio::test]
async fn page_deploy_stops_if_account_changes_during_lookup() {
    let runtime = logged_in("http://127.0.0.1:1".into()).await;
    let changed = runtime.clone();
    let (url, server) = relay_with_hook(
        vec![("GET /api/pages ", json!([page()]))],
        Arc::new(move |_| {
            changed
                .account_context_generation
                .fetch_add(1, Ordering::AcqRel);
        }),
    )
    .await;
    runtime
        .account_context
        .write()
        .await
        .as_mut()
        .unwrap()
        .relay_url = url;
    assert_eq!(
        deploy(&runtime, "demo", "v1").await.unwrap_err(),
        "account context changed"
    );
    assert_eq!(server.await.unwrap().len(), 1);
}

#[tokio::test]
async fn page_deploy_does_not_report_success_after_account_changes() {
    let runtime = logged_in("http://127.0.0.1:1".into()).await;
    let changed = runtime.clone();
    let (url, server) = relay_with_hook(
        vec![
            ("GET /api/pages ", json!([page()])),
            ("POST /api/pages/demo/deploy ", page()),
        ],
        Arc::new(move |index| {
            if index == 1 {
                changed
                    .account_context_generation
                    .fetch_add(1, Ordering::AcqRel);
            }
        }),
    )
    .await;
    runtime
        .account_context
        .write()
        .await
        .as_mut()
        .unwrap()
        .relay_url = url;
    assert!(deploy(&runtime, "demo", "v1")
        .await
        .unwrap_err()
        .contains("outcome is unknown"));
    server.await.unwrap();
}
