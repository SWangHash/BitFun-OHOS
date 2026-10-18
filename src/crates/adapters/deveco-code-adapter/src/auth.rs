//! Account authorization through the installed DevEco Code management API.
//!
//! Credentials stay in DevEco Code. This adapter only returns saved-credential
//! metadata and supervises one authenticated loopback management process.

use bitfun_services_core::process_manager::create_tokio_command;
use bitfun_services_core::process_tree::ProcessTreeChild;
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::future::Future;
use std::net::TcpListener;
use std::path::PathBuf;
use std::pin::Pin;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex, MutexGuard as StdMutexGuard};
use std::time::Duration;
use tokio::sync::{Mutex, Notify};
use tokio::time::{sleep, Instant};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(10 * 60 + 15);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(25);
const MAX_RESPONSE_BYTES: usize = 256 * 1024;
const UNAVAILABLE: &str = "deveco_auth_unavailable";
const UNSUPPORTED: &str = "deveco_auth_unsupported";
const INVALID_RESPONSE: &str = "deveco_auth_invalid_response";
const HTML_RESPONSE: &str = "deveco_auth_html_response";
const TIMEOUT: &str = "deveco_auth_timeout";
const LOGIN_FAILED: &str = "deveco_login_failed";
const CANCEL_FAILED: &str = "deveco_login_cancel_failed";
const LOGIN_IN_PROGRESS: &str = "deveco_login_in_progress";
const SESSION_MISMATCH: &str = "deveco_login_session_mismatch";
const CLOSED: &str = "deveco_auth_closed";

#[cfg(any(target_env = "ohos", test))]
mod browser;
mod credentials;

pub type DevEcoBrowserOpener =
    Arc<dyn Fn(String) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send>> + Send + Sync>;

#[derive(Clone)]
pub struct DevEcoAccountOptions {
    pub executable: PathBuf,
    pub prefix_arguments: Vec<String>,
    pub environment: HashMap<String, String>,
    pub working_directory: Option<PathBuf>,
    pub browser_opener: Option<DevEcoBrowserOpener>,
    pub browser_temporary_directory: Option<PathBuf>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DevEcoLoginState {
    Pending,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DevEcoAccountLogin {
    pub id: String,
    pub state: DevEcoLoginState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DevEcoAccountSnapshot {
    /// The configured CLI is available. OAuth support is checked only when
    /// the user starts login; status reads its shared saved credentials.
    pub available: bool,
    #[serde(default)]
    pub credential_present: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub login: Option<DevEcoAccountLogin>,
}

#[derive(Clone)]
struct Connection {
    base_url: String,
    password: String,
}

struct Runtime {
    child: ProcessTreeChild,
    connection: Connection,
    #[cfg(target_env = "ohos")]
    browser: browser::BrowserBridge,
}

struct LoginRecord {
    snapshot: DevEcoAccountLogin,
    cancel_requested: bool,
}

pub struct DevEcoAccountService {
    options: DevEcoAccountOptions,
    http: Client,
    runtime: StdMutex<Option<Runtime>>,
    login: StdMutex<Option<LoginRecord>>,
    startup: Mutex<()>,
    mutation: Mutex<()>,
    closed: AtomicBool,
    closing: Notify,
}

fn lock<T>(mutex: &StdMutex<T>) -> StdMutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

struct IdleRuntime<'a>(&'a DevEcoAccountService);

impl Drop for IdleRuntime<'_> {
    fn drop(&mut self) {
        let pending = lock(&self.0.login).as_ref().is_some_and(|record| {
            record.snapshot.state == DevEcoLoginState::Pending && !record.cancel_requested
        });
        if !pending || self.0.closed.load(Ordering::Acquire) {
            self.0.stop_runtime();
        }
    }
}

impl DevEcoAccountService {
    pub fn new(options: DevEcoAccountOptions) -> Result<Arc<Self>, String> {
        bitfun_services_core::tls_provider::ensure_ring_crypto_provider();
        let http = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(2))
            .build()
            .map_err(|_| UNAVAILABLE.to_string())?;
        Ok(Arc::new(Self {
            options,
            http,
            runtime: StdMutex::new(None),
            login: StdMutex::new(None),
            startup: Mutex::new(()),
            mutation: Mutex::new(()),
            closed: AtomicBool::new(false),
            closing: Notify::new(),
        }))
    }

    pub async fn status(&self) -> Result<DevEcoAccountSnapshot, String> {
        let _mutation = self.while_open(self.mutation.lock()).await?;
        let _idle = IdleRuntime(self);
        self.status_inner().await
    }

    async fn status_inner(&self) -> Result<DevEcoAccountSnapshot, String> {
        // Capture the operation state before reading credentials: a callback
        // can commit credentials while this read is in progress. Its completed
        // state is published by finish_login under the same mutation lock.
        let login = lock(&self.login)
            .as_ref()
            .map(|record| record.snapshot.clone());
        let metadata = self.while_open(credentials::read(&self.options)).await??;
        Ok(DevEcoAccountSnapshot {
            available: true,
            credential_present: Some(metadata.credential_present),
            login,
        })
    }

    /// Returns immediately after registering the pending authorization flow.
    /// DevEco Code opens its own browser when its callback endpoint is called.
    pub async fn start_login(self: &Arc<Self>) -> Result<DevEcoAccountSnapshot, String> {
        let _mutation = self.while_open(self.mutation.lock()).await?;
        let _idle = IdleRuntime(self);
        if self.is_pending().await {
            return Err(LOGIN_IN_PROGRESS.to_string());
        }
        let connection = self.connection().await?;
        #[cfg(target_env = "ohos")]
        if let Some(runtime) = lock(&self.runtime).as_ref() {
            runtime.browser.prepare_login()?;
        }
        let methods = self
            .request(
                &connection,
                Method::GET,
                "/provider/auth",
                None,
                REQUEST_TIMEOUT,
            )
            .await?;
        let method = oauth_method(&methods)?;
        let authorization = self
            .request(
                &connection,
                Method::POST,
                "/provider/deveco/oauth/authorize",
                Some(json!({ "method": method })),
                REQUEST_TIMEOUT,
            )
            .await?;
        // Huawei authorization is browser-based and must be owned by DevEco.
        // A changed wire contract must fail explicitly instead of accepting a
        // code-based or token-bearing result as the same flow.
        if authorization.get("method").and_then(Value::as_str) != Some("auto") {
            let _ = self.cancel_remote(&connection).await;
            return Err(UNSUPPORTED.to_string());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let mut login = lock(&self.login);
        if self.closed.load(Ordering::Acquire) {
            return Err(CLOSED.to_string());
        }
        *login = Some(LoginRecord {
            snapshot: DevEcoAccountLogin {
                id: id.clone(),
                state: DevEcoLoginState::Pending,
                error: None,
            },
            cancel_requested: false,
        });
        drop(login);
        let snapshot = DevEcoAccountSnapshot {
            available: true,
            // Starting OAuth does not require a saved-credential metadata API.
            credential_present: None,
            login: lock(&self.login)
                .as_ref()
                .map(|record| record.snapshot.clone()),
        };
        let service = Arc::clone(self);
        let task_connection = connection.clone();
        tokio::spawn(async move {
            let result = service
                .request(
                    &task_connection,
                    Method::POST,
                    "/provider/deveco/oauth/callback",
                    Some(json!({ "method": method })),
                    LOGIN_TIMEOUT,
                )
                .await;
            service.finish_login(&id, result).await;
        });
        Ok(snapshot)
    }

    pub async fn cancel_login(&self, session_id: &str) -> Result<DevEcoAccountSnapshot, String> {
        let _mutation = self.while_open(self.mutation.lock()).await?;
        let _idle = IdleRuntime(self);
        let pending = {
            let mut login = lock(&self.login);
            let record = login.as_mut().ok_or_else(|| SESSION_MISMATCH.to_string())?;
            if record.snapshot.id != session_id {
                return Err(SESSION_MISMATCH.to_string());
            }
            if record.snapshot.state != DevEcoLoginState::Pending {
                false
            } else {
                record.cancel_requested = true;
                true
            }
        };
        if !pending {
            return self.status_inner().await;
        }
        let connection = match self.connection().await {
            Ok(connection) => connection,
            Err(_) => {
                if let Some(record) = lock(&self.login)
                    .as_mut()
                    .filter(|record| record.snapshot.id == session_id)
                {
                    record.snapshot.state = DevEcoLoginState::Failed;
                    record.snapshot.error = Some(CANCEL_FAILED.to_string());
                }
                self.stop_runtime();
                return Err(CANCEL_FAILED.to_string());
            }
        };
        let result = self.cancel_remote(&connection).await;
        // DevEco can receive cancellation before it has installed the local
        // callback waiter. Stop our management process as well, so that an
        // acknowledged cancellation cannot leave a browser opener or callback
        // server running. This process never owns an ACP conversation.
        self.stop_runtime();
        // Older CLIs have OAuth but no cancel route. Reclaiming our dedicated
        // process also closes its callback server and pending authorization.
        let cancelled = match result {
            Ok(()) => true,
            Err(error) if error == UNSUPPORTED || error == HTML_RESPONSE => {
                log::info!("DevEco account cancellation completed through owned process shutdown");
                true
            }
            Err(_) => false,
        };
        {
            let mut login = lock(&self.login);
            if let Some(record) = login
                .as_mut()
                .filter(|record| record.snapshot.id == session_id)
            {
                record.snapshot.state = if cancelled {
                    DevEcoLoginState::Cancelled
                } else {
                    DevEcoLoginState::Failed
                };
                record.snapshot.error = (!cancelled).then(|| CANCEL_FAILED.to_string());
            }
        }
        if !cancelled {
            return Err(CANCEL_FAILED.to_string());
        }
        // Re-read shared credentials after the old callback process stopped,
        // including a callback racing cancellation. Do not start another one.
        self.status_inner().await
    }

    pub async fn logout(&self) -> Result<DevEcoAccountSnapshot, String> {
        let _mutation = self.while_open(self.mutation.lock()).await?;
        let _idle = IdleRuntime(self);
        if self.is_pending().await {
            return Err(LOGIN_IN_PROGRESS.to_string());
        }
        let metadata = self.while_open(credentials::read(&self.options)).await??;
        if metadata.read_only {
            return Err("deveco_auth_read_only".to_string());
        }
        let connection = self.connection().await?;
        let removed = self
            .request(
                &connection,
                Method::DELETE,
                "/auth/deveco",
                None,
                REQUEST_TIMEOUT,
            )
            .await?;
        if removed != Value::Bool(true) {
            return Err(UNSUPPORTED.to_string());
        }
        *lock(&self.login) = None;
        self.status_inner().await
    }

    /// Close admission and synchronously reclaim this service's process tree,
    /// including during emergency host exit. No other process owner is touched.
    pub fn shutdown_now(&self) {
        self.closed.store(true, Ordering::Release);
        self.closing.notify_waiters();
        {
            if let Some(record) = lock(&self.login)
                .as_mut()
                .filter(|record| record.snapshot.state == DevEcoLoginState::Pending)
            {
                record.cancel_requested = true;
                record.snapshot.state = DevEcoLoginState::Cancelled;
            }
        }
        self.stop_runtime();
    }

    async fn is_pending(&self) -> bool {
        lock(&self.login)
            .as_ref()
            .is_some_and(|record| record.snapshot.state == DevEcoLoginState::Pending)
    }

    async fn finish_login(&self, id: &str, result: Result<Value, String>) {
        let Ok(_mutation) = self.while_open(self.mutation.lock()).await else {
            return;
        };
        // Serialize completion with status/mutations before releasing the
        // process: another operation may still be using its Connection.
        let _idle = IdleRuntime(self);
        let mut login = lock(&self.login);
        if self.closed.load(Ordering::Acquire) {
            return;
        }
        let Some(record) = login.as_mut().filter(|record| record.snapshot.id == id) else {
            return;
        };
        if record.cancel_requested || record.snapshot.state != DevEcoLoginState::Pending {
            return;
        }
        match result {
            Ok(Value::Bool(true)) => record.snapshot.state = DevEcoLoginState::Succeeded,
            Err(error) if error == TIMEOUT => {
                record.snapshot.state = DevEcoLoginState::Failed;
                record.snapshot.error = Some(TIMEOUT.to_string());
            }
            _ => {
                record.snapshot.state = DevEcoLoginState::Failed;
                record.snapshot.error = Some(LOGIN_FAILED.to_string());
            }
        }
    }

    async fn cancel_remote(&self, connection: &Connection) -> Result<(), String> {
        match self
            .request(
                connection,
                Method::POST,
                "/provider/deveco/oauth/cancel",
                None,
                Duration::from_secs(5),
            )
            .await?
        {
            Value::Bool(true) => Ok(()),
            _ => Err(INVALID_RESPONSE.to_string()),
        }
    }

    async fn connection(&self) -> Result<Connection, String> {
        let _startup = self.while_open(self.startup.lock()).await?;
        if self.closed.load(Ordering::Acquire) {
            return Err(CLOSED.to_string());
        }
        {
            let mut runtime = lock(&self.runtime);
            if let Some(current) = runtime.as_mut() {
                if matches!(current.child.try_wait(), Ok(None)) {
                    return Ok(current.connection.clone());
                }
            }
        }
        // Drop an exited process tree before replacing its management server.
        self.stop_runtime();
        let port = TcpListener::bind(("127.0.0.1", 0))
            .and_then(|listener| listener.local_addr())
            .map_err(|_| UNAVAILABLE.to_string())?
            .port();
        let connection = Connection {
            base_url: format!("http://127.0.0.1:{port}"),
            password: format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ),
        };
        let mut command = create_tokio_command(&self.options.executable);
        command
            .args(&self.options.prefix_arguments)
            .args([
                "serve",
                "--hostname",
                "127.0.0.1",
                "--port",
                &port.to_string(),
            ])
            .envs(&self.options.environment)
            .env("DEVECO_SERVER_USERNAME", "deveco")
            .env("DEVECO_SERVER_PASSWORD", &connection.password)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if let Some(directory) = &self.options.working_directory {
            command.current_dir(directory);
        }
        #[cfg(target_env = "ohos")]
        let browser = browser::BrowserBridge::new(
            self.options
                .browser_opener
                .clone()
                .ok_or_else(|| UNSUPPORTED.to_string())?,
            self.options
                .browser_temporary_directory
                .as_deref()
                .ok_or_else(|| UNSUPPORTED.to_string())?,
        )?;
        #[cfg(target_env = "ohos")]
        browser.configure_command(&mut command)?;
        let child = self
            .while_open(ProcessTreeChild::spawn(&mut command))
            .await?
            .map_err(|_| UNAVAILABLE.to_string())?;
        {
            let mut runtime = lock(&self.runtime);
            if self.closed.load(Ordering::Acquire) {
                return Err(CLOSED.to_string());
            }
            *runtime = Some(Runtime {
                child,
                connection: connection.clone(),
                #[cfg(target_env = "ohos")]
                browser,
            });
        }
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        let result = loop {
            if self.closed.load(Ordering::Acquire) {
                break Err(CLOSED.to_string());
            }
            let alive = lock(&self.runtime)
                .as_mut()
                .is_some_and(|runtime| matches!(runtime.child.try_wait(), Ok(None)));
            if !alive {
                break Err(UNAVAILABLE.to_string());
            }
            if let Ok(health) = self
                .request(
                    &connection,
                    Method::GET,
                    "/global/health",
                    None,
                    Duration::from_secs(1),
                )
                .await
            {
                if health.get("healthy").and_then(Value::as_bool) == Some(true) {
                    break Ok(connection);
                }
            }
            if Instant::now() >= deadline {
                break Err(TIMEOUT.to_string());
            }
            if let Err(error) = self.while_open(sleep(Duration::from_millis(200))).await {
                break Err(error);
            }
        };
        if let Err(error) = &result {
            self.stop_runtime();
            if error != CLOSED {
                log::warn!("DevEco account management startup failed: code={error}");
            }
        }
        result
    }

    fn stop_runtime(&self) {
        // ProcessTreeChild synchronously kills only the child tree owned here.
        // Do not await protocol shutdown while the Desktop is trying to exit.
        // Keep ownership locked until Drop finishes so emergency cleanup cannot
        // observe an empty slot while an old tree is still being reclaimed.
        *lock(&self.runtime) = None;
    }

    async fn while_open<F: Future>(&self, operation: F) -> Result<F::Output, String> {
        let closing = self.closing.notified();
        tokio::pin!(closing);
        if self.closed.load(Ordering::Acquire) {
            return Err(CLOSED.to_string());
        }
        tokio::select! {
            biased;
            _ = &mut closing => Err(CLOSED.to_string()),
            output = operation => Ok(output),
        }
    }

    async fn request(
        &self,
        connection: &Connection,
        method: Method,
        route: &str,
        body: Option<Value>,
        timeout: Duration,
    ) -> Result<Value, String> {
        let diagnostic_level = if route == "/global/health" {
            log::Level::Debug
        } else {
            log::Level::Warn
        };
        let optional_route = (method == Method::GET && route == "/auth")
            || (method == Method::POST && route == "/provider/deveco/oauth/cancel");
        self.while_open(async {
            let mut url = reqwest::Url::parse(&format!("{}{route}", connection.base_url))
                .map_err(|_| UNAVAILABLE.to_string())?;
            if route.starts_with("/provider") {
                if let Some(directory) = &self.options.working_directory {
                    url.query_pairs_mut()
                        .append_pair("directory", &directory.to_string_lossy());
                }
            }
            let mut request = self
                .http
                .request(method.clone(), url)
                .basic_auth("deveco", Some(&connection.password))
                .timeout(timeout);
            if let Some(body) = body {
                request = request.json(&body);
            }
            let mut response = request.send().await.map_err(|error| {
                let code = request_error(error);
                log::log!(diagnostic_level, "DevEco account request failed: method={method}, route={route}, code={code}");
                code
            })?;
            if !response.status().is_success() {
                let missing_route = matches!(response.status().as_u16(), 404 | 405);
                let level = if optional_route && missing_route {
                    log::Level::Debug
                } else {
                    diagnostic_level
                };
                log::log!(
                    level,
                    "DevEco account request rejected: method={method}, route={route}, status={}",
                    response.status().as_u16()
                );
                return Err(if missing_route {
                    UNSUPPORTED
                } else {
                    UNAVAILABLE
                }
                .to_string());
            }
            if response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.split(';').next())
                .is_some_and(|value| value.trim().eq_ignore_ascii_case("text/html"))
            {
                let level = if optional_route {
                    log::Level::Debug
                } else {
                    diagnostic_level
                };
                log::log!(level, "DevEco account request returned HTML: method={method}, route={route}");
                return Err(HTML_RESPONSE.to_string());
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(request_error)? {
                if chunk.len() > MAX_RESPONSE_BYTES.saturating_sub(bytes.len()) {
                    log::log!(diagnostic_level, "DevEco account response exceeded its size limit: method={method}, route={route}");
                    return Err(INVALID_RESPONSE.to_string());
                }
                bytes.extend_from_slice(&chunk);
            }
            serde_json::from_slice(&bytes).map_err(|_| {
                log::log!(diagnostic_level, "DevEco account response is not JSON: method={method}, route={route}");
                INVALID_RESPONSE.to_string()
            })
        })
        .await?
    }
}

fn request_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        TIMEOUT
    } else {
        UNAVAILABLE
    }
    .to_string()
}

fn oauth_method(methods: &Value) -> Result<usize, String> {
    methods
        .get("deveco")
        .and_then(Value::as_array)
        .and_then(|methods| {
            methods
                .iter()
                .position(|method| method.get("type").and_then(Value::as_str) == Some("oauth"))
        })
        .ok_or_else(|| UNSUPPORTED.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use tokio::io::AsyncReadExt;

    #[test]
    fn management_fixture_child() {
        if std::env::var_os("BITFUN_DEVECO_FIXTURE_CHILD").is_none() {
            return;
        }
        loop {
            std::thread::park();
        }
    }

    async fn install_fixture_runtime(
        service: &DevEcoAccountService,
        connection: Connection,
    ) -> tokio::process::ChildStdout {
        let mut command = create_tokio_command(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "auth::tests::management_fixture_child",
                "--nocapture",
            ])
            .env("BITFUN_DEVECO_FIXTURE_CHILD", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = ProcessTreeChild::spawn(&mut command).await.unwrap();
        let stdout = child.take_stdout().unwrap();
        *lock(&service.runtime) = Some(Runtime {
            child,
            connection,
            #[cfg(target_env = "ohos")]
            browser: browser::BrowserBridge::new(
                Arc::new(|_| Box::pin(async { Ok(()) })),
                &std::env::temp_dir(),
            )
            .unwrap(),
        });
        stdout
    }

    async fn assert_fixture_exited(mut stdout: tokio::process::ChildStdout) {
        tokio::time::timeout(Duration::from_secs(5), stdout.read_to_end(&mut Vec::new()))
            .await
            .expect("the management fixture process must be reclaimed")
            .unwrap();
    }

    fn options() -> DevEcoAccountOptions {
        options_in(&std::env::temp_dir().join(format!(
            "bitfun-deveco-account-fixture-{}",
            uuid::Uuid::new_v4()
        )))
    }

    fn options_in(directory: &std::path::Path) -> DevEcoAccountOptions {
        DevEcoAccountOptions {
            executable: directory.join("absent-deveco"),
            prefix_arguments: Vec::new(),
            environment: HashMap::from([
                ("HOME".into(), directory.display().to_string()),
                ("USERPROFILE".into(), directory.display().to_string()),
                (
                    "XDG_DATA_HOME".into(),
                    directory.join("data").display().to_string(),
                ),
                (
                    "XDG_CONFIG_HOME".into(),
                    directory.join("config").display().to_string(),
                ),
                ("DEVECO_AUTH_CONTENT".into(), String::new()),
                ("DEVECO_RUNTIME_MODE".into(), "default".into()),
                ("DEVECO_STORAGE_ROOT".into(), String::new()),
            ]),
            working_directory: None,
            browser_opener: None,
            browser_temporary_directory: None,
        }
    }

    fn write_credentials(options: &DevEcoAccountOptions, present: bool) {
        let root = PathBuf::from(&options.environment["XDG_DATA_HOME"]).join("deveco");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("auth.json"), if present {
            r#"{"deveco":{"type":"oauth","access":"must-not-reach-ui","refresh":"fixture-refresh","expires":1}}"#
        } else { "{}" }).unwrap();
    }

    fn response_server(response: String) -> (Connection, std::thread::JoinHandle<String>) {
        response_server_after_accept(response, || {})
    }

    fn response_server_after_accept(
        response: String,
        accepted: impl FnOnce() + Send + 'static,
    ) -> (Connection, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let request = read_fixture_request(&mut socket);
            accepted();
            socket.write_all(response.as_bytes()).unwrap();
            request
        });
        (
            Connection {
                base_url: format!("http://127.0.0.1:{port}"),
                password: "fixture-only-password".to_string(),
            },
            server,
        )
    }

    fn read_fixture_request(socket: &mut std::net::TcpStream) -> String {
        let mut request = Vec::new();
        let mut buffer = [0; 1024];
        loop {
            if let Some(end) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&request[..end]);
                let length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                if request.len() >= end + 4 + length {
                    return String::from_utf8(request).unwrap();
                }
            }
            let size = socket.read(&mut buffer).unwrap();
            assert!(size > 0);
            request.extend_from_slice(&buffer[..size]);
        }
    }

    fn response_sequence(
        replies: Vec<(&'static str, String)>,
    ) -> (Connection, std::thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for (expected, response) in replies {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let request = read_fixture_request(&mut socket);
                assert!(
                    request.starts_with(expected),
                    "Unexpected account request route"
                );
                socket.write_all(response.as_bytes()).unwrap();
                requests.push(request);
            }
            requests
        });
        (
            Connection {
                base_url: format!("http://127.0.0.1:{port}"),
                password: "fixture-only-password".into(),
            },
            server,
        )
    }

    fn json_response(value: Value) -> String {
        let body = value.to_string();
        format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
    }

    #[test]
    fn status_reads_shared_credentials_without_starting_the_cli() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let directory = tempfile::tempdir().unwrap();
        runtime.block_on(async {
            let service = DevEcoAccountService::new(options_in(directory.path())).unwrap();
            assert!(!service.options.executable.exists());
            let snapshot = service.status().await.unwrap();
            assert!(snapshot.available);
            assert_eq!(snapshot.credential_present, Some(false));
            write_credentials(&service.options, true);
            assert_eq!(
                service.status().await.unwrap().credential_present,
                Some(true)
            );
            write_credentials(&service.options, false);
            assert_eq!(
                service.status().await.unwrap().credential_present,
                Some(false)
            );
            assert!(lock(&service.runtime).is_none());
        });
    }
    #[test]
    fn management_errors_keep_their_specific_transport_and_format_failures() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        for (response, expected) in [
            ("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(), UNAVAILABLE),
            ("HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(), UNAVAILABLE),
            ("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(), UNSUPPORTED),
            ("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 13\r\nConnection: close\r\n\r\n<html></html>".into(), HTML_RESPONSE),
            ("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 1\r\nConnection: close\r\n\r\n{".into(), INVALID_RESPONSE),
        ] {
            let (connection, server) = response_server(response);
            assert_eq!(runtime.block_on(DevEcoAccountService::new(options()).unwrap().request(&connection, Method::GET, "/provider/auth", None, REQUEST_TIMEOUT)).unwrap_err(), expected);
            server.join().unwrap();
        }
    }

    #[test]
    fn oauth_starts_and_completes_without_reading_saved_credential_metadata() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (connection, server) = response_sequence(vec![
            (
                "GET /provider/auth HTTP/1.1",
                json_response(json!({"deveco": [{"type": "api"}, {"type": "oauth"}]})),
            ),
            (
                "POST /provider/deveco/oauth/authorize HTTP/1.1",
                json_response(json!({"method": "auto"})),
            ),
            (
                "POST /provider/deveco/oauth/callback HTTP/1.1",
                json_response(Value::Bool(true)),
            ),
        ]);
        runtime.block_on(async {
            let service = DevEcoAccountService::new(options()).unwrap();
            let stdout = install_fixture_runtime(&service, connection).await;
            let snapshot = service.start_login().await.unwrap();
            assert_eq!(snapshot.credential_present, None);
            assert_eq!(snapshot.login.unwrap().state, DevEcoLoginState::Pending);
            tokio::time::timeout(Duration::from_secs(5), async {
                while lock(&service.login).as_ref().unwrap().snapshot.state
                    == DevEcoLoginState::Pending
                {
                    sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            assert_eq!(
                lock(&service.login).as_ref().unwrap().snapshot.state,
                DevEcoLoginState::Succeeded
            );
            assert_fixture_exited(stdout).await;
        });
        let requests = server.join().unwrap();
        assert!(requests[0]
            .to_ascii_lowercase()
            .contains("authorization: basic "));
        assert!(requests[1].ends_with(r#"{"method":1}"#));
        assert!(requests[2].ends_with(r#"{"method":1}"#));
    }

    #[test]
    fn discovers_the_deveco_oauth_method_index() {
        assert_eq!(
            oauth_method(&json!({ "deveco": [{ "type": "api" }, { "type": "oauth" }] })).unwrap(),
            1
        );
        assert!(oauth_method(&json!({ "other": [{ "type": "oauth" }] })).is_err());
    }

    #[test]
    fn cancellation_and_replacement_ignore_late_callback_completion() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let service = DevEcoAccountService::new(options()).unwrap();
            *lock(&service.login) = Some(LoginRecord {
                snapshot: DevEcoAccountLogin {
                    id: "current".to_string(),
                    state: DevEcoLoginState::Pending,
                    error: None,
                },
                cancel_requested: true,
            });
            service.finish_login("current", Ok(Value::Bool(true))).await;
            assert_eq!(
                lock(&service.login).as_ref().unwrap().snapshot.state,
                DevEcoLoginState::Pending
            );
            lock(&service.login).as_mut().unwrap().cancel_requested = false;
            service.finish_login("old", Ok(Value::Bool(true))).await;
            assert_eq!(
                lock(&service.login).as_ref().unwrap().snapshot.state,
                DevEcoLoginState::Pending
            );
            service.finish_login("current", Ok(Value::Bool(true))).await;
            assert_eq!(
                lock(&service.login).as_ref().unwrap().snapshot.state,
                DevEcoLoginState::Succeeded
            );
            service.shutdown_now();
            assert_eq!(service.status().await.unwrap_err(), CLOSED);
            assert_eq!(service.start_login().await.unwrap_err(), CLOSED);
            assert_eq!(service.cancel_login("current").await.unwrap_err(), CLOSED);
            let failing = DevEcoAccountService::new(options()).unwrap();
            *lock(&failing.login) = Some(LoginRecord {
                snapshot: DevEcoAccountLogin {
                    id: "cancel-failure".to_string(),
                    state: DevEcoLoginState::Pending,
                    error: None,
                },
                cancel_requested: false,
            });
            assert_eq!(
                failing.cancel_login("cancel-failure").await.unwrap_err(),
                CANCEL_FAILED
            );
            assert!(!failing.is_pending().await);
        });
    }

    #[test]
    fn missing_cancel_api_still_cancels_and_reclaims_the_owned_process() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (accepted_tx, accepted_rx) = tokio::sync::oneshot::channel();
        let (reply_tx, reply_rx) = std::sync::mpsc::channel();
        let missing = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let (connection, cancel_server) = response_server_after_accept(missing.into(), move || {
            accepted_tx.send(()).unwrap();
            reply_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        });
        let directory = tempfile::tempdir().unwrap();
        runtime.block_on(async {
            let service = DevEcoAccountService::new(options_in(directory.path())).unwrap();
            let old_stdout = install_fixture_runtime(&service, connection).await;
            *lock(&service.login) = Some(LoginRecord {
                snapshot: DevEcoAccountLogin {
                    id: "current".into(),
                    state: DevEcoLoginState::Pending,
                    error: None,
                },
                cancel_requested: false,
            });
            let cancelling = service.clone();
            let task = tokio::spawn(async move { cancelling.cancel_login("current").await });
            accepted_rx.await.unwrap();
            // A callback can commit shared credentials while cancellation is
            // in flight. Its final snapshot must observe the same file.
            write_credentials(&service.options, true);
            reply_tx.send(()).unwrap();
            let snapshot = task.await.unwrap().unwrap();
            assert_eq!(snapshot.login.unwrap().state, DevEcoLoginState::Cancelled);
            assert_eq!(snapshot.credential_present, Some(true));
            assert!(!service.is_pending().await);
            assert!(lock(&service.runtime).is_none());
            assert_fixture_exited(old_stdout).await;
        });
        assert!(cancel_server
            .join()
            .unwrap()
            .starts_with("POST /provider/deveco/oauth/cancel"));
    }

    #[test]
    fn status_serializes_callback_completion_before_releasing_management_runtime() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let directory = tempfile::tempdir().unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let connection = Connection {
            base_url: format!("http://{}", listener.local_addr().unwrap()),
            password: "fixture-only-password".into(),
        };
        runtime.block_on(async {
            let service = DevEcoAccountService::new(options_in(directory.path())).unwrap();
            let stdout = install_fixture_runtime(&service, connection).await;
            *lock(&service.login) = Some(LoginRecord {
                snapshot: DevEcoAccountLogin {
                    id: "current".to_string(),
                    state: DevEcoLoginState::Pending,
                    error: None,
                },
                cancel_requested: false,
            });
            write_credentials(&service.options, true);
            let reading = service.mutation.lock().await;
            let snapshot = service.status_inner().await.unwrap();
            let completing = service.clone();
            let completion = tokio::spawn(async move {
                completing
                    .finish_login("current", Ok(Value::Bool(true)))
                    .await;
            });
            tokio::task::yield_now().await;
            assert!(!completion.is_finished());
            assert!(lock(&service.runtime).is_some());
            assert_eq!(snapshot.credential_present, Some(true));
            assert_eq!(snapshot.login.unwrap().state, DevEcoLoginState::Pending);
            drop(reading);
            completion.await.unwrap();
            assert!(lock(&service.runtime).is_none());
            assert_fixture_exited(stdout).await;
            let completed = service.status().await.unwrap();
            assert_eq!(completed.credential_present, Some(true));
            assert_eq!(completed.login.unwrap().state, DevEcoLoginState::Succeeded);
        });
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }

    #[test]
    fn shared_metadata_redacts_secrets_and_releases_idle_management_runtime() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let directory = tempfile::tempdir().unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let connection = Connection {
            base_url: format!("http://{}", listener.local_addr().unwrap()),
            password: "fixture-only-password".into(),
        };
        let snapshot = runtime.block_on(async {
            let service = DevEcoAccountService::new(options_in(directory.path())).unwrap();
            write_credentials(&service.options, true);
            let stdout = install_fixture_runtime(&service, connection).await;
            let snapshot = service.status().await.unwrap();
            assert!(lock(&service.runtime).is_none());
            assert_fixture_exited(stdout).await;
            snapshot
        });
        assert!(snapshot.available && snapshot.credential_present == Some(true));
        assert!(!serde_json::to_string(&snapshot)
            .unwrap()
            .contains("must-not-reach-ui"));
        assert!(!serde_json::to_string(&snapshot)
            .unwrap()
            .contains("fixture-refresh"));
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }

    #[test]
    fn logout_uses_the_cli_to_remove_credentials_then_reads_the_shared_file() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let directory = tempfile::tempdir().unwrap();
        let options = options_in(directory.path());
        write_credentials(&options, true);
        let removing = options.clone();
        let (connection, server) =
            response_server_after_accept(json_response(Value::Bool(true)), move || {
                write_credentials(&removing, false)
            });
        runtime.block_on(async {
            let service = DevEcoAccountService::new(options).unwrap();
            let stdout = install_fixture_runtime(&service, connection).await;
            *lock(&service.login) = Some(LoginRecord {
                snapshot: DevEcoAccountLogin {
                    id: "completed".into(),
                    state: DevEcoLoginState::Succeeded,
                    error: None,
                },
                cancel_requested: false,
            });
            let snapshot = service.logout().await.unwrap();
            assert_eq!(snapshot.credential_present, Some(false));
            assert!(snapshot.login.is_none());
            assert!(lock(&service.runtime).is_none());
            assert_fixture_exited(stdout).await;
        });
        let request = server.join().unwrap();
        assert!(request.starts_with("DELETE /auth/deveco HTTP/1.1"));
        assert!(request
            .to_ascii_lowercase()
            .contains("authorization: basic "));
    }

    #[test]
    fn logout_rejects_injected_credentials_without_starting_a_process() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let mut options = options();
            options.environment.insert(
                "DEVECO_AUTH_CONTENT".into(),
                r#"{"deveco":{"type":"oauth","access":"fixture-only"}}"#.into(),
            );
            let service = DevEcoAccountService::new(options).unwrap();
            assert_eq!(service.logout().await.unwrap_err(), "deveco_auth_read_only");
            assert!(lock(&service.runtime).is_none());
        });
    }

    #[test]
    fn shutdown_interrupts_inflight_and_waiting_operations_and_reclaims_the_process() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (accepted_tx, accepted_rx) = tokio::sync::oneshot::channel();
        let (complete_tx, complete_rx) = std::sync::mpsc::channel();
        let (connection, server) = response_server_after_accept(String::new(), move || {
            accepted_tx.send(()).unwrap();
            complete_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        });
        runtime.block_on(async {
            let service = DevEcoAccountService::new(options()).unwrap();
            let stdout = install_fixture_runtime(&service, connection).await;
            let authorizing = service.clone();
            let login = tokio::spawn(async move { authorizing.start_login().await });
            accepted_rx.await.unwrap();
            let waiting = service.clone();
            let status = tokio::spawn(async move { waiting.status().await });
            tokio::task::yield_now().await;
            service.shutdown_now();
            assert!(lock(&service.runtime).is_none());
            assert_eq!(
                tokio::time::timeout(Duration::from_secs(1), status)
                    .await
                    .unwrap()
                    .unwrap()
                    .unwrap_err(),
                CLOSED
            );
            assert_eq!(
                tokio::time::timeout(Duration::from_secs(1), login)
                    .await
                    .unwrap()
                    .unwrap()
                    .unwrap_err(),
                CLOSED
            );
            assert_fixture_exited(stdout).await;
            complete_tx.send(()).unwrap();
        });
        server.join().unwrap();
    }

    #[test]
    fn rejects_management_redirect_instead_of_forwarding_basic_credentials() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let target = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        target.set_nonblocking(true).unwrap();
        let port = target.local_addr().unwrap().port();
        let (connection, server) = response_server(format!("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{port}/capture\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"));
        let result = runtime.block_on(async {
            DevEcoAccountService::new(options())
                .unwrap()
                .request(
                    &connection,
                    Method::GET,
                    "/provider/auth",
                    None,
                    REQUEST_TIMEOUT,
                )
                .await
        });
        assert_eq!(result.unwrap_err(), UNAVAILABLE);
        server.join().unwrap();
        assert_eq!(
            target.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }
}
