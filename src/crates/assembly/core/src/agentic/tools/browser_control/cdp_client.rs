//! Lightweight CDP (Chrome DevTools Protocol) client over WebSocket.

use crate::util::errors::{BitFunError, BitFunResult};
use bitfun_services_integrations::browser_control::CdpEndpointProvider;
pub use bitfun_services_integrations::browser_control::{CdpEndpoint, CdpPageInfo, CdpVersionInfo};
use futures::stream::{SplitSink, SplitStream};
use futures::{SinkExt, StreamExt};
use log::{debug, info, warn};
use serde_json::{json, Value};
use std::collections::HashMap;
#[cfg(target_env = "ohos")]
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, OnceLock, Weak};
use std::time::Duration;
#[cfg(target_env = "ohos")]
use std::{ffi::OsString, os::unix::ffi::OsStringExt, path::PathBuf};
#[cfg(target_env = "ohos")]
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpStream;
#[cfg(target_env = "ohos")]
use tokio::net::UnixStream;
use tokio::sync::{broadcast, Mutex, RwLock};
#[cfg(target_env = "ohos")]
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
#[cfg(target_env = "ohos")]
use tokio_tungstenite::{client_async, WebSocketStream};
#[cfg(not(target_env = "ohos"))]
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

use super::browser_launcher::BrowserKind;

#[cfg(target_env = "ohos")]
trait CdpIo: AsyncRead + AsyncWrite + Unpin + Send {}

#[cfg(target_env = "ohos")]
impl<T> CdpIo for T where T: AsyncRead + AsyncWrite + Unpin + Send {}

#[cfg(target_env = "ohos")]
type CdpStream = Pin<Box<dyn CdpIo>>;
#[cfg(target_env = "ohos")]
type WsSocket = WebSocketStream<CdpStream>;
#[cfg(not(target_env = "ohos"))]
type WsSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;
type WsSink = SplitSink<WsSocket, Message>;
type WsStream = SplitStream<WsSocket>;
type PendingResponses = Arc<RwLock<HashMap<i64, tokio::sync::oneshot::Sender<Value>>>>;
type EventChannels = Arc<RwLock<HashMap<Option<String>, broadcast::Sender<CdpEvent>>>>;
type SessionStatuses = Arc<RwLock<HashMap<String, Weak<AtomicBool>>>>;

const PAGE_CDP_CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const USER_PROFILE_APPROVAL_TIMEOUT: Duration = Duration::from_secs(90);

#[cfg(any(target_env = "ohos", test))]
fn protocol_has_domain(protocol: &Value, name: &str) -> bool {
    protocol
        .get("domains")
        .and_then(Value::as_array)
        .is_some_and(|domains| {
            domains
                .iter()
                .any(|domain| domain.get("domain").and_then(Value::as_str) == Some(name))
        })
}

/// A single CDP event emitted by the browser (no `id`, has `method` + `params`).
#[derive(Debug, Clone)]
pub struct CdpEvent {
    pub method: String,
    pub params: Value,
}

struct CdpTransport {
    sink: Arc<Mutex<WsSink>>,
    pending: PendingResponses,
    next_id: AtomicI64,
    event_channels: EventChannels,
    session_statuses: SessionStatuses,
    alive: Arc<AtomicBool>,
    reader_handle: tokio::task::JoinHandle<()>,
    keepalive_handle: Option<tokio::task::JoinHandle<()>>,
}

impl Drop for CdpTransport {
    fn drop(&mut self) {
        self.reader_handle.abort();
        if let Some(handle) = &self.keepalive_handle {
            handle.abort();
        }
    }
}

/// A CDP client connected either directly to a page WebSocket or to a flattened
/// target session carried by a browser-level WebSocket. The latter is required
/// for user-approved real-profile connections because guarded endpoints do not
/// necessarily expose the legacy `/json` HTTP API.
pub struct CdpClient {
    transport: Arc<CdpTransport>,
    session_id: Option<String>,
    events: broadcast::Sender<CdpEvent>,
    session_alive: Option<Arc<AtomicBool>>,
}

/// Process-wide browser connection retained after the user approves BitFun.
/// Keeping one browser WebSocket avoids repeated approval prompts and lets
/// settings commands and agent tools share the same live profile.
#[derive(Clone)]
pub struct CdpBrowserConnection {
    pub actual_port: u16,
    pub browser_kind: BrowserKind,
    pub client: Arc<CdpClient>,
}

static BROWSER_CONNECTIONS: OnceLock<RwLock<HashMap<u16, CdpBrowserConnection>>> = OnceLock::new();

fn browser_connections() -> &'static RwLock<HashMap<u16, CdpBrowserConnection>> {
    BROWSER_CONNECTIONS.get_or_init(|| RwLock::new(HashMap::new()))
}

impl CdpClient {
    /// Discover browser version on a legacy fixed debug port.
    pub async fn get_version(port: u16) -> BitFunResult<CdpVersionInfo> {
        CdpEndpointProvider::get_version(port)
            .await
            .map_err(|error| BitFunError::tool(error.to_string()))
    }

    pub async fn get_version_at(endpoint: &CdpEndpoint) -> BitFunResult<CdpVersionInfo> {
        CdpEndpointProvider::get_version_at(endpoint)
            .await
            .map_err(|error| BitFunError::tool(error.to_string()))
    }

    /// List all pages/tabs on a legacy fixed debug port.
    pub async fn list_pages(port: u16) -> BitFunResult<Vec<CdpPageInfo>> {
        CdpEndpointProvider::list_pages(port)
            .await
            .map_err(|error| BitFunError::tool(error.to_string()))
    }

    pub async fn list_pages_at(endpoint: &CdpEndpoint) -> BitFunResult<Vec<CdpPageInfo>> {
        CdpEndpointProvider::list_pages_at(endpoint)
            .await
            .map_err(|error| BitFunError::tool(error.to_string()))
    }

    #[cfg(target_env = "ohos")]
    pub async fn validate_ohos_protocol(port: u16) -> BitFunResult<()> {
        let protocol = CdpEndpointProvider::get_protocol(port)
            .await
            .map_err(|error| BitFunError::tool(error.to_string()))?;
        Self::validate_ohos_protocol_value(&protocol)
    }

    #[cfg(target_env = "ohos")]
    pub async fn validate_ohos_protocol_at(endpoint: &CdpEndpoint) -> BitFunResult<()> {
        let protocol = CdpEndpointProvider::get_protocol_at(endpoint)
            .await
            .map_err(|error| BitFunError::tool(error.to_string()))?;
        Self::validate_ohos_protocol_value(&protocol)
    }

    #[cfg(target_env = "ohos")]
    fn validate_ohos_protocol_value(protocol: &Value) -> BitFunResult<()> {
        if protocol.get("domains").and_then(Value::as_array).is_none() {
            return Err(BitFunError::tool(
                "OHOS CDP /json/protocol did not contain domains".to_string(),
            ));
        }
        for required in ["DOM", "Runtime", "Page", "Input", "Network", "Target"] {
            if !protocol_has_domain(&protocol, required) {
                return Err(BitFunError::tool(format!(
                    "OHOS CDP protocol is missing required domain {required}"
                )));
            }
        }
        Ok(())
    }

    /// Create a new page/tab on a debug port.
    pub async fn create_page(port: u16, url: Option<&str>) -> BitFunResult<CdpPageInfo> {
        match CdpEndpointProvider::create_page(port, url).await {
            Ok(page) => Ok(page),
            Err(error) => {
                #[cfg(target_env = "ohos")]
                {
                    // ArkWeb exposes the standard page endpoint on some
                    // versions but not `/json/new` on others. Fall back to
                    // the browser-level CDP Target domain when the HTTP
                    // helper is unavailable.
                    return Self::create_page_via_target(port, url)
                        .await
                        .map_err(|fallback| {
                            BitFunError::tool(format!(
                                "OHOS CDP could not create a page via /json/new ({error}) or Target.createTarget ({fallback})"
                            ))
                        });
                }

                #[cfg(not(target_env = "ohos"))]
                {
                    Err(BitFunError::tool(error.to_string()))
                }
            }
        }
    }

    #[cfg(target_env = "ohos")]
    async fn create_page_via_target(port: u16, url: Option<&str>) -> BitFunResult<CdpPageInfo> {
        let version = CdpEndpointProvider::get_version(port)
            .await
            .map_err(|error| BitFunError::tool(error.to_string()))?;
        let browser_ws_url = version.web_socket_debugger_url.as_deref().ok_or_else(|| {
            BitFunError::tool(
                "OHOS CDP /json/version did not provide a browser WebSocket debugger URL"
                    .to_string(),
            )
        })?;
        let browser_client = Self::connect(browser_ws_url).await?;
        let target = browser_client
            .send(
                "Target.createTarget",
                Some(json!({
                    "url": url.unwrap_or("about:blank"),
                    "background": false,
                })),
            )
            .await?;
        let target_id = target
            .get("targetId")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                BitFunError::tool(format!(
                    "Target.createTarget returned no targetId: {target}"
                ))
            })?
            .to_string();

        for _ in 0..10 {
            if let Ok(pages) = Self::list_pages(port).await {
                if let Some(page) = pages.into_iter().find(|page| page.id == target_id) {
                    return Ok(page);
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }

        Err(BitFunError::tool(format!(
            "OHOS CDP target {target_id} was created but did not appear in /json"
        )))
    }

    /// Connect to a specific page by its legacy WebSocket debugger URL.
    pub async fn connect(ws_url: &str) -> BitFunResult<Self> {
        info!("CDP connecting to page WebSocket");
        Self::connect_with_timeout(ws_url, PAGE_CDP_CONNECT_TIMEOUT, None).await
    }

    pub async fn connect_at(endpoint: &CdpEndpoint, ws_url: &str) -> BitFunResult<Self> {
        info!("CDP connecting to page WebSocket through {}", endpoint);
        Self::connect_with_timeout(ws_url, PAGE_CDP_CONNECT_TIMEOUT, Some(endpoint)).await
    }

    /// Connect to a guarded browser-level endpoint and retain it under the
    /// logical port used by BitFun's browser tools. The WebSocket handshake
    /// waits for the user to approve the request in their browser.
    pub async fn connect_user_profile_browser(
        logical_port: u16,
        actual_port: u16,
        browser_kind: &BrowserKind,
        ws_url: &str,
    ) -> BitFunResult<CdpBrowserConnection> {
        if let Some(existing) = Self::browser_connection(logical_port).await {
            if existing.actual_port == actual_port && existing.browser_kind == *browser_kind {
                return Ok(existing);
            }
        }

        info!(
            "Requesting user-approved browser profile connection on port {}",
            actual_port
        );
        let client = Arc::new(
            Self::connect_with_timeout(ws_url, USER_PROFILE_APPROVAL_TIMEOUT, None)
                .await
                .map_err(|error| {
                    BitFunError::tool(format!(
                        "Could not connect to the current browser profile. Approve BitFun's remote debugging request in the browser, then try again: {}",
                        error
                    ))
                })?,
        );
        // Validate that this is a browser-level CDP endpoint before retaining
        // it. This also fails quickly if the DevToolsActivePort file was stale.
        client.browser_version().await?;

        let connection = CdpBrowserConnection {
            actual_port,
            browser_kind: browser_kind.clone(),
            client,
        };
        browser_connections()
            .write()
            .await
            .insert(logical_port, connection.clone());
        Ok(connection)
    }

    /// Return a healthy retained browser connection, pruning it if the browser
    /// has closed the underlying WebSocket.
    pub async fn browser_connection(logical_port: u16) -> Option<CdpBrowserConnection> {
        let existing = browser_connections()
            .read()
            .await
            .get(&logical_port)
            .cloned();
        match existing {
            Some(connection) if connection.client.is_connected() => Some(connection),
            Some(_) => {
                browser_connections().write().await.remove(&logical_port);
                None
            }
            None => None,
        }
    }

    /// Return the retained connection only when it belongs to the browser the
    /// caller selected. A logical tool port is shared by every browser option,
    /// so blindly reusing it after a Chrome/Edge switch would control the wrong
    /// profile.
    pub async fn browser_connection_for_kind(
        logical_port: u16,
        browser_kind: &BrowserKind,
    ) -> Option<CdpBrowserConnection> {
        Self::browser_connection(logical_port)
            .await
            .filter(|connection| connection.browser_kind == *browser_kind)
    }

    /// Forget the browser-level connection assigned to a logical tool port.
    /// Existing page sessions retain their own transport references, while
    /// subsequent browser actions resolve against the newly selected browser.
    pub async fn remove_browser_connection(logical_port: u16) {
        browser_connections().write().await.remove(&logical_port);
    }

    async fn connect_with_timeout(
        ws_url: &str,
        timeout: Duration,
        endpoint: Option<&CdpEndpoint>,
    ) -> BitFunResult<Self> {
        let (ws_stream, _) = tokio::time::timeout(timeout, Self::connect_stream(ws_url, endpoint))
            .await
            .map_err(|_| {
                BitFunError::tool("Timed out waiting for the CDP WebSocket connection".to_string())
            })?
            .map_err(|error| {
                BitFunError::tool(format!("CDP WebSocket connect failed: {}", error))
            })?;

        let (sink, stream) = ws_stream.split();
        let sink = Arc::new(Mutex::new(sink));
        let pending: PendingResponses = Arc::new(RwLock::new(HashMap::new()));
        let event_channels: EventChannels = Arc::new(RwLock::new(HashMap::new()));
        let session_statuses: SessionStatuses = Arc::new(RwLock::new(HashMap::new()));
        let alive = Arc::new(AtomicBool::new(true));

        // Buffer up to 256 events per target subscriber. Lifecycle / network
        // events arrive in bursts during page load; older entries can be
        // dropped from a lagging subscriber without affecting the protocol.
        let (events_tx, _) = broadcast::channel::<CdpEvent>(256);
        event_channels.write().await.insert(None, events_tx.clone());

        let reader_handle = tokio::spawn(Self::reader_loop(
            stream,
            sink.clone(),
            pending.clone(),
            event_channels.clone(),
            session_statuses.clone(),
            alive.clone(),
        ));

        #[cfg(target_env = "ohos")]
        let keepalive_handle = if matches!(endpoint, Some(CdpEndpoint::ArkWebAbstract { .. })) {
            let keepalive_sink = sink.clone();
            let keepalive_alive = alive.clone();
            Some(tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(15)).await;
                    if !keepalive_alive.load(Ordering::SeqCst) {
                        break;
                    }
                    let result = keepalive_sink
                        .lock()
                        .await
                        .send(Message::Ping(Vec::new().into()))
                        .await;
                    if let Err(error) = result {
                        warn!("ArkWeb CDP keepalive failed: {}", error);
                        keepalive_alive.store(false, Ordering::SeqCst);
                        break;
                    }
                }
            }))
        } else {
            None
        };
        #[cfg(not(target_env = "ohos"))]
        let keepalive_handle = None;

        Ok(Self {
            transport: Arc::new(CdpTransport {
                sink,
                pending,
                next_id: AtomicI64::new(1),
                event_channels,
                session_statuses,
                alive,
                reader_handle,
                keepalive_handle,
            }),
            session_id: None,
            events: events_tx,
            session_alive: None,
        })
    }

    #[cfg(not(target_env = "ohos"))]
    async fn connect_stream(
        ws_url: &str,
        _endpoint: Option<&CdpEndpoint>,
    ) -> Result<
        (
            WsSocket,
            tokio_tungstenite::tungstenite::handshake::client::Response,
        ),
        String,
    > {
        connect_async(ws_url)
            .await
            .map_err(|error| error.to_string())
    }

    #[cfg(target_env = "ohos")]
    async fn connect_stream(
        ws_url: &str,
        endpoint: Option<&CdpEndpoint>,
    ) -> Result<
        (
            WsSocket,
            tokio_tungstenite::tungstenite::handshake::client::Response,
        ),
        String,
    > {
        let raw_request = ws_url
            .into_client_request()
            .map_err(|error| format!("invalid CDP WebSocket URL: {error}"))?;
        let arkweb_path = match endpoint {
            Some(CdpEndpoint::ArkWebAbstract { .. }) => raw_request
                .uri()
                .path_and_query()
                .map(|value| value.as_str())
                .unwrap_or("/")
                .to_string(),
            _ => String::new(),
        };
        let mut request = if arkweb_path.is_empty() {
            raw_request
        } else {
            format!("ws://localhost{arkweb_path}")
                .into_client_request()
                .map_err(|error| format!("invalid ArkWeb CDP WebSocket URL: {error}"))?
        };
        if request.uri().scheme_str() != Some("ws") {
            return Err(format!(
                "unsupported CDP WebSocket scheme: {}",
                request.uri().scheme_str().unwrap_or("<missing>")
            ));
        }
        let stream: CdpStream = match endpoint {
            Some(endpoint @ CdpEndpoint::ArkWebAbstract { .. }) => {
                let origin = "http://localhost"
                    .parse()
                    .map_err(|error| format!("invalid ArkWeb CDP Origin header: {error}"))?;
                request.headers_mut().insert("Origin", origin);
                Box::pin(
                    Self::connect_arkweb_stream(endpoint)
                        .await
                        .map_err(|error| error.to_string())?,
                )
            }
            _ => {
                let host = request
                    .uri()
                    .host()
                    .ok_or_else(|| "CDP WebSocket URL has no host".to_string())?
                    .to_string();
                let port = request.uri().port_u16().unwrap_or(80);
                let origin = format!("http://localhost:{port}")
                    .parse()
                    .map_err(|error| format!("invalid CDP Origin header: {error}"))?;
                request.headers_mut().insert("Origin", origin);
                Box::pin(
                    TcpStream::connect((host.as_str(), port))
                        .await
                        .map_err(|error| error.to_string())?,
                )
            }
        };
        client_async(request, stream)
            .await
            .map_err(|error| error.to_string())
    }

    #[cfg(target_env = "ohos")]
    async fn connect_arkweb_stream(endpoint: &CdpEndpoint) -> std::io::Result<UnixStream> {
        let CdpEndpoint::ArkWebAbstract { socket_name } = endpoint else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "CDP endpoint is not an ArkWeb abstract socket",
            ));
        };
        let mut abstract_name = Vec::with_capacity(socket_name.len() + 1);
        abstract_name.push(0);
        abstract_name.extend_from_slice(socket_name.as_bytes());
        UnixStream::connect(PathBuf::from(OsString::from_vec(abstract_name))).await
    }

    /// Subscribe to all CDP events. Filter on `method` at the call site.
    pub fn subscribe_events(&self) -> broadcast::Receiver<CdpEvent> {
        self.events.subscribe()
    }

    /// Returns `true` while the underlying WebSocket and, for a flattened page
    /// session, that specific target session are still alive.
    pub fn is_connected(&self) -> bool {
        self.transport.alive.load(Ordering::SeqCst)
            && self
                .session_alive
                .as_ref()
                .map(|alive| alive.load(Ordering::SeqCst))
                .unwrap_or(true)
    }

    /// Connect to the first available page on a legacy debug port.
    pub async fn connect_to_first_page(port: u16) -> BitFunResult<Self> {
        let pages = Self::list_pages(port).await?;
        let page = pages
            .iter()
            .find(|page| {
                page.page_type.as_deref() == Some("page") && page.web_socket_debugger_url.is_some()
            })
            .or_else(|| pages.first())
            .ok_or_else(|| BitFunError::tool("No browser pages found via CDP".to_string()))?;

        let ws_url = page
            .web_socket_debugger_url
            .as_ref()
            .ok_or_else(|| BitFunError::tool("Page has no WebSocket debugger URL".to_string()))?;

        Self::connect(ws_url).await
    }

    /// Query version metadata from a browser-level CDP connection.
    pub async fn browser_version(&self) -> BitFunResult<CdpVersionInfo> {
        self.require_browser_connection()?;
        let result = self.send("Browser.getVersion", None).await?;
        Ok(CdpVersionInfo {
            browser: result
                .get("product")
                .and_then(Value::as_str)
                .map(str::to_string),
            protocol_version: result
                .get("protocolVersion")
                .and_then(Value::as_str)
                .map(str::to_string),
            user_agent: None,
            web_socket_debugger_url: None,
        })
    }

    /// List targets through the browser WebSocket. This replaces `/json` for
    /// an approval-only real-profile endpoint.
    pub async fn browser_pages(&self) -> BitFunResult<Vec<CdpPageInfo>> {
        self.require_browser_connection()?;
        let result = self.send("Target.getTargets", None).await?;
        Ok(Self::page_infos_from_target_result(&result))
    }

    /// Create a target through the browser WebSocket and return its metadata.
    pub async fn create_browser_page(&self, url: Option<&str>) -> BitFunResult<CdpPageInfo> {
        self.require_browser_connection()?;
        let target_url = url.unwrap_or("about:blank");
        let result = self
            .send("Target.createTarget", Some(json!({ "url": target_url })))
            .await?;
        let target_id = result
            .get("targetId")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                BitFunError::tool("Target.createTarget returned no target id".to_string())
            })?
            .to_string();

        for _ in 0..10 {
            if let Some(page) = self
                .browser_pages()
                .await?
                .into_iter()
                .find(|page| page.id == target_id)
            {
                return Ok(page);
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        Ok(CdpPageInfo {
            id: target_id,
            title: String::new(),
            url: target_url.to_string(),
            web_socket_debugger_url: None,
            page_type: Some("page".to_string()),
        })
    }

    /// Attach to one target using a flattened CDP session carried over the
    /// retained browser WebSocket. All subsequent page commands are tagged with
    /// the returned `sessionId`, while events are routed to this client only.
    pub async fn attach_to_page(&self, target_id: &str) -> BitFunResult<Self> {
        self.require_browser_connection()?;
        let result = self
            .send(
                "Target.attachToTarget",
                Some(json!({ "targetId": target_id, "flatten": true })),
            )
            .await?;
        let session_id = result
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                BitFunError::tool("Target.attachToTarget returned no session id".to_string())
            })?
            .to_string();

        let (events_tx, _) = broadcast::channel::<CdpEvent>(256);
        self.transport
            .event_channels
            .write()
            .await
            .insert(Some(session_id.clone()), events_tx.clone());
        let session_alive = Arc::new(AtomicBool::new(true));
        self.transport
            .session_statuses
            .write()
            .await
            .insert(session_id.clone(), Arc::downgrade(&session_alive));

        Ok(Self {
            transport: self.transport.clone(),
            session_id: Some(session_id),
            events: events_tx,
            session_alive: Some(session_alive),
        })
    }

    fn require_browser_connection(&self) -> BitFunResult<()> {
        if self.session_id.is_some() {
            return Err(BitFunError::tool(
                "This CDP operation requires the browser-level connection".to_string(),
            ));
        }
        Ok(())
    }

    fn page_infos_from_target_result(result: &Value) -> Vec<CdpPageInfo> {
        result
            .get("targetInfos")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|target| {
                let id = target.get("targetId")?.as_str()?.to_string();
                Some(CdpPageInfo {
                    id,
                    title: target
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    url: target
                        .get("url")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    web_socket_debugger_url: None,
                    page_type: target
                        .get("type")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                })
            })
            .collect()
    }

    /// Send a CDP method call and wait for the response.
    pub async fn send(&self, method: &str, params: Option<Value>) -> BitFunResult<Value> {
        let id = self.transport.next_id.fetch_add(1, Ordering::SeqCst);
        let mut msg = json!({
            "id": id,
            "method": method,
            "params": params.unwrap_or(json!({})),
        });
        if let Some(session_id) = &self.session_id {
            msg["sessionId"] = json!(session_id);
        }

        let (tx, rx) = tokio::sync::oneshot::channel();
        self.transport.pending.write().await.insert(id, tx);

        debug!("CDP send id={} method={}", id, method);
        let send_result = {
            let mut sink = self.transport.sink.lock().await;
            sink.send(Message::Text(msg.to_string().into())).await
        };
        if let Err(error) = send_result {
            self.transport.pending.write().await.remove(&id);
            return Err(BitFunError::tool(format!("CDP send failed: {}", error)));
        }

        let result = match tokio::time::timeout(Duration::from_secs(30), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => return Err(BitFunError::tool("CDP response channel closed".to_string())),
            Err(_) => {
                self.transport.pending.write().await.remove(&id);
                return Err(BitFunError::tool(format!(
                    "CDP timeout for method {}",
                    method
                )));
            }
        };

        if let Some(error) = result.get("error") {
            return Err(BitFunError::tool(format!("CDP error: {}", error)));
        }

        Ok(result.get("result").cloned().unwrap_or(json!({})))
    }

    async fn reader_loop(
        mut stream: WsStream,
        sink: Arc<Mutex<WsSink>>,
        pending: PendingResponses,
        event_channels: EventChannels,
        session_statuses: SessionStatuses,
        alive: Arc<AtomicBool>,
    ) {
        while let Some(msg_result) = stream.next().await {
            match msg_result {
                Ok(Message::Text(text)) => {
                    if let Ok(value) = serde_json::from_str::<Value>(&text) {
                        if let Some(id) = value.get("id").and_then(Value::as_i64) {
                            let sender = pending.write().await.remove(&id);
                            if let Some(sender) = sender {
                                let _ = sender.send(value);
                            }
                            continue;
                        }

                        let Some(method) = value
                            .get("method")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                        else {
                            continue;
                        };
                        let params = value.get("params").cloned().unwrap_or(json!({}));

                        if method == "Target.detachedFromTarget" {
                            if let Some(session_id) =
                                params.get("sessionId").and_then(Value::as_str)
                            {
                                if let Some(status) = session_statuses
                                    .write()
                                    .await
                                    .remove(session_id)
                                    .and_then(|status| status.upgrade())
                                {
                                    status.store(false, Ordering::SeqCst);
                                }
                                event_channels
                                    .write()
                                    .await
                                    .remove(&Some(session_id.to_string()));
                            }
                        }

                        let route = value
                            .get("sessionId")
                            .and_then(Value::as_str)
                            .map(str::to_string);
                        if let Some(events) = event_channels.read().await.get(&route).cloned() {
                            let _ = events.send(CdpEvent { method, params });
                        }
                    }
                }
                Ok(Message::Close(_)) => {
                    debug!("CDP WebSocket closed by server");
                    break;
                }
                Ok(Message::Ping(payload)) => {
                    if let Err(error) = sink.lock().await.send(Message::Pong(payload)).await {
                        warn!("CDP WebSocket pong failed: {}", error);
                        break;
                    }
                }
                Err(error) => {
                    warn!("CDP WebSocket read error: {}", error);
                    break;
                }
                _ => {}
            }
        }

        alive.store(false, Ordering::SeqCst);
        pending.write().await.clear();
        for status in session_statuses
            .write()
            .await
            .drain()
            .map(|(_, status)| status)
        {
            if let Some(status) = status.upgrade() {
                status.store(false, Ordering::SeqCst);
            }
        }
    }
}

#[cfg(test)]
mod protocol_tests {
    use super::*;

    #[test]
    fn browser_target_metadata_maps_to_page_info() {
        let pages = CdpClient::page_infos_from_target_result(&json!({
            "targetInfos": [
                {
                    "targetId": "page-1",
                    "type": "page",
                    "title": "Inbox",
                    "url": "https://mail.example.test/"
                },
                {
                    "targetId": "worker-1",
                    "type": "service_worker",
                    "title": "Service Worker",
                    "url": "https://mail.example.test/sw.js"
                }
            ]
        }));

        assert_eq!(pages.len(), 2);
        assert_eq!(pages[0].id, "page-1");
        assert_eq!(pages[0].page_type.as_deref(), Some("page"));
        assert_eq!(pages[0].web_socket_debugger_url, None);
    }

    #[tokio::test]
    async fn browser_websocket_flattens_commands_and_routes_page_events() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind mock CDP server");
        let address = listener.local_addr().expect("mock CDP address");
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.expect("accept CDP client");
            let mut socket = tokio_tungstenite::accept_async(stream)
                .await
                .expect("accept WebSocket");

            while let Some(message) = socket.next().await {
                let Message::Text(text) = message.expect("read CDP command") else {
                    continue;
                };
                let command: Value = serde_json::from_str(&text).expect("parse CDP command");
                let id = command
                    .get("id")
                    .and_then(Value::as_i64)
                    .expect("command id");
                let method = command
                    .get("method")
                    .and_then(Value::as_str)
                    .expect("command method");

                let result = match method {
                    "Browser.getVersion" => json!({
                        "product": "Chrome/151.0.0.0",
                        "protocolVersion": "1.3"
                    }),
                    "Target.getTargets" => json!({
                        "targetInfos": [{
                            "targetId": "page-1",
                            "type": "page",
                            "title": "Signed-in page",
                            "url": "https://example.test/"
                        }]
                    }),
                    "Target.attachToTarget" => {
                        assert_eq!(command["params"]["targetId"], "page-1");
                        assert_eq!(command["params"]["flatten"], true);
                        json!({ "sessionId": "session-1" })
                    }
                    "Runtime.enable" => {
                        assert_eq!(command["sessionId"], "session-1");
                        socket
                            .send(Message::Text(
                                json!({
                                    "method": "Runtime.consoleAPICalled",
                                    "sessionId": "session-1",
                                    "params": { "type": "log" }
                                })
                                .to_string()
                                .into(),
                            ))
                            .await
                            .expect("send flattened page event");
                        json!({})
                    }
                    other => panic!("unexpected CDP command: {other}"),
                };

                socket
                    .send(Message::Text(
                        json!({ "id": id, "result": result }).to_string().into(),
                    ))
                    .await
                    .expect("send CDP response");

                if method == "Runtime.enable" {
                    break;
                }
            }
        });

        let browser = CdpClient::connect(&format!("ws://{address}"))
            .await
            .expect("connect browser WebSocket");
        assert_eq!(
            browser
                .browser_version()
                .await
                .expect("browser version")
                .browser
                .as_deref(),
            Some("Chrome/151.0.0.0")
        );
        let pages = browser.browser_pages().await.expect("browser targets");
        assert_eq!(pages.len(), 1);

        let mut browser_events = browser.subscribe_events();
        let page = browser
            .attach_to_page(&pages[0].id)
            .await
            .expect("attach flattened page session");
        let mut page_events = page.subscribe_events();
        page.send("Runtime.enable", None)
            .await
            .expect("send flattened command");

        let event = tokio::time::timeout(Duration::from_secs(1), page_events.recv())
            .await
            .expect("page event timeout")
            .expect("page event");
        assert_eq!(event.method, "Runtime.consoleAPICalled");
        assert!(matches!(
            browser_events.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ));

        server.await.expect("mock CDP server");
    }
}

#[cfg(test)]
mod tests {
    use super::protocol_has_domain;
    use serde_json::json;

    #[test]
    fn protocol_domain_detection_uses_standard_domain_key() {
        let standard = json!({
            "domains": [
                { "domain": "DOM" },
                { "domain": "Runtime" }
            ]
        });
        assert!(protocol_has_domain(&standard, "DOM"));

        let non_standard = json!({ "domains": [{ "name": "Page" }] });
        assert!(!protocol_has_domain(&non_standard, "Page"));
        assert!(!protocol_has_domain(&standard, "Input"));
    }
}
