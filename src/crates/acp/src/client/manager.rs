use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use agent_client_protocol::schema::{
    CancelNotification, ClientCapabilities, Implementation, InitializeRequest, NewSessionRequest,
    PermissionOptionKind, ProtocolVersion, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, SelectedPermissionOutcome, SessionConfigOption,
    SessionConfigOptionValue, SessionModelState, SetSessionConfigOptionRequest,
    SetSessionModelRequest, StopReason,
};
use agent_client_protocol::{
    ActiveSession, Agent, ByteStreams, Client, ConnectionTo, Error, SessionMessage,
};
use bitfun_core::agentic::tools::registry::get_global_tool_registry;
use bitfun_core::infrastructure::events::{emit_global_event, BackendEvent};
use bitfun_core::service::config::ConfigService;
use bitfun_core::util::errors::{BitFunError, BitFunResult};
use dashmap::DashMap;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::process::{Child, Command};
use tokio::sync::{oneshot, Mutex, RwLock};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

use super::config::{
    AcpClientConfig, AcpClientConfigFile, AcpClientInfo, AcpClientPermissionMode, AcpClientStatus,
};
use super::session_options::{model_config_id, session_options_from_state, AcpSessionOptions};
use super::stream::{acp_dispatch_to_stream_events, AcpClientStreamEvent};
use super::tool::AcpAgentTool;

const CONFIG_PATH: &str = "acp_clients";
const PERMISSION_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitAcpPermissionResponseRequest {
    pub permission_id: String,
    pub approve: bool,
    #[serde(default)]
    pub option_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpClientPermissionResponse {
    pub permission_id: String,
    pub resolved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAcpSessionModelRequest {
    pub client_id: String,
    pub session_id: String,
    #[serde(default)]
    pub workspace_path: Option<String>,
    pub model_id: String,
}

pub struct AcpClientService {
    config_service: Arc<ConfigService>,
    clients: DashMap<String, Arc<AcpClientConnection>>,
    pending_permissions: DashMap<String, oneshot::Sender<RequestPermissionResponse>>,
    session_permission_modes: DashMap<String, AcpClientPermissionMode>,
}

struct AcpClientConnection {
    id: String,
    config: AcpClientConfig,
    status: RwLock<AcpClientStatus>,
    connection: RwLock<Option<ConnectionTo<Agent>>>,
    sessions: DashMap<String, Arc<Mutex<AcpRemoteSession>>>,
    cancel_handles: DashMap<String, AcpCancelHandle>,
    shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
    child: Mutex<Option<Child>>,
}

struct AcpRemoteSession {
    active: Option<ActiveSession<'static, Agent>>,
    models: Option<SessionModelState>,
    config_options: Vec<SessionConfigOption>,
}

struct AcpCancelHandle {
    session_id: String,
    connection: ConnectionTo<Agent>,
}

impl AcpRemoteSession {
    fn new() -> Self {
        Self {
            active: None,
            models: None,
            config_options: Vec::new(),
        }
    }
}

impl AcpClientService {
    pub fn new(config_service: Arc<ConfigService>) -> Arc<Self> {
        Arc::new(Self {
            config_service,
            clients: DashMap::new(),
            pending_permissions: DashMap::new(),
            session_permission_modes: DashMap::new(),
        })
    }

    pub async fn initialize_all(self: &Arc<Self>) -> BitFunResult<()> {
        let configs = self.load_configs().await?;
        self.register_configured_tools(&configs).await;

        let configured_ids = configs
            .keys()
            .cloned()
            .collect::<std::collections::HashSet<_>>();
        let running_ids = self
            .clients
            .iter()
            .map(|entry| entry.key().clone())
            .collect::<Vec<_>>();
        for running_id in running_ids {
            let should_stop = !configured_ids.contains(&running_id)
                || configs
                    .get(&running_id)
                    .map(|config| !config.enabled)
                    .unwrap_or(true);
            if should_stop {
                let _ = self.stop_client(&running_id).await;
            }
        }

        for (id, config) in configs {
            if config.enabled && config.auto_start {
                if let Err(error) = self.start_client(&id).await {
                    warn!("Failed to auto-start ACP client: id={} error={}", id, error);
                }
            }
        }

        Ok(())
    }

    pub async fn list_clients(self: &Arc<Self>) -> BitFunResult<Vec<AcpClientInfo>> {
        let configs = self.load_configs().await?;
        let mut infos = Vec::with_capacity(configs.len());
        for (id, config) in configs {
            let client = self.clients.get(&id).map(|entry| entry.clone());
            let status = match client.as_ref() {
                Some(client) => *client.status.read().await,
                None => AcpClientStatus::Configured,
            };
            let session_count = client
                .as_ref()
                .map(|client| client.sessions.len())
                .unwrap_or_default();
            infos.push(AcpClientInfo {
                tool_name: AcpAgentTool::tool_name_for(&id),
                name: config.name.clone().unwrap_or_else(|| id.clone()),
                command: config.command.clone(),
                args: config.args.clone(),
                enabled: config.enabled,
                auto_start: config.auto_start,
                readonly: config.readonly,
                permission_mode: config.permission_mode,
                id,
                status,
                session_count,
            });
        }
        infos.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(infos)
    }

    pub async fn start_client(self: &Arc<Self>, client_id: &str) -> BitFunResult<()> {
        if let Some(existing) = self.clients.get(client_id) {
            let status = *existing.status.read().await;
            if matches!(status, AcpClientStatus::Running | AcpClientStatus::Starting) {
                return Ok(());
            }
        }

        let config = self
            .load_configs()
            .await?
            .remove(client_id)
            .ok_or_else(|| BitFunError::NotFound(format!("ACP client not found: {}", client_id)))?;

        if !config.enabled {
            return Err(BitFunError::config(format!(
                "ACP client is disabled: {}",
                client_id
            )));
        }

        let connection = Arc::new(AcpClientConnection::new(client_id.to_string(), config));
        self.clients
            .insert(client_id.to_string(), connection.clone());
        *connection.status.write().await = AcpClientStatus::Starting;

        let mut command = Command::new(&connection.config.command);
        command
            .args(&connection.config.args)
            .envs(&connection.config.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                self.clients.remove(client_id);
                *connection.status.write().await = AcpClientStatus::Failed;
                return Err(BitFunError::service(format!(
                    "Failed to spawn ACP client '{}': {}",
                    client_id, error
                )));
            }
        };

        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                let _ = child.start_kill();
                self.clients.remove(client_id);
                *connection.status.write().await = AcpClientStatus::Failed;
                return Err(BitFunError::service(format!(
                    "ACP client '{}' stdout is unavailable",
                    client_id
                )));
            }
        };
        let stdin = match child.stdin.take() {
            Some(stdin) => stdin,
            None => {
                let _ = child.start_kill();
                self.clients.remove(client_id);
                *connection.status.write().await = AcpClientStatus::Failed;
                return Err(BitFunError::service(format!(
                    "ACP client '{}' stdin is unavailable",
                    client_id
                )));
            }
        };

        *connection.child.lock().await = Some(child);

        let transport = ByteStreams::new(stdin.compat_write(), stdout.compat());
        let service = self.clone();
        let connection_for_task = connection.clone();
        let (cx_tx, cx_rx) = oneshot::channel();
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        *connection.shutdown_tx.lock().await = Some(shutdown_tx);

        tokio::spawn(async move {
            let result = Client
                .builder()
                .name("bitfun-acp-client")
                .on_receive_request(
                    {
                        let service = service.clone();
                        async move |request: RequestPermissionRequest, responder, cx| {
                            let service = service.clone();
                            cx.spawn(async move {
                                responder.respond_with_result(
                                    service.handle_permission_request(request).await,
                                )
                            })?;
                            Ok(())
                        }
                    },
                    agent_client_protocol::on_receive_request!(),
                )
                .connect_with(transport, async move |cx| {
                    let init = InitializeRequest::new(ProtocolVersion::V1)
                        .client_capabilities(ClientCapabilities::new())
                        .client_info(Implementation::new(
                            "bitfun-desktop",
                            env!("CARGO_PKG_VERSION"),
                        ));
                    cx.send_request(init).block_task().await?;
                    let _ = cx_tx.send(cx);
                    let _ = shutdown_rx.await;
                    Ok(())
                })
                .await;

            if let Err(error) = result {
                warn!(
                    "ACP client connection ended with error: id={} error={:?}",
                    connection_for_task.id, error
                );
                *connection_for_task.status.write().await = AcpClientStatus::Failed;
            } else {
                *connection_for_task.status.write().await = AcpClientStatus::Stopped;
            }
            *connection_for_task.connection.write().await = None;
            connection_for_task.sessions.clear();
        });

        let cx = cx_rx.await.map_err(|_| {
            BitFunError::service(format!(
                "ACP client '{}' exited before initialization completed",
                client_id
            ))
        })?;
        *connection.connection.write().await = Some(cx);
        *connection.status.write().await = AcpClientStatus::Running;
        info!("ACP client started: id={}", client_id);
        Ok(())
    }

    pub async fn stop_client(self: &Arc<Self>, client_id: &str) -> BitFunResult<()> {
        let Some(client) = self.clients.get(client_id).map(|entry| entry.clone()) else {
            return Ok(());
        };

        if let Some(tx) = client.shutdown_tx.lock().await.take() {
            let _ = tx.send(());
        }
        if let Some(mut child) = client.child.lock().await.take() {
            if let Err(error) = child.start_kill() {
                warn!(
                    "Failed to kill ACP client process: id={} error={}",
                    client_id, error
                );
            }
        }
        *client.connection.write().await = None;
        client.sessions.clear();
        client.cancel_handles.clear();
        *client.status.write().await = AcpClientStatus::Stopped;
        self.clients.remove(client_id);
        info!("ACP client stopped: id={}", client_id);
        Ok(())
    }

    pub async fn restart_client(self: &Arc<Self>, client_id: &str) -> BitFunResult<()> {
        self.stop_client(client_id).await?;
        self.start_client(client_id).await
    }

    pub async fn load_json_config(&self) -> BitFunResult<String> {
        let value = self.load_config_value().await?;
        serde_json::to_string_pretty(&value)
            .map_err(|error| BitFunError::config(format!("Failed to render ACP config: {}", error)))
    }

    pub async fn save_json_config(self: &Arc<Self>, json_config: &str) -> BitFunResult<()> {
        let value: serde_json::Value = serde_json::from_str(json_config).map_err(|error| {
            BitFunError::config(format!("Invalid ACP client JSON config: {}", error))
        })?;
        parse_config_value(value.clone())?;
        self.config_service.set_config(CONFIG_PATH, value).await?;
        self.initialize_all().await
    }

    pub async fn submit_permission_response(
        &self,
        request: SubmitAcpPermissionResponseRequest,
    ) -> BitFunResult<AcpClientPermissionResponse> {
        let Some((_, sender)) = self.pending_permissions.remove(&request.permission_id) else {
            return Err(BitFunError::NotFound(format!(
                "ACP permission request not found: {}",
                request.permission_id
            )));
        };

        let option_id = request.option_id.unwrap_or_else(|| {
            if request.approve {
                "allow_once".to_string()
            } else {
                "reject_once".to_string()
            }
        });
        let response = RequestPermissionResponse::new(RequestPermissionOutcome::Selected(
            SelectedPermissionOutcome::new(option_id),
        ));
        let _ = sender.send(response);
        Ok(AcpClientPermissionResponse {
            permission_id: request.permission_id,
            resolved: true,
        })
    }

    pub async fn get_session_options(
        self: &Arc<Self>,
        client_id: &str,
        workspace_path: Option<String>,
        bitfun_session_id: Option<String>,
    ) -> BitFunResult<AcpSessionOptions> {
        let (client, cwd, session_key) = self
            .resolve_client_session(client_id, workspace_path, bitfun_session_id.as_deref())
            .await?;
        let session = client
            .sessions
            .entry(session_key.clone())
            .or_insert_with(|| Arc::new(Mutex::new(AcpRemoteSession::new())))
            .clone();

        let mut session = session.lock().await;
        self.ensure_remote_session(&client, &session_key, &cwd, &mut session)
            .await?;
        Ok(session_options_from_state(
            session.models.as_ref(),
            &session.config_options,
        ))
    }

    pub async fn set_session_model(
        self: &Arc<Self>,
        request: SetAcpSessionModelRequest,
    ) -> BitFunResult<AcpSessionOptions> {
        let (client, cwd, session_key) = self
            .resolve_client_session(
                &request.client_id,
                request.workspace_path,
                Some(&request.session_id),
            )
            .await?;
        let session = client
            .sessions
            .entry(session_key.clone())
            .or_insert_with(|| Arc::new(Mutex::new(AcpRemoteSession::new())))
            .clone();

        let mut session = session.lock().await;
        self.ensure_remote_session(&client, &session_key, &cwd, &mut session)
            .await?;
        let active = session
            .active
            .as_ref()
            .ok_or_else(|| BitFunError::service("ACP session was not initialized"))?;
        let remote_session_id = active.session_id().to_string();
        let connection = active.connection();

        let mut set_model_error = None;
        if session.models.is_some() {
            match connection
                .send_request(SetSessionModelRequest::new(
                    remote_session_id.clone(),
                    request.model_id.clone(),
                ))
                .block_task()
                .await
                .map_err(protocol_error)
            {
                Ok(_) => {
                    if let Some(models) = session.models.as_mut() {
                        models.current_model_id = request.model_id.clone().into();
                    }
                    return Ok(session_options_from_state(
                        session.models.as_ref(),
                        &session.config_options,
                    ));
                }
                Err(error) => {
                    set_model_error = Some(error);
                }
            }
        }

        if let Some(config_id) = model_config_id(&session.config_options) {
            let response = connection
                .send_request(SetSessionConfigOptionRequest::new(
                    remote_session_id,
                    config_id,
                    SessionConfigOptionValue::value_id(request.model_id.clone()),
                ))
                .block_task()
                .await
                .map_err(protocol_error)?;
            session.config_options = response.config_options;
            return Ok(session_options_from_state(
                session.models.as_ref(),
                &session.config_options,
            ));
        }

        if let Some(error) = set_model_error {
            return Err(error);
        }
        Err(BitFunError::NotFound(
            "ACP session does not expose selectable models".to_string(),
        ))
    }

    pub async fn prompt_agent(
        self: &Arc<Self>,
        client_id: &str,
        prompt: String,
        workspace_path: Option<String>,
        bitfun_session_id: Option<String>,
        timeout_seconds: Option<u64>,
    ) -> BitFunResult<String> {
        let (client, cwd, session_key) = self
            .resolve_client_session(client_id, workspace_path, bitfun_session_id.as_deref())
            .await?;
        let session = client
            .sessions
            .entry(session_key.clone())
            .or_insert_with(|| Arc::new(Mutex::new(AcpRemoteSession::new())))
            .clone();

        let run = async {
            let mut session = session.lock().await;
            self.ensure_remote_session(&client, &session_key, &cwd, &mut session)
                .await?;

            let active = session
                .active
                .as_mut()
                .ok_or_else(|| BitFunError::service("ACP session was not initialized"))?;
            active.send_prompt(prompt).map_err(protocol_error)?;
            active.read_to_string().await.map_err(protocol_error)
        };

        if let Some(seconds) = timeout_seconds.filter(|seconds| *seconds > 0) {
            tokio::time::timeout(Duration::from_secs(seconds), run)
                .await
                .map_err(|_| {
                    BitFunError::tool(format!("ACP client timed out after {}s", seconds))
                })?
        } else {
            run.await
        }
    }

    pub async fn prompt_agent_stream<F>(
        self: &Arc<Self>,
        client_id: &str,
        prompt: String,
        workspace_path: Option<String>,
        bitfun_session_id: Option<String>,
        timeout_seconds: Option<u64>,
        mut on_event: F,
    ) -> BitFunResult<()>
    where
        F: FnMut(AcpClientStreamEvent) -> BitFunResult<()> + Send,
    {
        let (client, cwd, session_key) = self
            .resolve_client_session(client_id, workspace_path, bitfun_session_id.as_deref())
            .await?;
        let session = client
            .sessions
            .entry(session_key.clone())
            .or_insert_with(|| Arc::new(Mutex::new(AcpRemoteSession::new())))
            .clone();

        let run = async {
            let mut session = session.lock().await;
            self.ensure_remote_session(&client, &session_key, &cwd, &mut session)
                .await?;

            let active = session
                .active
                .as_mut()
                .ok_or_else(|| BitFunError::service("ACP session was not initialized"))?;
            active.send_prompt(prompt).map_err(protocol_error)?;

            loop {
                match active.read_update().await.map_err(protocol_error)? {
                    SessionMessage::SessionMessage(dispatch) => {
                        for event in acp_dispatch_to_stream_events(dispatch).await? {
                            on_event(event)?;
                        }
                    }
                    SessionMessage::StopReason(stop_reason) => {
                        let event = if matches!(stop_reason, StopReason::Cancelled) {
                            AcpClientStreamEvent::Cancelled
                        } else {
                            AcpClientStreamEvent::Completed
                        };
                        on_event(event)?;
                        break;
                    }
                    _ => {}
                }
            }
            Ok(())
        };

        if let Some(seconds) = timeout_seconds.filter(|seconds| *seconds > 0) {
            tokio::time::timeout(Duration::from_secs(seconds), run)
                .await
                .map_err(|_| {
                    BitFunError::tool(format!("ACP client timed out after {}s", seconds))
                })?
        } else {
            run.await
        }
    }

    pub async fn cancel_agent_session(
        self: &Arc<Self>,
        client_id: &str,
        workspace_path: Option<String>,
        bitfun_session_id: Option<String>,
    ) -> BitFunResult<()> {
        let client = self
            .clients
            .get(client_id)
            .map(|entry| entry.clone())
            .ok_or_else(|| {
                BitFunError::service(format!("ACP client is not running: {}", client_id))
            })?;

        let cwd = workspace_path
            .map(PathBuf::from)
            .or_else(|| std::env::current_dir().ok())
            .ok_or_else(|| BitFunError::validation("Workspace path is required".to_string()))?;
        let session_key = build_session_key(bitfun_session_id.as_deref(), client_id, &cwd);
        let handle = client.cancel_handles.get(&session_key).ok_or_else(|| {
            BitFunError::NotFound(format!(
                "ACP session is not active for client '{}' in workspace '{}'",
                client_id,
                cwd.display()
            ))
        })?;

        handle
            .connection
            .send_notification(CancelNotification::new(handle.session_id.clone()))
            .map_err(protocol_error)?;
        Ok(())
    }

    async fn resolve_client_session(
        self: &Arc<Self>,
        client_id: &str,
        workspace_path: Option<String>,
        bitfun_session_id: Option<&str>,
    ) -> BitFunResult<(Arc<AcpClientConnection>, PathBuf, String)> {
        self.start_client(client_id).await?;
        let client = self
            .clients
            .get(client_id)
            .map(|entry| entry.clone())
            .ok_or_else(|| {
                BitFunError::service(format!("ACP client is not running: {}", client_id))
            })?;

        let cwd = workspace_path
            .map(PathBuf::from)
            .or_else(|| std::env::current_dir().ok())
            .ok_or_else(|| BitFunError::validation("Workspace path is required".to_string()))?;
        let session_key = build_session_key(bitfun_session_id, client_id, &cwd);
        Ok((client, cwd, session_key))
    }

    async fn ensure_remote_session(
        &self,
        client: &Arc<AcpClientConnection>,
        session_key: &str,
        cwd: &Path,
        session: &mut AcpRemoteSession,
    ) -> BitFunResult<()> {
        if session.active.is_some() {
            return Ok(());
        }

        let cx = client.connection().await?;
        let response = cx
            .send_request(NewSessionRequest::new(cwd))
            .block_task()
            .await
            .map_err(protocol_error)?;

        let models = response.models.clone();
        let config_options = response.config_options.clone().unwrap_or_default();
        let active = cx
            .attach_session(response, Vec::new())
            .map_err(protocol_error)?;
        client.cancel_handles.insert(
            session_key.to_string(),
            AcpCancelHandle {
                session_id: active.session_id().to_string(),
                connection: active.connection(),
            },
        );
        self.session_permission_modes.insert(
            active.session_id().to_string(),
            client.config.permission_mode,
        );
        session.models = models;
        session.config_options = config_options;
        session.active = Some(active);
        Ok(())
    }

    async fn load_configs(&self) -> BitFunResult<HashMap<String, AcpClientConfig>> {
        let mut configs = parse_config_value(self.load_config_value().await?)?.acp_clients;
        configs
            .entry("opencode".to_string())
            .or_insert_with(default_opencode_client_config);
        Ok(configs)
    }

    async fn load_config_value(&self) -> BitFunResult<serde_json::Value> {
        Ok(self
            .config_service
            .get_config::<serde_json::Value>(Some(CONFIG_PATH))
            .await
            .unwrap_or_else(|_| json!({ "acpClients": {} })))
    }

    async fn register_configured_tools(
        self: &Arc<Self>,
        configs: &HashMap<String, AcpClientConfig>,
    ) {
        let registry = get_global_tool_registry();
        let mut registry = registry.write().await;
        registry.unregister_tools_by_prefix("acp__");

        let tools = configs
            .iter()
            .filter(|(_, config)| config.enabled)
            .map(|(id, config)| {
                Arc::new(AcpAgentTool::new(id.clone(), config.clone(), self.clone()))
                    as Arc<dyn bitfun_core::agentic::tools::framework::Tool>
            })
            .collect::<Vec<_>>();

        for tool in tools {
            debug!("Registering ACP client tool: name={}", tool.name());
            registry.register_tool(tool);
        }
    }

    async fn handle_permission_request(
        self: Arc<Self>,
        request: RequestPermissionRequest,
    ) -> Result<RequestPermissionResponse, Error> {
        let session_id = request.session_id.to_string();
        let permission_mode = self.permission_mode_for_session(&session_id);
        match permission_mode {
            AcpClientPermissionMode::AllowOnce => {
                return Ok(select_permission_by_kind(
                    &request,
                    PermissionOptionKind::AllowOnce,
                    true,
                ));
            }
            AcpClientPermissionMode::RejectOnce => {
                return Ok(select_permission_by_kind(
                    &request,
                    PermissionOptionKind::RejectOnce,
                    false,
                ));
            }
            AcpClientPermissionMode::Ask => {}
        }

        let permission_id = format!("acp_permission_{}", uuid::Uuid::new_v4());
        let (tx, rx) = oneshot::channel();
        self.pending_permissions.insert(permission_id.clone(), tx);

        let payload = json!({
            "permissionId": permission_id,
            "sessionId": session_id,
            "toolCall": request.tool_call,
            "options": request.options,
        });

        if let Err(error) = emit_global_event(BackendEvent::Custom {
            event_name: "backend-event-acppermissionrequest".to_string(),
            payload,
        })
        .await
        {
            warn!("Failed to emit ACP permission request: {}", error);
        }

        match tokio::time::timeout(PERMISSION_TIMEOUT, rx).await {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(_)) => Ok(RequestPermissionResponse::new(
                RequestPermissionOutcome::Cancelled,
            )),
            Err(_) => {
                self.pending_permissions.remove(&permission_id);
                Ok(RequestPermissionResponse::new(
                    RequestPermissionOutcome::Cancelled,
                ))
            }
        }
    }

    fn permission_mode_for_session(&self, session_id: &str) -> AcpClientPermissionMode {
        self.session_permission_modes
            .get(session_id)
            .map(|entry| *entry.value())
            .unwrap_or(AcpClientPermissionMode::Ask)
    }
}

impl AcpClientConnection {
    fn new(id: String, config: AcpClientConfig) -> Self {
        Self {
            id,
            config,
            status: RwLock::new(AcpClientStatus::Configured),
            connection: RwLock::new(None),
            sessions: DashMap::new(),
            cancel_handles: DashMap::new(),
            shutdown_tx: Mutex::new(None),
            child: Mutex::new(None),
        }
    }

    async fn connection(&self) -> BitFunResult<ConnectionTo<Agent>> {
        self.connection.read().await.clone().ok_or_else(|| {
            BitFunError::service(format!("ACP client is not connected: {}", self.id))
        })
    }
}

fn parse_config_value(value: serde_json::Value) -> BitFunResult<AcpClientConfigFile> {
    if value.get("acpClients").is_some() {
        serde_json::from_value(value)
            .map_err(|error| BitFunError::config(format!("Invalid ACP client config: {}", error)))
    } else if value.is_object() {
        serde_json::from_value(json!({ "acpClients": value })).map_err(|error| {
            BitFunError::config(format!("Invalid ACP client config map: {}", error))
        })
    } else {
        Err(BitFunError::config(
            "ACP client config must be an object".to_string(),
        ))
    }
}

fn default_opencode_client_config() -> AcpClientConfig {
    AcpClientConfig {
        name: Some("opencode".to_string()),
        command: "opencode".to_string(),
        args: vec!["acp".to_string()],
        env: HashMap::new(),
        enabled: true,
        auto_start: false,
        readonly: false,
        permission_mode: AcpClientPermissionMode::Ask,
    }
}

fn build_session_key(bitfun_session_id: Option<&str>, client_id: &str, cwd: &Path) -> String {
    format!(
        "{}:{}:{}",
        bitfun_session_id.unwrap_or("standalone"),
        client_id,
        cwd.to_string_lossy()
    )
}

fn protocol_error(error: impl std::fmt::Display) -> BitFunError {
    BitFunError::service(format!("ACP protocol error: {}", error))
}

fn select_permission_by_kind(
    request: &RequestPermissionRequest,
    preferred: PermissionOptionKind,
    approve: bool,
) -> RequestPermissionResponse {
    let fallback_kind = if approve {
        PermissionOptionKind::AllowAlways
    } else {
        PermissionOptionKind::RejectAlways
    };
    let option_id = request
        .options
        .iter()
        .find(|option| option.kind == preferred)
        .or_else(|| {
            request
                .options
                .iter()
                .find(|option| option.kind == fallback_kind)
        })
        .or_else(|| request.options.first())
        .map(|option| option.option_id.to_string())
        .unwrap_or_else(|| {
            if approve {
                "allow_once".to_string()
            } else {
                "reject_once".to_string()
            }
        });
    RequestPermissionResponse::new(RequestPermissionOutcome::Selected(
        SelectedPermissionOutcome::new(option_id),
    ))
}
