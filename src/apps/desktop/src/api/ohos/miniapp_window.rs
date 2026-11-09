//! OpenHarmony independent MiniApp windows.
//!
//! The Desktop presentation contract still owns the instance registry, the
//! Worker/Agent side and the shell protocol. On HarmonyOS there is no sidecar
//! process to spawn: this adapter asks the ArkTS host to create a real
//! `WindowStage` sub-window, and that window relays the same shell protocol back
//! through the Node-API entry points below instead of the local IPC transport.
//!
//! The relay is deliberately non-blocking. An ArkWeb JavaScript proxy method
//! runs on the ArkTS UI thread, so a slow `rpc` (AI completion, Worker call)
//! must never block it: `miniapp_window_call` accepts the operation and returns
//! a request id, the shell page polls `miniapp_window_result` until the task
//! settles. Submissions and result reads are cheap Rust calls.
//!
//! This module is OHOS product code. Keep it, the `miniapp_window_*` ArkTS
//! registrations and `src/apps/ohos/.../MiniAppWindowService.ets` across
//! upstream merges; upstream does not carry them.

use napi_derive_ohos::napi;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};

static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Bounded queue of in-flight window calls. A window that closes mid-call
/// leaves one entry behind; the oldest are dropped first.
const MAX_PENDING_CALLS: usize = 256;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowRequest {
    operation: String,
    #[serde(default)]
    params: Value,
    /// Bound by the ArkTS bridge object, never by MiniApp content.
    instance_id: Option<String>,
    view_id: Option<String>,
    nonce: Option<String>,
}

impl WindowRequest {
    /// The shell protocol expects identity inside `params`.
    fn bind_identity(mut self) -> Self {
        let (Some(instance_id), Some(view_id), Some(nonce)) = (
            self.instance_id.clone(),
            self.view_id.clone(),
            self.nonce.clone(),
        ) else {
            return self;
        };
        let Some(params) = self.params.as_object_mut() else {
            return self;
        };
        params.insert("instanceId".into(), Value::String(instance_id));
        params.insert("viewId".into(), Value::String(view_id));
        params.insert("nonce".into(), Value::String(nonce));
        self
    }
}

struct PendingCall {
    result: Option<Result<Value, String>>,
}

#[derive(Default)]
struct PendingCalls {
    entries: HashMap<String, PendingCall>,
    order: VecDeque<String>,
}

fn pending_calls() -> &'static Mutex<PendingCalls> {
    static PENDING: OnceLock<Mutex<PendingCalls>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(PendingCalls::default()))
}

fn envelope(result: Result<Value, String>) -> String {
    match result {
        Ok(value) => json!({"ok": true, "result": value}).to_string(),
        Err(error) => json!({"ok": false, "error": error}).to_string(),
    }
}

fn decode_envelope(reply: &str) -> Result<Value, String> {
    let mut value: Value =
        serde_json::from_str(reply).map_err(|e| format!("Invalid HarmonyOS window reply: {e}"))?;
    let object = value
        .as_object_mut()
        .ok_or("Invalid HarmonyOS window reply")?;
    if object.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(object.remove("result").unwrap_or(Value::Null))
    } else {
        Err(object
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("HarmonyOS could not open the MiniApp window")
            .to_string())
    }
}

/// Publish the host handle before any window can call back into Rust. Setup
/// runs before the ArkTS launch page, so the first MiniApp window always
/// finds it.
pub(crate) fn install(app: &tauri::AppHandle) {
    let _ = APP_HANDLE.set(app.clone());
}

/// Create (or focus) the ArkTS window that presents one MiniApp instance.
pub(crate) async fn open_window(payload: Value) -> Result<(), String> {
    let reply =
        crate::api::ohos::window::call_host("miniapp_window_open", payload.to_string()).await?;
    decode_envelope(&reply)?;
    Ok(())
}

/// Submit one shell operation from the ArkTS window.
///
/// Returns `{ ok: true, requestId }`; the shell polls
/// [`miniapp_window_result`] for the settled envelope.
#[napi]
pub fn miniapp_window_call(request: String) -> String {
    let parsed: WindowRequest = match serde_json::from_str(&request) {
        Ok(parsed) => parsed,
        Err(error) => {
            return envelope(Err(format!("Invalid MiniApp window request: {error}")));
        }
    };
    let Some(app) = APP_HANDLE.get().cloned() else {
        return envelope(Err("The HarmonyOS MiniApp host is not ready".into()));
    };
    let request_id = uuid::Uuid::new_v4().to_string();
    {
        let mut pending = pending_calls().lock().unwrap_or_else(|p| p.into_inner());
        while pending.entries.len() >= MAX_PENDING_CALLS {
            let Some(oldest) = pending.order.pop_front() else {
                break;
            };
            pending.entries.remove(&oldest);
        }
        pending.order.push_back(request_id.clone());
        pending
            .entries
            .insert(request_id.clone(), PendingCall { result: None });
    }
    let queued = request_id.clone();
    let parsed = parsed.bind_identity();
    tauri::async_runtime::spawn(async move {
        let result =
            crate::miniapp_desktop::miniapp_window_call(&app, &parsed.operation, parsed.params)
                .await;
        let mut pending = pending_calls().lock().unwrap_or_else(|p| p.into_inner());
        if let Some(call) = pending.entries.get_mut(&queued) {
            call.result = Some(result);
        }
    });
    json!({"ok": true, "requestId": request_id}).to_string()
}

/// Read one settled window call. `{ pending: true }` means the task is still
/// running; settled calls answer with the same envelope as the sidecar protocol.
#[napi]
pub fn miniapp_window_result(request_id: String) -> String {
    let settled = {
        let mut pending = pending_calls().lock().unwrap_or_else(|p| p.into_inner());
        let Some(call) = pending.entries.get(&request_id) else {
            return envelope(Err("The MiniApp window call is no longer pending".into()));
        };
        let Some(result) = call.result.take() else {
            return json!({"pending": true}).to_string();
        };
        pending.entries.remove(&request_id);
        pending.order.retain(|id| id != &request_id);
        result
    };
    envelope(settled)
}
