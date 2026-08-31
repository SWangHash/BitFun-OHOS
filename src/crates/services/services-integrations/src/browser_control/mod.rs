//! Browser control integration services.
//!
//! This module owns platform browser detection, CDP endpoint HTTP handling, and
//! CDP launch process handling.
//! Product policy, tool routing, and UI commands stay in product assembly and
//! app entrypoints.

#[cfg(any(target_env = "ohos", test))]
mod arkweb_host;
pub mod cdp;
pub mod launcher;

#[cfg(any(target_env = "ohos", test))]
pub use arkweb_host::{
    close_arkweb_browser_webview, create_arkweb_browser_webview, default_arkweb_automation_target,
    list_arkweb_automation_targets, register_arkweb_automation_target,
    register_arkweb_browser_host_port, remove_arkweb_automation_target,
    set_default_arkweb_automation_target, ArkWebAutomationTarget, ArkWebBrowserHostPort,
};
pub use cdp::{CdpEndpoint, CdpEndpointProvider, CdpPageInfo, CdpVersionInfo};
#[cfg(target_env = "ohos")]
pub use launcher::{
    register_haitai_browser_launch_port, HaitaiBrowserLaunchPort, HaitaiBrowserLaunchRequest,
};
pub use launcher::{
    BrowserDebugEndpoint, BrowserKind, BrowserLaunchOptions, BrowserLauncher, LaunchResult,
    DEFAULT_CDP_PORT,
};
