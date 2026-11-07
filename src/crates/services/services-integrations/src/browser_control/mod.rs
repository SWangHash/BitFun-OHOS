//! Browser control integration services.
//!
//! This module owns platform browser detection, CDP endpoint HTTP handling, and
//! CDP launch process handling.
//! Product policy, tool routing, and UI commands stay in product assembly and
//! app entrypoints.

// ArkWeb host port for the OHOS built-in browser (ArkUI `Web` through
// `@ohos-rs/ability`). OHOS product code that upstream does not carry: keep this
// gate, the `pub use` block below, and `arkweb_host.rs` across upstream merges.
// Removing the gate still compiles and silently drops the host port, which only
// shows up as built-in browser automation losing its pages.
#[cfg(any(target_env = "ohos", test))]
mod arkweb_host;
pub mod cdp;
pub mod launcher;

#[cfg(any(target_env = "ohos", test))]
pub use arkweb_host::{
    arkweb_browser_host_available, arkweb_webview_is_active, close_arkweb_browser_webview,
    create_arkweb_browser_webview, default_arkweb_automation_target,
    list_arkweb_automation_targets, register_arkweb_automation_target,
    register_arkweb_browser_host_port, remove_arkweb_automation_target, set_arkweb_webview_active,
    set_default_arkweb_automation_target, ArkWebAutomationTarget, ArkWebBrowserHostPort,
};
pub use cdp::{CdpEndpoint, CdpEndpointError, CdpEndpointProvider, CdpPageInfo, CdpVersionInfo};
#[cfg(target_env = "ohos")]
pub use launcher::{
    register_haitai_browser_launch_port, HaitaiBrowserLaunchPort, HaitaiBrowserLaunchRequest,
};
pub use launcher::{
    BrowserDebugEndpoint, BrowserKind, BrowserLaunchOptions, BrowserLauncher, CdpPortProbe,
    LaunchResult, DEFAULT_CDP_PORT, GUARDED_BROWSER_WEBSOCKET_PATH,
};

#[cfg(test)]
pub(crate) mod test_support {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// Loopback HTTP server that answers every request with one fixed status
    /// line and body, like a guarded Chromium endpoint answering `/json*`
    /// with an empty 404. Returns the bound port.
    pub(crate) async fn serve_fixed_http(status: &'static str, body: &'static str) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                tokio::spawn(async move {
                    let mut buffer = [0_u8; 4096];
                    let _ = socket.read(&mut buffer).await;
                    let response = format!(
                        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                    let _ = socket.shutdown().await;
                });
            }
        });
        port
    }

    /// A loopback port with nothing listening on it.
    pub(crate) fn closed_port() -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        listener.local_addr().expect("addr").port()
    }
}
