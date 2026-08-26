//! Browser control integration services.
//!
//! This module owns platform browser detection, CDP endpoint HTTP handling, and
//! CDP launch process handling.
//! Product policy, tool routing, and UI commands stay in product assembly and
//! app entrypoints.

pub mod cdp;
pub mod launcher;

pub use cdp::{CdpEndpointProvider, CdpPageInfo, CdpVersionInfo};
#[cfg(target_env = "ohos")]
pub use launcher::{
    register_haitai_browser_launch_port, HaitaiBrowserLaunchPort, HaitaiBrowserLaunchRequest,
};
pub use launcher::{
    BrowserDebugEndpoint, BrowserKind, BrowserLaunchOptions, BrowserLauncher, LaunchResult,
    DEFAULT_CDP_PORT,
};
