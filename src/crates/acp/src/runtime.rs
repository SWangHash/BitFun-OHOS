use std::path::Path;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use agent_client_protocol::schema::{
    AgentCapabilities, CancelNotification, ContentBlock, ContentChunk, CurrentModeUpdate,
    Implementation, InitializeRequest, InitializeResponse, ListSessionsRequest,
    ListSessionsResponse, LoadSessionRequest, LoadSessionResponse, McpCapabilities,
    NewSessionRequest, NewSessionResponse, PromptCapabilities, PromptRequest, PromptResponse,
    ProtocolVersion, SessionCapabilities, SessionId, SessionInfo, SessionListCapabilities,
    SessionMode, SessionModeState, SessionNotification, SessionUpdate, SetSessionModeRequest,
    SetSessionModeResponse, StopReason,
};
use agent_client_protocol::{Client, ConnectionTo, Error, Result};
use async_trait::async_trait;
use bitfun_core::agentic::agents::get_agent_registry;
use bitfun_core::agentic::coordination::{DialogSubmissionPolicy, DialogTriggerSource};
use bitfun_core::agentic::core::SessionConfig;
use bitfun_core::agentic::system::AgenticSystem;
use bitfun_events::AgenticEvent as CoreEvent;
use chrono::{DateTime, Utc};
use dashmap::DashMap;

use crate::server::{AcpRuntime, AcpServer};

pub struct BitfunAcpRuntime {
    agentic_system: AgenticSystem,
    sessions: DashMap<String, AcpSessionState>,
    connections: DashMap<String, ConnectionTo<Client>>,
}

#[derive(Clone)]
struct AcpSessionState {
    acp_session_id: String,
    bitfun_session_id: String,
    cwd: String,
    mode_id: String,
}

impl BitfunAcpRuntime {
    pub fn new(agentic_system: AgenticSystem) -> Self {
        Self {
            agentic_system,
            sessions: DashMap::new(),
            connections: DashMap::new(),
        }
    }

    pub async fn serve_stdio(agentic_system: AgenticSystem) -> Result<()> {
        AcpServer::new(Arc::new(Self::new(agentic_system)))
            .serve_stdio()
            .await
    }

    fn internal_error(error: impl std::fmt::Display) -> Error {
        Error::internal_error().data(serde_json::json!(error.to_string()))
    }
}

#[async_trait]
impl AcpRuntime for BitfunAcpRuntime {
    async fn initialize(&self, _request: InitializeRequest) -> Result<InitializeResponse> {
        Ok(InitializeResponse::new(ProtocolVersion::V1)
            .agent_capabilities(
                AgentCapabilities::new()
                    .load_session(true)
                    .prompt_capabilities(PromptCapabilities::new())
                    .mcp_capabilities(McpCapabilities::new())
                    .session_capabilities(
                        SessionCapabilities::new().list(SessionListCapabilities::new()),
                    ),
            )
            .agent_info(
                Implementation::new("bitfun-acp", env!("CARGO_PKG_VERSION")).title("BitFun"),
            ))
    }

    async fn new_session(
        &self,
        request: NewSessionRequest,
        connection: ConnectionTo<Client>,
    ) -> Result<NewSessionResponse> {
        let cwd = request.cwd.to_string_lossy().to_string();
        let session = self
            .agentic_system
            .coordinator
            .create_session(
                format!(
                    "ACP Session - {}",
                    chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
                ),
                "agentic".to_string(),
                SessionConfig {
                    workspace_path: Some(cwd.clone()),
                    ..Default::default()
                },
            )
            .await
            .map_err(Self::internal_error)?;

        let acp_session = AcpSessionState {
            acp_session_id: session.session_id.clone(),
            bitfun_session_id: session.session_id.clone(),
            cwd,
            mode_id: session.agent_type.clone(),
        };
        self.sessions
            .insert(acp_session.acp_session_id.clone(), acp_session.clone());

        self.connections
            .insert(acp_session.acp_session_id.clone(), connection);

        let modes = build_session_modes(Some(session.agent_type.as_str())).await;
        Ok(NewSessionResponse::new(SessionId::new(acp_session.acp_session_id)).modes(modes))
    }

    async fn load_session(
        &self,
        request: LoadSessionRequest,
        connection: ConnectionTo<Client>,
    ) -> Result<LoadSessionResponse> {
        let cwd = request.cwd.to_string_lossy().to_string();
        let session_id = request.session_id.to_string();
        let session = self
            .agentic_system
            .coordinator
            .restore_session(Path::new(&cwd), &session_id)
            .await
            .map_err(Self::internal_error)?;

        let acp_session = AcpSessionState {
            acp_session_id: session.session_id.clone(),
            bitfun_session_id: session.session_id.clone(),
            cwd,
            mode_id: session.agent_type.clone(),
        };
        self.sessions
            .insert(acp_session.acp_session_id.clone(), acp_session.clone());
        self.connections
            .insert(acp_session.acp_session_id.clone(), connection);

        let modes = build_session_modes(Some(session.agent_type.as_str())).await;
        Ok(LoadSessionResponse::new().modes(modes))
    }

    async fn list_sessions(&self, request: ListSessionsRequest) -> Result<ListSessionsResponse> {
        let cwd = request
            .cwd
            .or_else(|| std::env::current_dir().ok())
            .ok_or_else(|| Error::invalid_params().data("cwd is required"))?;
        let cursor = request
            .cursor
            .as_deref()
            .and_then(|value| value.parse::<u128>().ok());

        let mut summaries = self
            .agentic_system
            .coordinator
            .list_sessions(&cwd)
            .await
            .map_err(Self::internal_error)?;
        summaries.sort_by(|a, b| b.last_activity_at.cmp(&a.last_activity_at));

        let limit = 100usize;
        let filtered = summaries
            .into_iter()
            .filter(|summary| {
                cursor
                    .map(|cursor| system_time_to_unix_ms(summary.last_activity_at) < cursor)
                    .unwrap_or(true)
            })
            .collect::<Vec<_>>();

        let sessions = filtered
            .iter()
            .take(limit)
            .map(|summary| {
                SessionInfo::new(
                    SessionId::new(summary.session_id.clone()),
                    Path::new(&cwd).to_path_buf(),
                )
                .title(summary.session_name.clone())
                .updated_at(system_time_to_rfc3339(summary.last_activity_at))
            })
            .collect::<Vec<_>>();

        let next_cursor = if filtered.len() > limit {
            filtered
                .get(limit - 1)
                .map(|summary| system_time_to_unix_ms(summary.last_activity_at).to_string())
        } else {
            None
        };

        Ok(ListSessionsResponse::new(sessions).next_cursor(next_cursor))
    }

    async fn prompt(&self, request: PromptRequest) -> Result<PromptResponse> {
        let session_id = request.session_id.to_string();
        let acp_session = self
            .sessions
            .get(&session_id)
            .ok_or_else(|| Error::resource_not_found(Some(session_id.clone())))?;
        let acp_session = acp_session.clone();
        let connection = self
            .connections
            .get(&session_id)
            .ok_or_else(|| Error::resource_not_found(Some(session_id.clone())))?
            .clone();

        let user_message = request
            .prompt
            .into_iter()
            .filter_map(|block| match block {
                ContentBlock::Text(text) => Some(text.text),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n");

        if user_message.trim().is_empty() {
            return Err(Error::invalid_params().data("empty prompt"));
        }

        self.agentic_system
            .coordinator
            .start_dialog_turn(
                acp_session.bitfun_session_id.clone(),
                user_message,
                None,
                None,
                acp_session.mode_id.clone(),
                Some(acp_session.cwd.clone()),
                DialogSubmissionPolicy::for_source(DialogTriggerSource::Cli),
            )
            .await
            .map_err(Self::internal_error)?;

        let stop_reason = wait_for_prompt_completion(
            &self.agentic_system,
            &connection,
            &acp_session.acp_session_id,
            &acp_session.bitfun_session_id,
        )
        .await?;

        Ok(PromptResponse::new(stop_reason))
    }

    async fn cancel(&self, notification: CancelNotification) -> Result<()> {
        let session_id = notification.session_id.to_string();
        let acp_session = self
            .sessions
            .get(&session_id)
            .ok_or_else(|| Error::resource_not_found(Some(session_id.clone())))?;
        let acp_session = acp_session.clone();

        self.agentic_system
            .coordinator
            .cancel_active_turn_for_session(
                &acp_session.bitfun_session_id,
                std::time::Duration::from_secs(5),
            )
            .await
            .map_err(Self::internal_error)?;

        Ok(())
    }

    async fn set_session_mode(
        &self,
        request: SetSessionModeRequest,
    ) -> Result<SetSessionModeResponse> {
        let session_id = request.session_id.to_string();
        let mode_id = request.mode_id.to_string();
        let acp_session = self
            .sessions
            .get(&session_id)
            .ok_or_else(|| Error::resource_not_found(Some(session_id.clone())))?;
        let bitfun_session_id = acp_session.bitfun_session_id.clone();
        drop(acp_session);

        validate_mode_id(&mode_id).await?;

        self.agentic_system
            .coordinator
            .update_session_agent_type(&bitfun_session_id, &mode_id)
            .await
            .map_err(Self::internal_error)?;

        if let Some(mut state) = self.sessions.get_mut(&session_id) {
            state.mode_id = mode_id.clone();
        }

        if let Some(connection) = self.connections.get(&session_id) {
            send_update(
                &connection,
                &session_id,
                SessionUpdate::CurrentModeUpdate(CurrentModeUpdate::new(mode_id)),
            )?;
        }

        Ok(SetSessionModeResponse::new())
    }
}

async fn build_session_modes(preferred_mode_id: Option<&str>) -> SessionModeState {
    let available_modes = get_agent_registry()
        .get_modes_info()
        .await
        .into_iter()
        .filter(|info| info.enabled)
        .map(|info| SessionMode::new(info.id, info.name).description(info.description))
        .collect::<Vec<_>>();

    let current_mode_id = preferred_mode_id
        .and_then(|preferred| {
            available_modes
                .iter()
                .find(|mode| mode.id.to_string() == preferred)
                .map(|mode| mode.id.clone())
        })
        .or_else(|| {
            available_modes
                .iter()
                .find(|mode| mode.id.to_string() == "agentic")
                .or_else(|| available_modes.first())
                .map(|mode| mode.id.clone())
        })
        .unwrap_or_else(|| "agentic".into());

    SessionModeState::new(current_mode_id, available_modes)
}

async fn validate_mode_id(mode_id: &str) -> Result<()> {
    let mode_exists = get_agent_registry()
        .get_modes_info()
        .await
        .into_iter()
        .any(|info| info.enabled && info.id == mode_id);

    if mode_exists {
        Ok(())
    } else {
        Err(Error::invalid_params().data(format!("unknown session mode: {}", mode_id)))
    }
}

async fn wait_for_prompt_completion(
    agentic_system: &AgenticSystem,
    connection: &ConnectionTo<Client>,
    acp_session_id: &str,
    bitfun_session_id: &str,
) -> Result<StopReason> {
    loop {
        let events = agentic_system.event_queue.dequeue_batch(10).await;
        if events.is_empty() {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            continue;
        }

        for envelope in events {
            let event = envelope.event;
            if event.session_id() != Some(bitfun_session_id) {
                continue;
            }

            match event {
                CoreEvent::TextChunk { text, .. } => {
                    send_update(
                        connection,
                        acp_session_id,
                        SessionUpdate::AgentMessageChunk(ContentChunk::new(text.into())),
                    )?;
                }
                CoreEvent::ThinkingChunk { content, .. } => {
                    send_update(
                        connection,
                        acp_session_id,
                        SessionUpdate::AgentThoughtChunk(ContentChunk::new(content.into())),
                    )?;
                }
                CoreEvent::DialogTurnCompleted { .. } => return Ok(StopReason::EndTurn),
                CoreEvent::DialogTurnCancelled { .. } => return Ok(StopReason::Cancelled),
                CoreEvent::DialogTurnFailed { error, .. }
                | CoreEvent::SystemError { error, .. } => {
                    send_update(
                        connection,
                        acp_session_id,
                        SessionUpdate::AgentMessageChunk(ContentChunk::new(
                            format!("Error: {}", error).into(),
                        )),
                    )?;
                    return Err(Error::internal_error().data(serde_json::json!(error)));
                }
                _ => {}
            }
        }
    }
}

fn send_update(
    connection: &ConnectionTo<Client>,
    session_id: &str,
    update: SessionUpdate,
) -> Result<()> {
    connection.send_notification(SessionNotification::new(
        SessionId::new(session_id.to_string()),
        update,
    ))
}

fn system_time_to_unix_ms(time: SystemTime) -> u128 {
    time.duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn system_time_to_rfc3339(time: SystemTime) -> String {
    DateTime::<Utc>::from(time).to_rfc3339()
}
