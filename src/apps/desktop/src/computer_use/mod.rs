//! Desktop Computer use host (screenshots + enigo).

mod ax_snapshot_digest;
mod debug_overlay;
mod desktop_host;
mod interactive_filter;
#[cfg(target_os = "linux")]
mod linux_ax_ui;
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
mod macos_list_apps;
#[cfg(target_os = "macos")]
mod macos_skylight;
mod ocr_context;
mod screen_ocr;
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
mod windows_wgc_capture;

pub use desktop_host::DesktopComputerUseHost;

/// OS permission probes for the desktop-control settings surface, as
/// `(accessibility_granted, screen_capture_granted)`. The OHOS build has no
/// desktop host and no probeable accessibility gate; the screen-capture
/// privacy gate is surfaced by the OS at first use instead.
#[cfg(not(target_env = "ohos"))]
pub fn permission_probes() -> (bool, bool) {
    desktop_host::permission_probes()
}

#[cfg(target_env = "ohos")]
pub fn permission_probes() -> (bool, bool) {
    (true, true)
}

#[cfg(test)]
mod integration_e2e;
