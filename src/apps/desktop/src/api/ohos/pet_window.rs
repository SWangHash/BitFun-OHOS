//! HarmonyOS bridge for the Agent companion pet window.
//!
//! On HarmonyOS the pet lives in its own ArkUI window owned by
//! `AgentCompanionAbility`, whose page hosts a plain ArkWeb. That webview has no
//! Tauri IPC, so this module owns the pieces that must cross the boundary:
//!
//! * main window -> pet window: the main window keeps publishing
//!   `agent-companion://settings-updated` and `agent-companion://activity-updated`
//!   through `emit`. Tauri delivers those to every JS webview *and* to Rust
//!   listeners, so the forwarder below taps them and hands them to ArkTS, which
//!   injects them into the pet page.
//! * window lifecycle (show/hide/geometry): ArkTS owns the windows, so these
//!   helpers only forward requests to the host functions ArkTS registers.
//!
//! The opposite direction (pet -> main window commands) is injected into the main
//! webview by ArkTS and never passes through Rust.

use crate::api::ohos::window::call_host;

/// Events the pet window needs from the main window. Desktop delivers these
/// through the shared Tauri event bus; on HarmonyOS the pet's webview sits
/// outside that bus, so they are forwarded explicitly.
const FORWARDED_EVENTS: [&str; 2] = [
    "agent-companion://settings-updated",
    "agent-companion://activity-updated",
];

/// Reject sizes that cannot describe a window before they reach ArkTS.
fn validate_rect(width: f64, height: f64) -> Result<(), String> {
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err(format!(
            "Invalid Agent companion window size: {width}x{height}"
        ));
    }
    Ok(())
}

/// Ask ArkTS to show (or reuse) the pet window, loading `page_path` from the
/// packaged frontend.
///
/// The page path keeps the desktop entry query so the same bundle selects the
/// pet root. ArkTS resolves the frontend directory itself: the HAP install
/// layout is only observable from the ArkTS context (`bundleCodeDir`), and
/// probing it there keeps this bridge free of path assumptions.
pub(crate) async fn show(page_path: &str) -> Result<(), String> {
    let request = serde_json::json!({ "path": page_path });
    call_host("pet_window_show", request.to_string())
        .await
        .map(|_| ())
}

/// Ask ArkTS to hide the pet window without tearing the ability down.
pub(crate) async fn hide() -> Result<(), String> {
    call_host("pet_window_hide", String::new())
        .await
        .map(|_| ())
}

/// Size the pet window to the dock's CSS pixel box. ArkTS converts to physical
/// pixels with the window's scale factor and drops requests whose size did not
/// change, because a redundant `resizeAsync` flickers while a move is settling.
pub(crate) async fn set_rect(width: f64, height: f64) -> Result<(), String> {
    validate_rect(width, height)?;
    let request = serde_json::json!({ "width": width, "height": height });
    call_host("pet_window_set_rect", request.to_string())
        .await
        .map(|_| ())
}

/// Forward one main-window event into the pet window.
pub(crate) async fn deliver(event_name: &str, payload_json: &str) -> Result<(), String> {
    // `payload` must stay structured: the pet page parses it exactly like the
    // desktop window parses a Tauri event payload.
    let payload =
        serde_json::from_str::<serde_json::Value>(payload_json).unwrap_or(serde_json::Value::Null);
    let request = serde_json::json!({ "event": event_name, "payload": payload });
    call_host("pet_window_deliver", request.to_string())
        .await
        .map(|_| ())
}

/// Tap the Agent companion events the main window publishes and forward them to
/// the pet window. Registered once during setup. A failed forward is expected
/// before the pet window exists, so it is only logged at debug level.
pub(crate) fn start_event_forwarder(app: &tauri::AppHandle) {
    use tauri::Listener;

    for event_name in FORWARDED_EVENTS {
        let name = event_name.to_string();
        app.listen_any(event_name, move |event| {
            let name = name.clone();
            let payload = event.payload().to_string();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = deliver(&name, &payload).await {
                    log::debug!(
                        "Agent companion event not delivered to the HarmonyOS pet window: event={} error={}",
                        name,
                        error
                    );
                }
            });
        });
    }
    log::info!("Agent companion pet window event forwarder registered");
}

#[cfg(test)]
mod tests {
    use super::validate_rect;

    #[test]
    fn rejects_unusable_window_sizes() {
        for (width, height) in [
            (0.0, 10.0),
            (10.0, 0.0),
            (f64::NAN, 10.0),
            (-1.0, 10.0),
            (f64::INFINITY, 10.0),
        ] {
            let error = validate_rect(width, height)
                .expect_err("unusable size must be rejected before reaching ArkTS");
            assert!(
                error.contains("Invalid Agent companion window size"),
                "{error}"
            );
        }
    }

    #[test]
    fn accepts_a_normal_dock_box() {
        assert!(validate_rect(188.0, 104.0).is_ok());
    }
}
