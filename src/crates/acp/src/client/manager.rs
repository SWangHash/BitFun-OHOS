use std::collections::HashMap;
use std::env;
#[cfg(windows)]
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use agent_client_protocol::schema::{
    AgentCapabilities, CancelNotification, ClientCapabilities, Implementation, InitializeRequest,
    LoadSessionRequest, LoadSessionResponse, NewSessionRequest, NewSessionResponse,
    PermissionOption, PermissionOptionKind, ProtocolVersion, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, ResumeSessionRequest,
    ResumeSessionResponse, SelectedPermissionOutcome, SessionConfigOption,
    SessionConfigOptionValue, SessionModelState, SetSessionConfigOptionRequest,
    SetSessionModelRequest, StopReason,
};
use agent_client_protocol::{
    ActiveSession, Agent, ByteStreams, Client, ConnectionTo, Error, SessionMessage,
};
use bitfun_core::agentic::tools::registry::get_global_tool_registry;
use bitfun_core::infrastructure::events::{emit_global_event, BackendEvent};
use bitfun_core::infrastructure::PathManager;
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
    AcpClientConfig, AcpClientConfigFile, AcpClientInfo, AcpClientPermissionMode,
    AcpClientRequirementProbe, AcpClientStatus, AcpRequirementProbeItem,
};
use super::remote_session::{preferred_resume_strategies, AcpRemoteSessionStrategy};
use super::session_options::{model_config_id, session_options_from_state, AcpSessionOptions};
use super::session_persistence::AcpSessionPersistence;
pub use super::session_persistence::CreateAcpFlowSessionRecordResponse;
use super::stream::{acp_dispatch_to_stream_events, AcpClientStreamEvent, AcpStreamRoundTracker};
use super::tool::AcpAgentTool;

const CONFIG_PATH: &str = "acp_clients";
const PERMISSION_TIMEOUT: Duration = Duration::from_secs(600);
const LOAD_REPLAY_DRAIN_QUIET_WINDOW: Duration = Duration::from_millis(250);
const LOAD_REPLAY_DRAIN_MAX_DURATION: Duration = Duration::from_secs(2);
const REQUIREMENT_PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const ADAPTER_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(120);

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
    #[serde(default)]
    pub remote_connection_id: Option<String>,
    #[serde(default)]
    pub remote_ssh_host: Option<String>,
    pub model_id: String,
}

pub struct AcpClientService {
    config_service: Arc<ConfigService>,
    session_persistence: AcpSessionPersistence,
    clients: DashMap<String, Arc<AcpClientConnection>>,
    pending_permissions: DashMap<String, PendingPermission>,
    session_permission_modes: DashMap<String, AcpClientPermissionMode>,
}

struct PendingPermission {
    sender: oneshot::Sender<RequestPermissionResponse>,
    options: Vec<PermissionOption>,
}

struct AcpClientConnection {
    id: String,
    config: AcpClientConfig,
    status: RwLock<AcpClientStatus>,
    connection: RwLock<Option<ConnectionTo<Agent>>>,
    agent_capabilities: RwLock<Option<AgentCapabilities>>,
    sessions: DashMap<String, Arc<Mutex<AcpRemoteSession>>>,
    cancel_handles: DashMap<String, AcpCancelHandle>,
    shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
    child: Mutex<Option<Child>>,
}

struct AcpRemoteSession {
    active: Option<ActiveSession<'static, Agent>>,
    models: Option<SessionModelState>,
    config_options: Vec<SessionConfigOption>,
    discard_pending_updates_before_next_prompt: bool,
}

#[derive(Clone)]
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
            discard_pending_updates_before_next_prompt: false,
        }
    }
}

impl AcpClientService {
    pub fn new(
        config_service: Arc<ConfigService>,
        path_manager: Arc<PathManager>,
    ) -> BitFunResult<Arc<Self>> {
        Ok(Arc::new(Self {
            config_service,
            session_persistence: AcpSessionPersistence::new(path_manager)?,
            clients: DashMap::new(),
            pending_permissions: DashMap::new(),
            session_permission_modes: DashMap::new(),
        }))
    }

    pub async fn create_flow_session_record(
        &self,
        session_storage_path: &Path,
        workspace_path: &str,
        client_id: &str,
        session_name: Option<String>,
    ) -> BitFunResult<CreateAcpFlowSessionRecordResponse> {
        self.session_persistence
            .create_flow_session_record(
                session_storage_path,
                workspace_path,
                client_id,
                session_name,
            )
            .await
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

    pub async fn probe_client_requirements(
        self: &Arc<Self>,
    ) -> BitFunResult<Vec<AcpClientRequirementProbe>> {
        let configs = self.load_configs().await?;
        let mut ids = configs.keys().cloned().collect::<Vec<_>>();
        for id in ["opencode", "claude-code", "codex"] {
            if !ids.iter().any(|candidate| candidate == id) {
                ids.push(id.to_string());
            }
        }
        ids.sort();

        let mut probes = Vec::with_capacity(ids.len());
        for id in ids {
            let spec = acp_requirement_spec(&id, configs.get(&id));
            let tool = probe_executable(spec.tool_command).await;
            let adapter = match spec.adapter {
                Some(adapter) => Some(probe_npm_adapter(adapter.package, adapter.bin).await),
                None => None,
            };
            let runnable = tool.installed
                && adapter
                    .as_ref()
                    .map(|adapter| adapter.installed)
                    .unwrap_or(true);
            let mut notes = Vec::new();
            if !tool.installed {
                notes.push(format!("{} is not available on PATH", spec.tool_command));
            }
            if let Some(adapter) = adapter.as_ref() {
                if !adapter.installed {
                    notes.push(format!(
                        "{} is not installed in npm global or offline cache",
                        adapter.name
                    ));
                }
            }

            probes.push(AcpClientRequirementProbe {
                id,
                tool,
                adapter,
                runnable,
                notes,
            });
        }

        Ok(probes)
    }

    pub async fn predownload_client_adapter(self: &Arc<Self>, client_id: &str) -> BitFunResult<()> {
        let configs = self.load_configs().await?;
        let spec = acp_requirement_spec(client_id, configs.get(client_id));
        let adapter = spec.adapter.ok_or_else(|| {
            BitFunError::config(format!(
                "ACP client '{}' does not use a downloadable adapter",
                client_id
            ))
        })?;

        predownload_npm_adapter(adapter.package, adapter.bin).await
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
                    let initialize_response = cx.send_request(init).block_task().await?;
                    let _ = cx_tx.send((cx, initialize_response.agent_capabilities));
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
            *connection_for_task.agent_capabilities.write().await = None;
            connection_for_task.sessions.clear();
        });

        let (cx, agent_capabilities) = cx_rx.await.map_err(|_| {
            BitFunError::service(format!(
                "ACP client '{}' exited before initialization completed",
                client_id
            ))
        })?;
        *connection.connection.write().await = Some(cx);
        *connection.agent_capabilities.write().await = Some(agent_capabilities);
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
        *client.agent_capabilities.write().await = None;
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
        let Some((_, pending)) = self.pending_permissions.remove(&request.permission_id) else {
            return Err(BitFunError::NotFound(format!(
                "ACP permission request not found: {}",
                request.permission_id
            )));
        };

        let option_id = request
            .option_id
            .unwrap_or_else(|| select_permission_option_id(&pending.options, request.approve));
        let response = RequestPermissionResponse::new(RequestPermissionOutcome::Selected(
            SelectedPermissionOutcome::new(option_id),
        ));
        let _ = pending.sender.send(response);
        Ok(AcpClientPermissionResponse {
            permission_id: request.permission_id,
            resolved: true,
        })
    }

    pub async fn get_session_options(
        self: &Arc<Self>,
        client_id: &str,
        workspace_path: Option<String>,
        session_storage_path: Option<PathBuf>,
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
        self.ensure_remote_session(
            &client,
            &session_key,
            &cwd,
            bitfun_session_id.as_deref(),
            session_storage_path.as_deref(),
            &mut session,
        )
        .await?;
        Ok(session_options_from_state(
            session.models.as_ref(),
            &session.config_options,
        ))
    }

    pub async fn set_session_model(
        self: &Arc<Self>,
        request: SetAcpSessionModelRequest,
        session_storage_path: Option<PathBuf>,
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
        self.ensure_remote_session(
            &client,
            &session_key,
            &cwd,
            Some(&request.session_id),
            session_storage_path.as_deref(),
            &mut session,
        )
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
                    if let Some(session_storage_path) = session_storage_path.as_deref() {
                        self.session_persistence
                            .update_model_id(
                                session_storage_path,
                                &request.session_id,
                                &request.model_id,
                            )
                            .await?;
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
            if let Some(session_storage_path) = session_storage_path.as_deref() {
                self.session_persistence
                    .update_model_id(session_storage_path, &request.session_id, &request.model_id)
                    .await?;
            }
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
        session_storage_path: Option<PathBuf>,
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
            self.ensure_remote_session(
                &client,
                &session_key,
                &cwd,
                bitfun_session_id.as_deref(),
                session_storage_path.as_deref(),
                &mut session,
            )
            .await?;

            discard_pending_session_updates_if_needed(&mut session).await;
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
        session_storage_path: Option<PathBuf>,
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
            self.ensure_remote_session(
                &client,
                &session_key,
                &cwd,
                bitfun_session_id.as_deref(),
                session_storage_path.as_deref(),
                &mut session,
            )
            .await?;

            discard_pending_session_updates_if_needed(&mut session).await;
            let active = session
                .active
                .as_mut()
                .ok_or_else(|| BitFunError::service("ACP session was not initialized"))?;
            active.send_prompt(prompt).map_err(protocol_error)?;
            let mut round_tracker = AcpStreamRoundTracker::new();

            loop {
                match active.read_update().await.map_err(protocol_error)? {
                    SessionMessage::SessionMessage(dispatch) => {
                        for event in acp_dispatch_to_stream_events(dispatch).await? {
                            for event in round_tracker.apply(event) {
                                on_event(event)?;
                            }
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

    pub async fn cancel_bitfun_session(
        self: &Arc<Self>,
        bitfun_session_id: &str,
    ) -> BitFunResult<bool> {
        let session_key_prefix = format!("{}:", bitfun_session_id);
        for client in self.clients.iter().map(|entry| entry.value().clone()) {
            let handle = client
                .cancel_handles
                .iter()
                .find(|entry| entry.key().starts_with(&session_key_prefix))
                .map(|entry| entry.value().clone());

            if let Some(handle) = handle {
                handle
                    .connection
                    .send_notification(CancelNotification::new(handle.session_id.clone()))
                    .map_err(protocol_error)?;
                return Ok(true);
            }
        }

        Ok(false)
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
        bitfun_session_id: Option<&str>,
        session_storage_path: Option<&Path>,
        session: &mut AcpRemoteSession,
    ) -> BitFunResult<()> {
        if session.active.is_some() {
            return Ok(());
        }

        let cx = client.connection().await?;
        let persisted_remote_session_id =
            if let (Some(session_storage_path), Some(bitfun_session_id)) =
                (session_storage_path, bitfun_session_id)
            {
                self.session_persistence
                    .load_remote_session_id(session_storage_path, bitfun_session_id)
                    .await?
            } else {
                None
            };
        let capabilities = client.agent_capabilities.read().await.clone();
        let mut last_resume_error: Option<String> = None;

        for strategy in preferred_resume_strategies(
            capabilities.as_ref(),
            persisted_remote_session_id.as_deref(),
        ) {
            let response = match strategy {
                AcpRemoteSessionStrategy::Load => {
                    let Some(remote_session_id) = persisted_remote_session_id.as_deref() else {
                        continue;
                    };
                    match cx
                        .send_request(LoadSessionRequest::new(remote_session_id.to_string(), cwd))
                        .block_task()
                        .await
                        .map_err(protocol_error)
                    {
                        Ok(response) => new_session_response_from_load(remote_session_id, response),
                        Err(error) => {
                            warn!(
                                "Failed to load ACP remote session, falling back: client_id={}, remote_session_id={}, error={}",
                                client.id, remote_session_id, error
                            );
                            last_resume_error = Some(error.to_string());
                            continue;
                        }
                    }
                }
                AcpRemoteSessionStrategy::Resume => {
                    let Some(remote_session_id) = persisted_remote_session_id.as_deref() else {
                        continue;
                    };
                    match cx
                        .send_request(ResumeSessionRequest::new(
                            remote_session_id.to_string(),
                            cwd,
                        ))
                        .block_task()
                        .await
                        .map_err(protocol_error)
                    {
                        Ok(response) => {
                            new_session_response_from_resume(remote_session_id, response)
                        }
                        Err(error) => {
                            warn!(
                                "Failed to resume ACP remote session, falling back: client_id={}, remote_session_id={}, error={}",
                                client.id, remote_session_id, error
                            );
                            last_resume_error = Some(error.to_string());
                            continue;
                        }
                    }
                }
                AcpRemoteSessionStrategy::New => cx
                    .send_request(NewSessionRequest::new(cwd))
                    .block_task()
                    .await
                    .map_err(protocol_error)?,
            };

            self.attach_remote_session(
                client,
                session_key,
                bitfun_session_id,
                session_storage_path,
                session,
                response,
                strategy,
                last_resume_error.clone(),
            )
            .await?;
            return Ok(());
        }

        Err(BitFunError::service(
            "Failed to initialize ACP remote session".to_string(),
        ))
    }

    async fn attach_remote_session(
        &self,
        client: &Arc<AcpClientConnection>,
        session_key: &str,
        bitfun_session_id: Option<&str>,
        session_storage_path: Option<&Path>,
        session: &mut AcpRemoteSession,
        response: NewSessionResponse,
        strategy: AcpRemoteSessionStrategy,
        last_resume_error: Option<String>,
    ) -> BitFunResult<()> {
        let cx = client.connection().await?;
        let models = response.models.clone();
        let config_options = response.config_options.clone().unwrap_or_default();
        let active = cx
            .attach_session(response, Vec::new())
            .map_err(protocol_error)?;
        let remote_session_id = active.session_id().to_string();
        client.cancel_handles.insert(
            session_key.to_string(),
            AcpCancelHandle {
                session_id: remote_session_id.clone(),
                connection: active.connection(),
            },
        );
        self.session_permission_modes
            .insert(remote_session_id.clone(), client.config.permission_mode);
        if let (Some(session_storage_path), Some(bitfun_session_id)) =
            (session_storage_path, bitfun_session_id)
        {
            self.session_persistence
                .update_remote_session_state(
                    session_storage_path,
                    bitfun_session_id,
                    &remote_session_id,
                    strategy.as_str(),
                    last_resume_error,
                )
                .await?;
        }
        session.models = models;
        session.config_options = config_options;
        session.discard_pending_updates_before_next_prompt =
            matches!(strategy, AcpRemoteSessionStrategy::Load);
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
        self.pending_permissions.insert(
            permission_id.clone(),
            PendingPermission {
                sender: tx,
                options: request.options.clone(),
            },
        );

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
            agent_capabilities: RwLock::new(None),
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

struct AcpRequirementSpec<'a> {
    tool_command: &'a str,
    adapter: Option<AcpAdapterSpec<'a>>,
}

struct AcpAdapterSpec<'a> {
    package: &'a str,
    bin: &'a str,
}

fn acp_requirement_spec<'a>(
    client_id: &'a str,
    config: Option<&'a AcpClientConfig>,
) -> AcpRequirementSpec<'a> {
    match client_id {
        "claude-code" => AcpRequirementSpec {
            tool_command: "claude",
            adapter: Some(AcpAdapterSpec {
                package: "@zed-industries/claude-code-acp",
                bin: "claude-code-acp",
            }),
        },
        "codex" => AcpRequirementSpec {
            tool_command: "codex",
            adapter: Some(AcpAdapterSpec {
                package: "@zed-industries/codex-acp",
                bin: "codex-acp",
            }),
        },
        "opencode" => AcpRequirementSpec {
            tool_command: "opencode",
            adapter: None,
        },
        _ => AcpRequirementSpec {
            tool_command: config
                .map(|config| config.command.as_str())
                .unwrap_or(client_id),
            adapter: None,
        },
    }
}

async fn probe_executable(command: &str) -> AcpRequirementProbeItem {
    let path = find_executable(command);
    let mut item = AcpRequirementProbeItem {
        name: command.to_string(),
        installed: path.is_some(),
        version: None,
        path: path.as_ref().map(|path| path.to_string_lossy().to_string()),
        error: None,
    };

    if let Some(path) = path {
        match run_command_with_timeout(path.as_os_str(), ["--version"], REQUIREMENT_PROBE_TIMEOUT)
            .await
        {
            Ok(output) if output.status.success() => {
                item.version = parse_version_text(&output.stdout)
                    .or_else(|| parse_version_text(&output.stderr));
            }
            Ok(output) => {
                item.error = Some(command_error_summary(&output.stderr, &output.stdout));
            }
            Err(error) => {
                item.error = Some(error);
            }
        }
    }

    item
}

async fn probe_npm_adapter(package: &str, bin: &str) -> AcpRequirementProbeItem {
    let npm_path = find_executable("npm");
    let mut item = AcpRequirementProbeItem {
        name: package.to_string(),
        installed: false,
        version: None,
        path: None,
        error: None,
    };
    let Some(npm_path) = npm_path else {
        item.error = Some("npm is not available on PATH".to_string());
        return item;
    };

    let global_args = ["ls", "-g", "--json", "--depth=0", package];
    match run_command_with_timeout(npm_path.as_os_str(), global_args, REQUIREMENT_PROBE_TIMEOUT)
        .await
    {
        Ok(output) if output.status.success() => {
            if let Some(version) = npm_ls_package_version(&output.stdout, package) {
                item.installed = true;
                item.version = Some(version);
                item.path = Some("npm global".to_string());
                return item;
            }
        }
        Ok(output) => {
            item.error = Some(command_error_summary(&output.stderr, &output.stdout));
        }
        Err(error) => {
            item.error = Some(error);
        }
    }

    let offline_args = vec![
        "exec".to_string(),
        "--offline".to_string(),
        "--yes".to_string(),
        format!("--package={package}"),
        "--".to_string(),
        bin.to_string(),
        "--help".to_string(),
    ];
    match run_command_with_timeout(
        npm_path.as_os_str(),
        offline_args.iter().map(String::as_str),
        REQUIREMENT_PROBE_TIMEOUT,
    )
    .await
    {
        Ok(output) if output.status.success() => {
            item.installed = true;
            item.path = Some("npm offline cache".to_string());
            item.error = None;
        }
        Ok(output) => {
            item.error = Some(command_error_summary(&output.stderr, &output.stdout));
        }
        Err(error) => {
            item.error = Some(error);
        }
    }

    item
}

async fn predownload_npm_adapter(package: &str, bin: &str) -> BitFunResult<()> {
    let npm_path = find_executable("npm")
        .ok_or_else(|| BitFunError::service("npm is not available on PATH".to_string()))?;
    let args = vec![
        "exec".to_string(),
        "--yes".to_string(),
        format!("--package={package}"),
        "--".to_string(),
        bin.to_string(),
        "--help".to_string(),
    ];

    match run_command_with_timeout(
        npm_path.as_os_str(),
        args.iter().map(String::as_str),
        ADAPTER_DOWNLOAD_TIMEOUT,
    )
    .await
    {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(BitFunError::service(format!(
            "Failed to predownload ACP adapter '{}': {}",
            package,
            command_error_summary(&output.stderr, &output.stdout)
        ))),
        Err(error) => Err(BitFunError::service(format!(
            "Failed to predownload ACP adapter '{}': {}",
            package, error
        ))),
    }
}

async fn run_command_with_timeout<I, S>(
    program: &std::ffi::OsStr,
    args: I,
    timeout: Duration,
) -> Result<std::process::Output, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let mut command = Command::new(program);
    command.args(args);
    match tokio::time::timeout(timeout, command.output()).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(error)) => Err(error.to_string()),
        Err(_) => Err("Timed out while checking command".to_string()),
    }
}

fn npm_ls_package_version(stdout: &[u8], package: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(stdout).ok()?;
    value
        .get("dependencies")?
        .get(package)?
        .get("version")?
        .as_str()
        .map(ToString::to_string)
}

fn parse_version_text(output: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(output);
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToString::to_string)
}

fn command_error_summary(stderr: &[u8], stdout: &[u8]) -> String {
    let stderr = String::from_utf8_lossy(stderr).trim().to_string();
    if !stderr.is_empty() {
        return truncate_error(stderr);
    }
    let stdout = String::from_utf8_lossy(stdout).trim().to_string();
    if !stdout.is_empty() {
        return truncate_error(stdout);
    }
    "Command exited unsuccessfully".to_string()
}

fn truncate_error(value: String) -> String {
    const MAX_LEN: usize = 240;
    if value.chars().count() <= MAX_LEN {
        return value;
    }
    format!("{}...", value.chars().take(MAX_LEN).collect::<String>())
}

fn find_executable(command: &str) -> Option<PathBuf> {
    let command_path = PathBuf::from(command);
    if command_path.components().count() > 1 {
        return executable_file(&command_path).then_some(command_path);
    }

    let paths = env::var_os("PATH")?;
    for directory in env::split_paths(&paths) {
        for candidate in executable_candidates(&directory, command) {
            if executable_file(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

fn executable_candidates(directory: &Path, command: &str) -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let command_path = PathBuf::from(command);
        if command_path.extension().is_some() {
            return vec![directory.join(command)];
        }
        let extensions = env::var_os("PATHEXT").unwrap_or_else(|| OsString::from(".EXE;.BAT;.CMD"));
        extensions
            .to_string_lossy()
            .split(';')
            .filter(|extension| !extension.is_empty())
            .map(|extension| directory.join(format!("{command}{extension}")))
            .collect()
    }

    #[cfg(not(windows))]
    {
        vec![directory.join(command)]
    }
}

fn executable_file(path: &Path) -> bool {
    path.is_file()
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

fn new_session_response_from_load(
    remote_session_id: &str,
    response: LoadSessionResponse,
) -> NewSessionResponse {
    NewSessionResponse::new(remote_session_id.to_string())
        .modes(response.modes)
        .models(response.models)
        .config_options(response.config_options)
        .meta(response.meta)
}

fn new_session_response_from_resume(
    remote_session_id: &str,
    response: ResumeSessionResponse,
) -> NewSessionResponse {
    NewSessionResponse::new(remote_session_id.to_string())
        .modes(response.modes)
        .models(response.models)
        .config_options(response.config_options)
        .meta(response.meta)
}

async fn discard_pending_session_updates_if_needed(session: &mut AcpRemoteSession) {
    if !session.discard_pending_updates_before_next_prompt {
        return;
    }

    session.discard_pending_updates_before_next_prompt = false;
    let Some(active) = session.active.as_mut() else {
        return;
    };

    let started_at = Instant::now();
    let mut discarded_count = 0usize;
    while started_at.elapsed() < LOAD_REPLAY_DRAIN_MAX_DURATION {
        match tokio::time::timeout(LOAD_REPLAY_DRAIN_QUIET_WINDOW, active.read_update()).await {
            Ok(Ok(_)) => {
                discarded_count += 1;
            }
            Ok(Err(error)) => {
                warn!(
                    "Failed to discard ACP load replay update before prompt: error={}",
                    error
                );
                break;
            }
            Err(_) => break,
        }
    }

    if discarded_count > 0 {
        info!(
            "Discarded ACP load replay updates before prompt: count={}",
            discarded_count
        );
    }
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
        .map(|option| option.option_id.to_string())
        .unwrap_or_else(|| select_permission_option_id(&request.options, approve));
    RequestPermissionResponse::new(RequestPermissionOutcome::Selected(
        SelectedPermissionOutcome::new(option_id),
    ))
}

fn select_permission_option_id(options: &[PermissionOption], approve: bool) -> String {
    let preferred_kinds = if approve {
        [
            PermissionOptionKind::AllowOnce,
            PermissionOptionKind::AllowAlways,
        ]
    } else {
        [
            PermissionOptionKind::RejectOnce,
            PermissionOptionKind::RejectAlways,
        ]
    };

    options
        .iter()
        .find(|option| preferred_kinds.contains(&option.kind))
        .or_else(|| options.first())
        .map(|option| option.option_id.to_string())
        .unwrap_or_else(|| {
            if approve {
                "allow_once".to_string()
            } else {
                "reject_once".to_string()
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_actual_permission_option_id_for_approval() {
        let options = vec![
            PermissionOption::new("deny", "Deny", PermissionOptionKind::RejectOnce),
            PermissionOption::new("yes-once", "Allow", PermissionOptionKind::AllowOnce),
        ];

        assert_eq!(select_permission_option_id(&options, true), "yes-once");
    }

    #[test]
    fn selects_actual_permission_option_id_for_rejection() {
        let options = vec![
            PermissionOption::new("allow-always", "Allow", PermissionOptionKind::AllowAlways),
            PermissionOption::new("no-once", "Reject", PermissionOptionKind::RejectOnce),
        ];

        assert_eq!(select_permission_option_id(&options, false), "no-once");
    }
}
