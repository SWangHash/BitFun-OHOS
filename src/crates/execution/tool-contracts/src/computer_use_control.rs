//! Portable control-resource facts. Native resources and permission decisions live in hosts.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ControlMode {
    Observe,
    #[default]
    Background,
    Foreground,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ControlSnapshot {
    pub supported: bool,
    pub generation: u64,
    pub owner: Option<String>,
    pub mode: ControlMode,
    pub state: String,
    pub target: Option<String>,
    pub action: Option<String>,
    pub sequence: u64,
    pub reason: Option<String>,
    pub pointer: Option<ControlPointer>,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlPointer {
    pub x: f64,
    pub y: f64,
    pub click: bool,
    #[serde(default)]
    pub sequence: u64,
    #[serde(default)]
    pub occurred_at_ms: u64,
    #[serde(default)]
    pub last_click: Option<ControlClick>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlClick {
    pub x: f64,
    pub y: f64,
    pub sequence: u64,
    pub occurred_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlStartRequest {
    #[serde(default)]
    pub mode: ControlMode,
}

/// Explicit action classification, not a loop/count heuristic.
pub fn action_requires_foreground(action: &str) -> bool {
    matches!(
        action,
        "click"
            | "mouse_move"
            | "pointer_move_rel"
            | "scroll"
            | "drag"
            | "key_chord"
            | "type_text"
            | "paste"
            | "click_target"
            | "move_to_target"
            | "click_element"
            | "move_to_text"
            | "open_app"
            | "focus_display"
            | "run_apple_script"
            | "run_script"
            | "open_url"
            | "open_file"
    )
}

pub fn action_is_observation(action: &str) -> bool {
    matches!(
        action,
        "screenshot"
            | "describe_screen"
            | "locate"
            | "wait"
            | "list_displays"
            | "list_apps"
            | "get_app_state"
            | "get_app_shortcuts"
            | "app_wait_for"
            | "build_interactive_view"
            | "build_visual_mark_view"
            | "get_os_info"
            | "clipboard_get"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_payloads_do_not_grant_control() {
        let old: ControlSnapshot = serde_json::from_str("{}").unwrap();
        assert!(!old.supported);
        assert!(old.owner.is_none());
        let round: ControlSnapshot =
            serde_json::from_value(serde_json::to_value(old).unwrap()).unwrap();
        assert!(!round.supported);
        let pointer: ControlPointer =
            serde_json::from_str(r#"{"x":1.0,"y":2.0,"click":false}"#).unwrap();
        assert_eq!(pointer.sequence, 0);
        assert!(pointer.last_click.is_none());
        let pointer: ControlPointer =
            serde_json::from_value(serde_json::to_value(pointer).unwrap()).unwrap();
        assert_eq!((pointer.x, pointer.y), (1.0, 2.0));
        assert_eq!(
            serde_json::from_str::<ControlStartRequest>("{}")
                .unwrap()
                .mode,
            ControlMode::Background
        );
    }
    #[test]
    fn seat_actions_never_claim_background_semantics() {
        for action in ["paste", "drag", "click_target", "key_chord", "open_app"] {
            assert!(action_requires_foreground(action));
            assert!(!action_is_observation(action));
        }
        assert!(!action_requires_foreground("app_click"));
        assert!(action_is_observation("get_app_state"));
    }
}
