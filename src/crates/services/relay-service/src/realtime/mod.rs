//! Account / machine / session scoped realtime transport, following Happy's
//! Socket.IO update, ephemeral and acknowledged RPC contracts.
//!
//! Reference: slopus/happy @ 108a337e87a5653b604250a9ac3e3bd873dba551.
//! OpenBitFun keeps GitHub device credentials and host-owned execution; the
//! relay stores only opaque encrypted messages and versioned metadata.
mod device_lifecycle;
mod origin;
mod payloads;
mod presence;
pub(crate) mod store;

use crate::{db::AuthToken, routes::api::AppState};
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{any, get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use socketioxide::{
    extract::{AckSender, SocketRef, TryData},
    handler::ConnectHandler,
    SocketIo,
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, Weak},
    time::Duration,
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

#[derive(Clone)]
struct Identity {
    account: String,
    device: String,
    token: String,
    scope: Scope,
    session: Option<String>,
    account_calls: Arc<Semaphore>,
    server_calls: Arc<Semaphore>,
    _connection: Arc<OwnedSemaphorePermit>,
}
#[derive(Clone, Copy, Deserialize, PartialEq)]
enum Scope {
    #[serde(rename = "user-scoped")]
    User,
    #[serde(rename = "machine-scoped")]
    Machine,
    #[serde(rename = "session-scoped")]
    Session,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Handshake {
    token: String,
    client_type: Scope,
    machine_id: Option<String>,
    session_id: Option<String>,
}
#[derive(Deserialize)]
struct Method {
    method: String,
}
#[derive(Deserialize)]
struct Call {
    method: String,
    params: Value,
    #[serde(default, rename = "timeoutMs")]
    timeout_ms: Option<u64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MachineEvent {
    target_device_id: String,
    params: Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetadataUpdate {
    sid: String,
    metadata: String,
    expected_version: i64,
}

fn account_room(account: &str) -> String {
    format!("user:{account}")
}
fn rpc_room(account: &str, method: &str) -> String {
    format!("rpc:{account}:{method}")
}
fn failure(error: &str) -> Value {
    json!({"ok":false,"error":error})
}

async fn authorized(state: &AppState, identity: &Identity) -> bool {
    matches!(AuthToken::find(&state.db,&identity.token).await,
        Ok(Some(auth)) if auth.user_id==identity.account && auth.can_control_devices())
}

fn can_register(identity: &Identity, method: &str) -> bool {
    if method.len() > 256 {
        return false;
    }
    let Some((owner, name)) = method.split_once(':') else {
        return false;
    };
    if name.is_empty()
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-:".contains(&b))
    {
        return false;
    }
    match identity.scope {
        Scope::Machine => owner == identity.device,
        Scope::Session => identity.session.as_deref() == Some(owner),
        Scope::User => false,
    }
}

/// Include JSON container/node overhead, strings and task/ack state. This is
/// deliberately conservative and independent from request count.
fn rpc_memory_cost(value: &Value) -> usize {
    fn node(value: &Value) -> usize {
        let nested = match value {
            Value::String(text) => text.len().saturating_mul(4),
            Value::Array(values) => values.iter().map(node).fold(0usize, usize::saturating_add),
            Value::Object(values) => values
                .iter()
                .map(|(key, value)| key.len().saturating_mul(4).saturating_add(node(value)))
                .fold(0usize, usize::saturating_add),
            _ => 0,
        };
        128usize.saturating_add(nested)
    }
    4096usize.saturating_add(node(value))
}

/// Construct once per Relay host. Socket.IO owns heartbeat, framing, rooms and
/// acknowledgement lifetime. Platform clients do not implement competing RPC
/// correlation registries in their UI or feature modules.
pub(crate) fn mount(router: Router<AppState>, state: AppState) -> Router<AppState> {
    let (layer, io) = SocketIo::builder()
        .req_path("/v1/updates")
        .ping_interval(Duration::from_secs(15))
        .ping_timeout(Duration::from_secs(45))
        .connect_timeout(Duration::from_secs(15))
        .ack_timeout(Duration::from_secs(30))
        .max_buffer_size(128)
        .max_payload(256 * 1024)
        .build_layer();
    let connections = Arc::new(Semaphore::new(4096));
    // Admission accounts for retained JSON and per-call state rather than an
    // arbitrary number of requests. Bulk ciphertext travels through HTTP.
    let server_calls = Arc::new(Semaphore::new(64 * 1024 * 1024));
    let account_budgets: Arc<Mutex<HashMap<String, Weak<Semaphore>>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let auth_state = state.clone();
    let handler_state = state.clone();
    let handler_io = io.clone();
    io.ns(
        "/",
        (move |socket: SocketRef| {
            let state = handler_state.clone();
            let io = handler_io.clone();
            async move {
                install(socket, state, io).await;
            }
        })
        .with(
            move |socket: SocketRef, TryData(data): TryData<Handshake>| {
                let state = auth_state.clone();
                let connections = connections.clone();
                let server_calls = server_calls.clone();
                let account_budgets = account_budgets.clone();
                async move {
                    let data = data.map_err(|_| "invalid authentication payload")?;
                    if !origin::is_websocket_origin_allowed(
                        &socket.req_parts().headers,
                        &state.cors_allow_origins,
                    ) {
                        return Err("origin is not allowed");
                    }
                    let permit = connections
                        .try_acquire_owned()
                        .map_err(|_| "connection capacity exceeded")?;
                    let auth = AuthToken::find(&state.db, &data.token)
                        .await
                        .map_err(|_| "authentication unavailable")?
                        .filter(|auth| auth.can_control_devices())
                        .ok_or("invalid or expired token")?;
                    let device = auth
                        .routing_device_id(&state.db)
                        .await
                        .map_err(|_| "device identity unavailable")?;
                    match data.client_type {
                        Scope::Machine
                            if !auth.is_device_token()
                                || data.machine_id.as_deref().is_some_and(|id| id != device) =>
                        {
                            return Err("machine identity mismatch")
                        }
                        Scope::Session => {
                            let id = data.session_id.as_deref().ok_or("sessionId required")?;
                            let session = store::get_session(&state.db, &auth.user_id, id)
                                .await
                                .map_err(|_| "session unavailable")?
                                .ok_or("session not found")?;
                            if !auth.is_device_token() || session.machine_id != device {
                                return Err("session owner mismatch");
                            }
                        }
                        _ => {}
                    }
                    let account_calls = {
                        let mut budgets = account_budgets
                            .lock()
                            .map_err(|_| "account capacity unavailable")?;
                        budgets.retain(|_, budget| budget.strong_count() > 0);
                        if let Some(budget) = budgets.get(&auth.user_id).and_then(Weak::upgrade) {
                            budget
                        } else {
                            let budget = Arc::new(Semaphore::new(16 * 1024 * 1024));
                            budgets.insert(auth.user_id.clone(), Arc::downgrade(&budget));
                            budget
                        }
                    };
                    socket.extensions.insert(Identity {
                        account: auth.user_id,
                        device,
                        token: data.token,
                        scope: data.client_type,
                        session: data.session_id,
                        account_calls,
                        server_calls,
                        _connection: Arc::new(permit),
                    });
                    Ok(())
                }
            },
        ),
    );
    router
        // Own the Engine.IO path explicitly. A host may replace its fallback
        // with ServeDir after construction; Socket.IO must remain a route.
        .route("/v1/updates", any(|| async { StatusCode::NOT_FOUND }))
        .route("/v1/updates/", any(|| async { StatusCode::NOT_FOUND }))
        .route(
            "/v1/rpc/payloads",
            post(payloads::upload).layer(axum::extract::DefaultBodyLimit::disable()),
        )
        .route("/v1/rpc/payloads/{id}", get(payloads::download))
        .layer(axum::Extension(payloads::Payloads::new()))
        .route("/v1/sessions", post(open_session))
        .route("/v1/sessions/{id}", get(get_session))
        .route(
            "/v3/sessions/{id}/messages",
            get(read_messages)
                .post(write_messages)
                .layer(axum::extract::DefaultBodyLimit::max(store::MAX_BATCH_BYTES)),
        )
        .layer(axum::Extension(io))
        .layer(layer)
}

async fn install(socket: SocketRef, state: AppState, io: SocketIo) {
    let Some(identity) = socket.extensions.get::<Identity>() else {
        let _ = socket.disconnect();
        return;
    };
    socket.join(account_room(&identity.account));
    socket.join(format!(
        "user:{}:device:{}",
        identity.account, identity.device
    ));
    if identity.scope == Scope::User {
        socket.join(format!("user:{}:user-scoped", identity.account));
    }
    if identity.scope == Scope::Machine
        && !presence::register(&socket, &state, &identity, &io).await
    {
        let _ = socket.disconnect();
        return;
    }

    if let Some(session) = &identity.session {
        socket.join(format!("user:{}:session:{session}", identity.account));
    }
    let auth_socket = socket.clone();
    let auth_identity = identity.clone();
    let auth_state = state.clone();
    // Also applies to idle sockets. Revoked credentials cannot keep receiving
    // another device's encrypted traffic indefinitely after logout.
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(5));
        loop {
            timer.tick().await;
            if !auth_socket.connected() {
                break;
            }
            if !authorized(&auth_state, &auth_identity).await {
                let _ = auth_socket.disconnect();
                break;
            }
        }
    });

    let register_state = state.clone();
    socket.on(
        "rpc-register",
        move |socket: SocketRef, TryData(data): TryData<Method>, ack: AckSender| {
            let state = register_state.clone();
            async move {
                let Some(identity) = socket.extensions.get::<Identity>() else {
                    return;
                };
                let Ok(data) = data else {
                    let _ = ack.send(&failure("invalid method"));
                    return;
                };
                if !authorized(&state, &identity).await || !can_register(&identity, &data.method) {
                    let _ = ack.send(&failure("method registration forbidden"));
                    return;
                }
                socket.join(rpc_room(&identity.account, &data.method));
                let _ = socket.emit("rpc-registered", &json!({"method":data.method}));
                let _ = ack.send(&json!({"ok":true}));
            }
        },
    );
    socket.on(
        "rpc-unregister",
        |socket: SocketRef, TryData(data): TryData<Method>, ack: AckSender| async move {
            let Some(identity) = socket.extensions.get::<Identity>() else {
                return;
            };
            if let Ok(data) = data {
                socket.leave(rpc_room(&identity.account, &data.method));
                let _ = ack.send(&json!({"ok":true}));
            } else {
                let _ = ack.send(&failure("invalid method"));
            }
        },
    );
    let rpc_state = state.clone();
    let rpc_io = io.clone();
    socket.on("rpc-call",move |socket:SocketRef,TryData(data):TryData<Call>,ack:AckSender| {
        let state=rpc_state.clone(); let io=rpc_io.clone();
        async move {
            let Some(identity)=socket.extensions.get::<Identity>() else { return; };
            let Ok(data)=data else { let _=ack.send(&failure("invalid RPC")); return; };
            let timeout_ms = data.timeout_ms.unwrap_or(120_000);
            if timeout_ms == 0 || timeout_ms > i32::MAX as u64 { let _=ack.send(&failure("invalid RPC timeout")); return; }
            let call_deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms);
            let reservation = rpc_memory_cost(&data.params).saturating_add(data.method.len()).min(u32::MAX as usize) as u32;
            let Ok(_account_permit) = identity.account_calls.clone().try_acquire_many_owned(reservation) else { let _=ack.send(&failure("account RPC memory budget busy; request was not submitted")); return; };
            let Ok(_server_permit) = identity.server_calls.clone().try_acquire_many_owned(reservation) else { let _=ack.send(&failure("server RPC memory budget busy; request was not submitted")); return; };
            if data.method.len()>256 || !authorized(&state,&identity).await { let _=ack.send(&failure("RPC forbidden")); return; }
            let room=rpc_room(&identity.account,&data.method);
            // Happy's reconnect grace belongs to target lookup, before dispatch.
            // After dispatch, a missing acknowledgement is UNKNOWN, never a
            // reason to execute the mutation again on a replacement socket.
            let deadline=(tokio::time::Instant::now()+Duration::from_secs(15)).min(call_deadline);
            let target=loop {
                let targets=io.within(room.clone()).sockets();
                if targets.len()>1 { let _=ack.send(&failure("multiple RPC owners")); return; }
                if let Some(target)=targets.into_iter().next() { break target; }
                if tokio::time::Instant::now()>=deadline || !socket.connected() {
                    let _=ack.send(&failure("RPC target unavailable")); return;
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
            };
            if target.id==socket.id { let _=ack.send(&failure("RPC self-call forbidden")); return; }
            let Some(target_identity)=target.extensions.get::<Identity>() else { let _=ack.send(&failure("RPC target unavailable")); return; };
            if !authorized(&state,&identity).await || !authorized(&state,&target_identity).await {
                let _=ack.send(&failure("RPC authorization expired")); return;
            }
            let remaining = call_deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() { let _=ack.send(&failure("RPC deadline elapsed before dispatch")); return; }
            let request=json!({"method":data.method,"params":data.params,"sourceDeviceId":identity.device,"timeoutMs":remaining.as_millis()});
            let response=match target.timeout(remaining).emit_with_ack::<_,Value>("rpc-request",&request) {
                Ok(pending)=>match pending.await {
                    Ok(value)=>match value.get("$relayError").and_then(Value::as_str) {
                        Some(error) => failure(error),
                        None => json!({"ok":true,"result":value}),
                    },
                    Err(_)=>failure("RPC acknowledgement lost; delivery outcome is unknown"),
                },
                Err(_)=>failure("RPC target unavailable before dispatch"),
            };
            let _=ack.send(&response);
        }
    });
    let event_state = state.clone();
    let event_io = io.clone();
    socket.on("machine-event",move |socket:SocketRef,TryData(data):TryData<MachineEvent>,ack:AckSender| {
        let state=event_state.clone(); let io=event_io.clone();
        async move {
            let Some(identity)=socket.extensions.get::<Identity>() else{return;};
            let Ok(data)=data else {let _=ack.send(&failure("invalid event"));return;};
            if identity.scope!=Scope::Machine || !authorized(&state,&identity).await {let _=ack.send(&failure("event forbidden"));return;}
            let room=format!("user:{}:device:{}",identity.account,data.target_device_id);
            let targets=io.within(room).sockets();
            if targets.is_empty(){let _=ack.send(&failure("event target offline"));return;}
            let event=json!({"type":"device-event","sourceDeviceId":identity.device,"params":data.params});
            let mut sent=false;
            for target in targets {
                if target.emit("ephemeral",&event).is_ok(){sent=true;}else{let _=target.disconnect();}
            }
            let _=ack.send(&json!({"ok":sent}));
        }
    });
    let metadata_state = state.clone();
    let metadata_io = io.clone();
    socket.on(
        "update-metadata",
        move |socket: SocketRef, TryData(data): TryData<MetadataUpdate>, ack: AckSender| {
            let state = metadata_state.clone();
            let io = metadata_io.clone();
            async move {
                let Some(identity) = socket.extensions.get::<Identity>() else {
                    return;
                };
                let Ok(data) = data else {
                    let _ = ack.send(&failure("invalid metadata update"));
                    return;
                };
                if !authorized(&state, &identity).await {
                    let _ = ack.send(&failure("authorization expired"));
                    return;
                }
                match store::update_metadata(
                    &state.db,
                    &identity.account,
                    &data.sid,
                    data.expected_version,
                    &data.metadata,
                )
                .await
                {
                    Ok(mut result) => {
                        if let Some(update) = result
                            .as_object_mut()
                            .and_then(|result| result.remove("update"))
                        {
                            for target in io.within(account_room(&identity.account)).sockets() {
                                if target.emit("update", &update).is_err() {
                                    let _ = target.disconnect();
                                }
                            }
                        }
                        let _ = ack.send(&result);
                    }
                    Err(_) => {
                        let _ = ack.send(&failure("metadata update failed"));
                    }
                }
            }
        },
    );
    let _ = socket.emit(
        "auth-ok",
        &json!({"userId":identity.account,"deviceId":identity.device}),
    );
    presence::broadcast(&io, &state, &identity.account);
}

async fn http_identity(state: &AppState, headers: &HeaderMap) -> Result<AuthToken, StatusCode> {
    let token =
        crate::routes::auth::extract_bearer_token(headers).ok_or(StatusCode::UNAUTHORIZED)?;
    AuthToken::find(&state.db, &token)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .filter(|auth| auth.can_control_devices())
        .ok_or(StatusCode::UNAUTHORIZED)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenSession {
    id: String,
    metadata: String,
}
async fn open_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(data): Json<OpenSession>,
) -> Result<Json<Value>, StatusCode> {
    let identity = http_identity(&state, &headers).await?;
    if !identity.is_device_token() {
        return Err(StatusCode::FORBIDDEN);
    }
    let session = store::open_session(
        &state.db,
        &identity.user_id,
        &identity.device_id,
        &data.id,
        &data.metadata,
    )
    .await
    .map_err(|_| StatusCode::CONFLICT)?;
    Ok(Json(json!({"session":session})))
}
async fn get_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    let identity = http_identity(&state, &headers).await?;
    let session = store::get_session(&state.db, &identity.user_id, &id)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(json!({"session":session})))
}
#[derive(Deserialize)]
struct ReadMessages {
    after_seq: Option<i64>,
    before_seq: Option<i64>,
    limit: Option<usize>,
}

#[cfg(test)]
mod history_route_tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn engine_handshake_survives_host_static_fallback() {
        let app = crate::build_relay_router(
            Arc::new(crate::MemoryAssetStore::new()),
            std::time::Instant::now(),
            Arc::new(crate::db::connect(":memory:").await.unwrap()),
            "test",
        )
        .fallback(|| async { "static page" });
        for path in ["/v1/updates", "/v1/updates/"] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(format!("{path}?EIO=4&transport=polling"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let body = to_bytes(response.into_body(), 4096).await.unwrap();
            assert!(body.starts_with(b"0{"), "Engine.IO open packet expected");
        }
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/index.html")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            to_bytes(response.into_body(), 4096).await.unwrap(),
            "static page"
        );
    }

    // Happy's initial page uses a backward sentinel; subsequent pages keep
    // separate oldest and newest cursors. Exercise the real HTTP contract.
    #[tokio::test]
    async fn latest_page_and_forward_recovery_share_the_same_messages() {
        let db = Arc::new(crate::db::connect(":memory:").await.unwrap());
        crate::db::UserRow::create(&db, "owner", "owner")
            .await
            .unwrap();
        crate::db::DeviceRow::upsert(&db, "host", "owner", "host", None, None)
            .await
            .unwrap();
        let token = AuthToken::create(&db, "owner", "host").await.unwrap().token;
        store::open_session(&db, "owner", "host", "history", "opaque")
            .await
            .unwrap();
        for batch in 0..3 {
            let messages = (0..50)
                .map(|index| store::NewMessage {
                    local_id: format!("message-{}", batch * 50 + index),
                    content: "opaque".into(),
                })
                .collect::<Vec<_>>();
            store::append(&db, "owner", "history", &messages)
                .await
                .unwrap();
        }
        let app = crate::build_relay_router(
            Arc::new(crate::MemoryAssetStore::new()),
            std::time::Instant::now(),
            db,
            "test",
        );
        let request = |query: &str| {
            Request::builder()
                .uri(format!("/v3/sessions/history/messages?{query}"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap()
        };
        for (query, first, last, more) in [
            ("before_seq=9007199254740991&limit=100", 150, 51, true),
            ("before_seq=51&limit=100", 50, 1, false),
            ("after_seq=148&limit=100", 149, 150, false),
        ] {
            let response = app.clone().oneshot(request(query)).await.unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let value: Value =
                serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
                    .unwrap();
            let messages = value["messages"].as_array().unwrap();
            assert_eq!(messages.first().unwrap()["seq"], first);
            assert_eq!(messages.last().unwrap()["seq"], last);
            assert_eq!(value["hasMore"], more);
        }
        assert_eq!(
            app.oneshot(request("after_seq=0&before_seq=100"))
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
}
async fn read_messages(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<ReadMessages>,
) -> Result<Json<store::MessagePage>, StatusCode> {
    let identity = http_identity(&state, &headers).await?;
    if store::get_session(&state.db, &identity.user_id, &id)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .is_none()
    {
        return Err(StatusCode::NOT_FOUND);
    }
    if query.after_seq.is_some() && query.before_seq.is_some() {
        return Err(StatusCode::BAD_REQUEST);
    }
    store::read(
        &state.db,
        &identity.user_id,
        &id,
        query.after_seq.unwrap_or(0),
        query.before_seq,
        query.limit.unwrap_or(100),
    )
    .await
    .map(Json)
    .map_err(|_| StatusCode::BAD_REQUEST)
}
#[derive(Deserialize)]
struct WriteMessages {
    messages: Vec<store::NewMessage>,
}
async fn write_messages(
    State(state): State<AppState>,
    axum::Extension(io): axum::Extension<SocketIo>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(data): Json<WriteMessages>,
) -> Result<Json<Value>, StatusCode> {
    let identity = http_identity(&state, &headers).await?;
    let messages = store::append(&state.db, &identity.user_id, &id, &data.messages)
        .await
        .map_err(|_| StatusCode::CONFLICT)?;
    for (message, user_seq) in &messages {
        if let Some(seq) = user_seq {
            // Commit precedes notification. A disconnect here loses only the
            // hint; after_seq always recovers the committed message.
            let update = json!({"id":message.id,"seq":seq,"createdAt":message.created_at,"body":{"t":"new-message","sid":id,"message":message}});
            let rooms = [
                format!("user:{}:user-scoped", identity.user_id),
                format!("user:{}:session:{id}", identity.user_id),
            ];
            for socket in io.within(rooms).sockets() {
                if socket.emit("update", &update).is_err() {
                    let _ = socket.disconnect();
                }
            }
        }
    }
    Ok(Json(
        json!({"messages":messages.into_iter().map(|(m,_)|m).collect::<Vec<_>>()}),
    ))
}
