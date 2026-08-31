//! Browser CDP HTTP endpoint provider.
//!
//! Browser-control providers expose a loopback HTTP/WebSocket CDP endpoint.
//! Product policy and tool routing stay in the higher assembly layer.

#[cfg(target_env = "ohos")]
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::time::Duration;
use thiserror::Error;

#[cfg(target_env = "ohos")]
use std::io::{Read, Write};
#[cfg(target_env = "ohos")]
use std::os::linux::net::SocketAddrExt;
#[cfg(target_env = "ohos")]
use std::os::unix::net::{SocketAddr, UnixStream};

const CDP_HTTP_TIMEOUT: Duration = Duration::from_millis(500);
#[cfg(target_env = "ohos")]
const MAX_CDP_HTTP_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CdpEndpoint {
    Loopback {
        port: u16,
    },
    #[cfg(target_env = "ohos")]
    ArkWebAbstract {
        socket_name: String,
    },
}

impl CdpEndpoint {
    pub fn loopback(port: u16) -> Self {
        Self::Loopback { port }
    }

    #[cfg(target_env = "ohos")]
    pub fn arkweb_for_current_process() -> Self {
        Self::ArkWebAbstract {
            socket_name: format!("webview_devtools_remote_{}", std::process::id()),
        }
    }

    #[cfg(target_env = "ohos")]
    fn connect_arkweb_stream(&self) -> std::io::Result<UnixStream> {
        let Self::ArkWebAbstract { socket_name } = self else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "CDP endpoint is not an ArkWeb abstract socket",
            ));
        };
        let address = SocketAddr::from_abstract_name(socket_name.as_bytes())?;
        let stream = UnixStream::connect_addr(&address)?;
        stream.set_read_timeout(Some(CDP_HTTP_TIMEOUT))?;
        stream.set_write_timeout(Some(CDP_HTTP_TIMEOUT))?;
        Ok(stream)
    }
}

impl fmt::Display for CdpEndpoint {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Loopback { port } => write!(formatter, "127.0.0.1:{port}"),
            #[cfg(target_env = "ohos")]
            Self::ArkWebAbstract { socket_name } => write!(formatter, "@{socket_name}"),
        }
    }
}

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
    #[error("Cannot {operation} through CDP endpoint {endpoint}: {message}")]
    EndpointRequest {
        operation: &'static str,
        endpoint: String,
        message: String,
    },
    #[error("Invalid {operation} response from CDP endpoint {endpoint}: {message}")]
    EndpointResponse {
        operation: &'static str,
        endpoint: String,
        message: String,
    },
}

pub struct CdpEndpointProvider;

impl CdpEndpointProvider {
    pub async fn get_version_at(
        endpoint: &CdpEndpoint,
    ) -> Result<CdpVersionInfo, CdpEndpointError> {
        match endpoint {
            CdpEndpoint::Loopback { port } => Self::get_version(*port).await,
            #[cfg(target_env = "ohos")]
            CdpEndpoint::ArkWebAbstract { .. } => {
                Self::request_arkweb_json(endpoint, "GET", "/json/version", "fetch version").await
            }
        }
    }

    pub async fn list_pages_at(
        endpoint: &CdpEndpoint,
    ) -> Result<Vec<CdpPageInfo>, CdpEndpointError> {
        match endpoint {
            CdpEndpoint::Loopback { port } => Self::list_pages(*port).await,
            #[cfg(target_env = "ohos")]
            CdpEndpoint::ArkWebAbstract { .. } => {
                Self::request_arkweb_json(endpoint, "GET", "/json", "list pages").await
            }
        }
    }

    pub async fn get_protocol_at(
        endpoint: &CdpEndpoint,
    ) -> Result<serde_json::Value, CdpEndpointError> {
        match endpoint {
            CdpEndpoint::Loopback { port } => Self::get_protocol(*port).await,
            #[cfg(target_env = "ohos")]
            CdpEndpoint::ArkWebAbstract { .. } => {
                Self::request_arkweb_json(endpoint, "GET", "/json/protocol", "fetch protocol").await
            }
        }
    }

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

    #[cfg(target_env = "ohos")]
    async fn request_arkweb_json<T: DeserializeOwned>(
        endpoint: &CdpEndpoint,
        method: &'static str,
        path: &str,
        operation: &'static str,
    ) -> Result<T, CdpEndpointError> {
        let endpoint_name = endpoint.to_string();
        let response = request_arkweb_bytes(endpoint, method, path).map_err(|error| {
            CdpEndpointError::EndpointRequest {
                operation,
                endpoint: endpoint_name.clone(),
                message: error.to_string(),
            }
        })?;

        let body = parse_http_response_body(&response).map_err(|message| {
            CdpEndpointError::EndpointResponse {
                operation,
                endpoint: endpoint_name.clone(),
                message,
            }
        })?;
        serde_json::from_slice(&body).map_err(|error| CdpEndpointError::EndpointResponse {
            operation,
            endpoint: endpoint_name,
            message: error.to_string(),
        })
    }
}

#[cfg(target_env = "ohos")]
fn request_arkweb_bytes(
    endpoint: &CdpEndpoint,
    method: &str,
    path: &str,
) -> std::io::Result<Vec<u8>> {
    let mut stream = endpoint.connect_arkweb_stream()?;
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: localhost\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes())?;

    let mut response = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = stream.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        if response.len() + read > MAX_CDP_HTTP_RESPONSE_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "CDP HTTP response exceeded 8 MiB",
            ));
        }
        response.extend_from_slice(&buffer[..read]);
        if http_response_is_complete(&response)? {
            break;
        }
    }
    Ok(response)
}

#[cfg(any(target_env = "ohos", test))]
fn parse_http_response_body(response: &[u8]) -> Result<Vec<u8>, String> {
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
        .ok_or_else(|| "response did not contain an HTTP header terminator".to_string())?;
    let headers = std::str::from_utf8(&response[..header_end])
        .map_err(|error| format!("response headers were not UTF-8: {error}"))?;
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| "response did not contain a valid HTTP status".to_string())?;
    if !(200..300).contains(&status) {
        return Err(format!("CDP HTTP endpoint returned status {status}"));
    }

    let body = &response[header_end..];
    let is_chunked = headers.lines().skip(1).any(|line| {
        line.split_once(':').is_some_and(|(name, value)| {
            name.eq_ignore_ascii_case("transfer-encoding")
                && value
                    .split(',')
                    .any(|encoding| encoding.trim().eq_ignore_ascii_case("chunked"))
        })
    });
    if is_chunked {
        decode_chunked_body(body)
    } else if let Some(content_length) = http_content_length(headers)? {
        if body.len() < content_length {
            return Err(format!(
                "HTTP body contained {} bytes, expected {content_length}",
                body.len()
            ));
        }
        Ok(body[..content_length].to_vec())
    } else {
        Ok(body.to_vec())
    }
}

#[cfg(any(target_env = "ohos", test))]
fn http_response_is_complete(response: &[u8]) -> Result<bool, std::io::Error> {
    let Some(header_end) = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
    else {
        return Ok(false);
    };
    let headers = std::str::from_utf8(&response[..header_end]).map_err(|error| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("response headers were not UTF-8: {error}"),
        )
    })?;
    let body = &response[header_end..];
    if headers.lines().skip(1).any(|line| {
        line.split_once(':').is_some_and(|(name, value)| {
            name.eq_ignore_ascii_case("transfer-encoding")
                && value
                    .split(',')
                    .any(|encoding| encoding.trim().eq_ignore_ascii_case("chunked"))
        })
    }) {
        return chunked_body_is_complete(body)
            .map_err(|message| std::io::Error::new(std::io::ErrorKind::InvalidData, message));
    }
    http_content_length(headers)
        .map(|length| length.is_some_and(|length| body.len() >= length))
        .map_err(|message| std::io::Error::new(std::io::ErrorKind::InvalidData, message))
}

#[cfg(any(target_env = "ohos", test))]
fn http_content_length(headers: &str) -> Result<Option<usize>, String> {
    headers
        .lines()
        .skip(1)
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then_some(value.trim())
        })
        .map(|value| {
            value
                .parse::<usize>()
                .map_err(|error| format!("invalid Content-Length: {error}"))
        })
        .transpose()
}

#[cfg(any(target_env = "ohos", test))]
fn chunked_body_is_complete(mut body: &[u8]) -> Result<bool, String> {
    loop {
        let Some(line_end) = body.windows(2).position(|window| window == b"\r\n") else {
            return Ok(false);
        };
        let size_text = std::str::from_utf8(&body[..line_end])
            .map_err(|error| format!("chunk size was not UTF-8: {error}"))?;
        let size =
            usize::from_str_radix(size_text.split(';').next().unwrap_or_default().trim(), 16)
                .map_err(|error| format!("invalid chunk size: {error}"))?;
        body = &body[line_end + 2..];
        if size == 0 {
            return Ok(true);
        }
        if body.len() < size + 2 {
            return Ok(false);
        }
        if &body[size..size + 2] != b"\r\n" {
            return Err("chunked response contained an invalid chunk terminator".to_string());
        }
        body = &body[size + 2..];
    }
}

#[cfg(any(target_env = "ohos", test))]
fn decode_chunked_body(mut body: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoded = Vec::new();
    loop {
        let line_end = body
            .windows(2)
            .position(|window| window == b"\r\n")
            .ok_or_else(|| "chunked response contained an incomplete size line".to_string())?;
        let size_text = std::str::from_utf8(&body[..line_end])
            .map_err(|error| format!("chunk size was not UTF-8: {error}"))?;
        let size =
            usize::from_str_radix(size_text.split(';').next().unwrap_or_default().trim(), 16)
                .map_err(|error| format!("invalid chunk size: {error}"))?;
        body = &body[line_end + 2..];
        if size == 0 {
            return Ok(decoded);
        }
        if body.len() < size + 2 || &body[size..size + 2] != b"\r\n" {
            return Err("chunked response contained an incomplete chunk".to_string());
        }
        decoded.extend_from_slice(&body[..size]);
        body = &body[size + 2..];
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

    #[test]
    fn parses_chunked_http_response_body() {
        let response = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\n{\"ok\r\n4\r\n\":1}\r\n0\r\n\r\n";
        assert_eq!(parse_http_response_body(response).unwrap(), b"{\"ok\":1}");
    }

    #[test]
    fn detects_complete_content_length_response_without_waiting_for_eof() {
        let response =
            b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: keep-alive\r\n\r\n{\"ok\":1}";
        assert!(http_response_is_complete(response).unwrap());
        assert_eq!(parse_http_response_body(response).unwrap(), b"{\"ok\":1}");
    }
}
