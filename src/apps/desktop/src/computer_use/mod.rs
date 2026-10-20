//! Desktop Computer Use: portable admission/observation lifecycle, native OS providers.

mod ax_snapshot_digest;
pub(crate) mod control_session;
mod debug_overlay;
mod desktop_host;
pub(crate) mod grants;
mod interactive_filter;
#[cfg(target_os = "linux")]
mod linux_ax_ui;
#[cfg(target_os = "linux")]
mod linux_control;
#[cfg(target_os = "linux")]
mod linux_control_ax;
#[cfg(target_os = "macos")]
mod macos_ax_dump;
#[cfg(target_os = "macos")]
mod macos_ax_shortcuts;
#[cfg(target_os = "macos")]
mod macos_ax_ui;
#[cfg(target_os = "macos")]
mod macos_ax_write;
#[cfg(target_os = "macos")]
mod macos_bg_input;
#[cfg(target_os = "macos")]
mod macos_capture;
#[cfg(target_os = "macos")]
mod macos_input_focus;
#[cfg(target_os = "macos")]
mod macos_list_apps;
#[cfg(target_os = "macos")]
mod macos_skylight;
mod observation_cache;
mod ocr_context;
pub(crate) mod permissions;
pub(crate) mod process_identity;
mod screen_ocr;
pub(crate) mod share_grants;
mod som_overlay;
mod terminal_detect;
mod ui_locate_common;
#[cfg(target_os = "windows")]
mod windows_ax_shortcuts;
#[cfg(target_os = "windows")]
mod windows_ax_ui;
#[cfg(target_os = "windows")]
mod windows_bg_input;
#[cfg(target_os = "windows")]
mod windows_capture;
#[cfg(target_os = "windows")]
mod windows_list_apps;
#[cfg(target_os = "windows")]
mod windows_msaa;
#[cfg(target_os = "windows")]
mod windows_pointer_feedback;
#[cfg(target_os = "windows")]
mod windows_wgc_capture;

pub(crate) use desktop_host::shared_preview;
pub(crate) use desktop_host::sharing::targets as share_targets;
pub use desktop_host::DesktopComputerUseHost;

/// OS permission probes for the desktop-control settings surface, as
/// `(accessibility_granted, screen_capture_granted)`. Windows and Linux have
/// no user-facing gates for these capabilities, so they report granted;
/// macOS probes the real system state. The OHOS build does not compile this
/// module at all.
pub fn permission_probes() -> (bool, bool) {
    DesktopComputerUseHost::permission_probes()
}

#[cfg(test)]
mod integration_e2e;

#[cfg(all(feature = "devtools", target_os = "macos"))]
#[path = "desktop_host/native_control_roundtrip_tests.rs"]
pub(crate) mod native_control_roundtrip;
