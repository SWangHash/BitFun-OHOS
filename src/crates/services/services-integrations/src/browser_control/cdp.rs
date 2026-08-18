//! Browser CDP HTTP endpoint provider.
//!
//! Browser-control providers expose a loopback HTTP/WebSocket CDP endpoint.
//! Product policy and tool routing stay in the higher assembly layer.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;

const CDP_HTTP_TIMEOUT: Duration = Duration::from_millis(500);

/// Information about a single browser page/tab from the CDP `/json` endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CdpPageInfo {
    pub id: String,
    pub title: String,
    pub url: String,
    #[serde(rename = "webSocketDebuggerUrl")]
    pub web_socket_debugger_url: Option<String>,
    #[serde(rename = "type")]
    pub page_type: Option<String>,
}

/// Version info returned by `/json/version`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CdpVersionInfo {
    #[serde(rename = "Browser")]
    pub browser: Option<String>,
    #[serde(rename = "Protocol-Version")]
    pub protocol_version: Option<String>,
    #[serde(rename = "User-Agent")]
    pub user_agent: Option<String>,
    #[serde(rename = "webSocketDebuggerUrl")]
    pub web_socket_debugger_url: Option<String>,
}

#[derive(Debug, Error)]
pub enum CdpEndpointError {
    #[error("Cannot reach browser CDP on port {port}: {message}")]
    VersionRequest { port: u16, message: String },
    #[error("Invalid CDP version response: {0}")]
    VersionResponse(String),
    #[error("Cannot list CDP pages on port {port}: {message}")]
    ListPagesRequest { port: u16, message: String },
    #[error("Invalid CDP pages response: {0}")]
    ListPagesResponse(String),
    #[error("Cannot fetch CDP protocol on port {port}: {message}")]
    ProtocolRequest { port: u16, message: String },
    #[error("Invalid CDP protocol response: {0}")]
    ProtocolResponse(String),
    #[error("Cannot create CDP page on port {port}: {message}")]
    CreatePageRequest { port: u16, message: String },
    #[error("Invalid CDP new page response: {0}")]
    CreatePageResponse(String),
}

pub struct CdpEndpointProvider;

impl CdpEndpointProvider {
    /// Discover browser version on a loopback debug port.
    pub async fn get_version(port: u16) -> Result<CdpVersionInfo, CdpEndpointError> {
        let url = format!("http://127.0.0.1:{port}/json/version");
        let response = reqwest::Client::new()
            .get(&url)
            .timeout(CDP_HTTP_TIMEOUT)
            .send()
            .await
            .map_err(|source| CdpEndpointError::VersionRequest {
                port,
                message: source.to_string(),
            })?;
        response
            .json()
            .await
            .map_err(|source| CdpEndpointError::VersionResponse(source.to_string()))
    }

    /// List all pages/tabs on a loopback debug port.
    pub async fn list_pages(port: u16) -> Result<Vec<CdpPageInfo>, CdpEndpointError> {
        let url = format!("http://127.0.0.1:{port}/json");
        let response = reqwest::Client::new()
            .get(&url)
            .timeout(CDP_HTTP_TIMEOUT)
            .send()
            .await
            .map_err(|source| CdpEndpointError::ListPagesRequest {
                port,
                message: source.to_string(),
            })?;
        response
            .json()
            .await
            .map_err(|source| CdpEndpointError::ListPagesResponse(source.to_string()))
    }

    /// Fetch the browser's CDP protocol description.
    pub async fn get_protocol(port: u16) -> Result<serde_json::Value, CdpEndpointError> {
        let url = format!("http://127.0.0.1:{port}/json/protocol");
        let response = reqwest::Client::new()
            .get(&url)
            .timeout(CDP_HTTP_TIMEOUT)
            .send()
            .await
            .map_err(|source| CdpEndpointError::ProtocolRequest {
                port,
                message: source.to_string(),
            })?;
        response
            .json()
            .await
            .map_err(|source| CdpEndpointError::ProtocolResponse(source.to_string()))
    }

    /// Create a new page/tab on a loopback debug port.
    pub async fn create_page(
        port: u16,
        url: Option<&str>,
    ) -> Result<CdpPageInfo, CdpEndpointError> {
        let endpoint = if let Some(url) = url {
            let encoded = url.replace(' ', "%20");
            format!("http://127.0.0.1:{port}/json/new?{encoded}")
        } else {
            format!("http://127.0.0.1:{port}/json/new")
        };
        let response = reqwest::Client::new()
            .put(&endpoint)
            .timeout(CDP_HTTP_TIMEOUT)
            .send()
            .await
            .map_err(|source| CdpEndpointError::CreatePageRequest {
                port,
                message: source.to_string(),
            })?;
        response
            .json()
            .await
            .map_err(|source| CdpEndpointError::CreatePageResponse(source.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cdp_page_info_preserves_websocket_debugger_field() {
        let page: CdpPageInfo = serde_json::from_value(serde_json::json!({
            "id": "page-1",
            "title": "Example",
            "url": "https://example.com",
            "webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/page/page-1",
            "type": "page"
        }))
        .expect("page info should deserialize");

        assert_eq!(
            page.web_socket_debugger_url.as_deref(),
            Some("ws://127.0.0.1:9222/devtools/page/page-1")
        );
        assert_eq!(page.page_type.as_deref(), Some("page"));
    }

    #[test]
    fn cdp_version_info_preserves_browser_protocol_user_agent_and_websocket_fields() {
        let version: CdpVersionInfo = serde_json::from_value(serde_json::json!({
            "Browser": "Chrome/132.0.6834.161",
            "Protocol-Version": "1.3",
            "User-Agent": "Mozilla/5.0 htbrowser/2.0.22",
            "webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/browser/test"
        }))
        .expect("version info should deserialize");

        assert_eq!(version.browser.as_deref(), Some("Chrome/132.0.6834.161"));
        assert_eq!(version.protocol_version.as_deref(), Some("1.3"));
        assert_eq!(
            version.user_agent.as_deref(),
            Some("Mozilla/5.0 htbrowser/2.0.22")
        );
        assert_eq!(
            version.web_socket_debugger_url.as_deref(),
            Some("ws://127.0.0.1:9222/devtools/browser/test")
        );
    }
}
