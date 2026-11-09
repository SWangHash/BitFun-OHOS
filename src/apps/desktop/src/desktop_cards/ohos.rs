//! HarmonyOS desktop-card windows.
//!
//! The OHOS Tauri host exposes only the main window, so cards are ArkUI
//! subwindows created by `DesktopCardWindowService.ets`. This adapter owns the
//! host side: it keeps the set of open cards, projects card records into the
//! native view model, and forwards open/close/resize/update over the ArkTS
//! bridge registered as `desktop_card_window_ohos`.
//!
//! The bridge is one-way for presentation. Card interactions travel back
//! through `#[napi]` functions in this module, which re-enter the owning
//! `DesktopCards` service through the shared host-request handle.

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use bitfun_core::agentic::tools::desktop_card_host::{
    DesktopCardHostRequest, DesktopCardRecord, DesktopCardSize,
};
use bitfun_core::util::{call_arkts_string_function, wait_for_arkts_function};
use napi_derive_ohos::napi;
use serde_json::{json, Value};

use super::view_model::{self, CronView, ViewLabels};
use super::windows::{card_size, window_label};

/// ArkTS function that owns subwindow lifecycle and card presentation.
const HOST_FUNCTION: &str = "desktop_card_window_ohos";
const HOST_FUNCTION_WAIT: Duration = Duration::from_secs(10);

fn open_cards() -> &'static Mutex<HashSet<String>> {
    static OPEN_CARDS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    OPEN_CARDS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn remember_open(card_id: &str) {
    if let Ok(mut cards) = open_cards().lock() {
        cards.insert(card_id.to_string());
    }
}

pub(crate) fn forget_open(card_id: &str) {
    if let Ok(mut cards) = open_cards().lock() {
        cards.remove(card_id);
    }
}

pub(crate) fn is_open(card_id: &str) -> bool {
    open_cards()
        .lock()
        .map(|cards| cards.contains(card_id))
        .unwrap_or(false)
}

/// Labels use the same `desktop-card-<id>` shape as native windows so
/// `windows::card_id_from_label` keeps working.
pub(crate) fn open_card_labels() -> Vec<String> {
    open_cards()
        .lock()
        .map(|cards| cards.iter().map(|id| window_label(id)).collect())
        .unwrap_or_default()
}

async fn host_call(payload: Value) -> Result<String, String> {
    call_arkts_string_function(HOST_FUNCTION, payload.to_string()).await
}

fn spawn_host_call(payload: Value) {
    let action = payload
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = host_call(payload).await {
            log::warn!(
                "Desktop card host call failed: action={}, error={}",
                action,
                error
            );
        }
    });
}

/// Labels are localized once per process; the app language only changes through
/// a settings restart in practice.
fn cached_labels() -> &'static Mutex<Option<ViewLabels>> {
    static LABELS: OnceLock<Mutex<Option<ViewLabels>>> = OnceLock::new();
    LABELS.get_or_init(|| Mutex::new(None))
}

async fn labels() -> ViewLabels {
    if let Ok(guard) = cached_labels().lock() {
        if let Some(labels) = guard.as_ref() {
            return ViewLabels {
                other: labels.other.clone(),
                remaining: labels.remaining.clone(),
            };
        }
    }
    let language = match bitfun_core::service::config::global::GlobalConfigManager::get_service()
        .await
    {
        Ok(service) => service
            .get_config::<String>(Some("app.language"))
            .await
            .unwrap_or_default(),
        Err(_) => String::new(),
    };
    let labels = ViewLabels::for_language(&language);
    if let Ok(mut guard) = cached_labels().lock() {
        *guard = Some(ViewLabels {
            other: labels.other.clone(),
            remaining: labels.remaining.clone(),
        });
    }
    labels
}

async fn cron_view(job_id: &str) -> Option<CronView> {
    let service = bitfun_core::service::cron::get_global_cron_service()?;
    let job = service.get_job(job_id).await?;
    let state = &job.state;
    Some(CronView {
        name: job.name.clone(),
        enabled: job.enabled,
        next_run_at_ms: state.next_run_at_ms.or(state.retry_at_ms),
        last_run_at_ms: state
            .last_run_finished_at_ms
            .or(state.last_run_started_at_ms),
        last_status: state
            .last_run_status
            .and_then(|status| serde_json::to_value(status).ok())
            .and_then(|value| value.as_str().map(str::to_string)),
        last_error: state.last_error.clone().filter(|error| !error.is_empty()),
    })
}

async fn build_view(card: &DesktopCardRecord) -> Value {
    let labels = labels().await;
    let mut view = view_model::build(card, &labels);
    if let Some(job_id) = view.cron_job_id.clone() {
        view.cron = cron_view(&job_id).await;
    }
    match serde_json::to_value(&view) {
        Ok(value) => value,
        Err(error) => {
            log::warn!(
                "Failed to serialize desktop card view model: card_id={}, error={}",
                view.card_id,
                error
            );
            json!({
                "cardId": view.card_id,
                "title": view.title,
                "kind": view.kind,
                "tone": view.tone,
                "visible": view.visible,
                "stacking": {
                    "alwaysOnTop": view.stacking.always_on_top,
                    "desktopPinned": view.stacking.desktop_pinned,
                    "pinFailure": view.stacking.pin_failure,
                },
                "unsupported": "serialization",
            })
        }
    }
}

fn size_value(size: DesktopCardSize) -> Value {
    json!({ "width": size.width, "height": size.height })
}

pub(crate) async fn open_window(
    _app: &tauri::AppHandle,
    card: &DesktopCardRecord,
    position: Option<bitfun_core::agentic::tools::desktop_card_host::DesktopCardPosition>,
) -> Result<(), String> {
    if !wait_for_arkts_function(HOST_FUNCTION, HOST_FUNCTION_WAIT).await {
        return Err("The HarmonyOS card window service is unavailable.".to_string());
    }
    let view = build_view(card).await;
    let payload = json!({
        "action": "open",
        "cardId": card.id,
        "view": view,
        "size": size_value(card_size(card)),
        "position": position.map(|position| json!({ "x": position.x, "y": position.y })),
        "alwaysOnTop": card.always_on_top,
    });
    host_call(payload).await.map_err(|error| {
        format!(
            "Failed to open the HarmonyOS desktop card window: {error}"
        )
    })?;
    remember_open(&card.id);
    Ok(())
}

pub(crate) fn close_window(_app: &tauri::AppHandle, card_id: &str) {
    forget_open(card_id);
    spawn_host_call(json!({ "action": "close", "cardId": card_id }));
}

pub(crate) fn apply_window_size(
    _app: &tauri::AppHandle,
    card_id: &str,
    size: DesktopCardSize,
) {
    spawn_host_call(json!({
        "action": "resize",
        "cardId": card_id,
        "size": size_value(size),
    }));
}

pub(crate) async fn apply_stacking(
    _app: &tauri::AppHandle,
    card_id: &str,
    _always_on_top: bool,
    desktop_pinned: bool,
) -> Result<(), String> {
    // Pinning is rejected before this call (Windows-only). ArkUI subwindows
    // cannot join the global topmost band, so the preference is recorded but
    // not enforced; the card keeps normal stacking.
    if desktop_pinned {
        return Err("Pinning cards to the desktop is supported only on Windows.".to_string());
    }
    host_call(json!({ "action": "focus", "cardId": card_id }))
        .await
        .map(|_| ())
}

pub(crate) fn bring_to_front(_app: &tauri::AppHandle, card_id: &str) {
    spawn_host_call(json!({ "action": "focus", "cardId": card_id }));
}

/// Pushes a changed card to its open subwindow, or closes it when the record
/// is gone or hidden.
pub(crate) fn push_changed(card_id: &str, card: Option<&DesktopCardRecord>, deleted: bool) {
    if !is_open(card_id) {
        return;
    }
    if deleted || card.is_none() || !card.is_some_and(|card| card.visible) {
        close_window_async(card_id);
        return;
    }
    let Some(card) = card else {
        return;
    };
    let card = card.clone();
    tauri::async_runtime::spawn(async move {
        let view = build_view(&card).await;
        if let Err(error) = host_call(json!({
            "action": "update",
            "cardId": card.id,
            "view": view,
        }))
        .await
        {
            log::warn!(
                "Failed to update the HarmonyOS desktop card window: card_id={}, error={}",
                card.id,
                error
            );
        }
    });
}

fn close_window_async(card_id: &str) {
    forget_open(card_id);
    spawn_host_call(json!({ "action": "close", "cardId": card_id }));
}

fn payload_string<'a>(payload: &'a Value, field: &str) -> Option<&'a str> {
    payload.get(field).and_then(Value::as_str)
}

fn payload_number(payload: &Value, field: &str) -> Option<f64> {
    payload.get(field).and_then(Value::as_f64)
}

fn card_id_of(payload: &Value) -> Result<String, String> {
    payload_string(payload, "cardId")
        .filter(|card_id| !card_id.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Desktop card action is missing cardId.".to_string())
}

/// Turns one ArkTS card interaction into the matching host request.
fn build_action_request(action: &str, payload: &Value) -> Result<DesktopCardHostRequest, String> {
    let card_id = card_id_of(payload)?;
    match action {
        "hide" => Ok(DesktopCardHostRequest::Hide { card_id }),
        "show" => Ok(DesktopCardHostRequest::Show { card_id }),
        "delete" => Ok(DesktopCardHostRequest::Delete { card_id }),
        "refresh" => Ok(DesktopCardHostRequest::Refresh { card_id }),
        "checklist" => {
            let item_id = payload_string(payload, "itemId")
                .filter(|item_id| !item_id.is_empty())
                .ok_or_else(|| "Checklist update is missing itemId.".to_string())?;
            let done = payload
                .get("done")
                .and_then(Value::as_bool)
                .ok_or_else(|| "Checklist update is missing done.".to_string())?;
            Ok(DesktopCardHostRequest::SetChecklistItem {
                card_id,
                item_id: item_id.to_string(),
                done,
            })
        }
        "stacking" => Ok(DesktopCardHostRequest::SetAlwaysOnTop {
            card_id,
            always_on_top: payload
                .get("alwaysOnTop")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            desktop_pinned: payload.get("desktopPinned").and_then(Value::as_bool),
        }),
        "geometry" => Ok(DesktopCardHostRequest::RecordGeometry {
            card_id,
            position: match (
                payload_number(payload, "x"),
                payload_number(payload, "y"),
            ) {
                (Some(x), Some(y)) => Some(
                    bitfun_core::agentic::tools::desktop_card_host::DesktopCardPosition { x, y },
                ),
                _ => None,
            },
            size: match (
                payload_number(payload, "width"),
                payload_number(payload, "height"),
            ) {
                (Some(width), Some(height)) => Some(
                    bitfun_core::agentic::tools::desktop_card_host::DesktopCardSize {
                        width,
                        height,
                    },
                ),
                _ => None,
            },
        }),
        "openSource" => Ok(DesktopCardHostRequest::OpenSourceSession { card_id }),
        other => Err(format!("Unsupported desktop card action: {other}")),
    }
}

/// Called by the ArkTS card page for header/body interactions. Fire-and-forget:
/// the resulting record always comes back through the change push, so the page
/// never waits on a mutation.
#[napi]
pub fn desktop_card_ohos_action(action: String, payload: String) {
    tauri::async_runtime::spawn(async move {
        let value: Value = match serde_json::from_str(&payload) {
            Ok(value) => value,
            Err(error) => {
                log::warn!(
                    "Invalid HarmonyOS desktop card payload: action={}, error={}",
                    action,
                    error
                );
                return;
            }
        };
        if action == "openLink" {
            let Some(url) = payload_string(&value, "url") else {
                log::warn!("Desktop card openLink action is missing url");
                return;
            };
            match bitfun_core::agentic::tools::desktop_card_host::validate_web_url(
                "desktop card link",
                url,
            ) {
                Ok(url) => {
                    if let Err(error) = crate::api::system_api::open_external_ohos(url).await {
                        log::warn!("Failed to open desktop card link: error={}", error);
                    }
                }
                Err(error) => log::warn!("Refused desktop card link: error={}", error),
            }
            return;
        }
        let request = match build_action_request(&action, &value) {
            Ok(request) => request,
            Err(error) => {
                log::warn!(
                    "Rejected HarmonyOS desktop card action: action={}, error={}",
                    action,
                    error
                );
                return;
            }
        };
        if let Err(error) =
            bitfun_core::agentic::tools::desktop_card_host::invoke_desktop_card_host(request).await
        {
            log::warn!(
                "HarmonyOS desktop card action failed: action={}, error={}",
                action,
                error
            );
        }
    });
}

/// The subwindow is gone (system destroy or service cleanup), so the host must
/// stop counting it as open.
#[napi]
pub fn desktop_card_ohos_closed(card_id: String) {
    forget_open(&card_id);
}
