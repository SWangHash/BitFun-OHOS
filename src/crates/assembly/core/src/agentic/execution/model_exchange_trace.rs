use super::types::RoundContext;
use crate::agentic::WorkspaceBinding;
use crate::infrastructure::ai::AIClient;
use crate::service::config::{
    GlobalConfigManager, ModelExchangeTracingConfig, ModelExchangeTracingMode,
};
use crate::service::workspace_runtime::get_workspace_runtime_service_arc;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use log::{debug, warn};
use bitfun_ai_adapters::{
    ModelExchangeRequestAttempt, ModelExchangeRequestTraceHandle, ModelExchangeResponseTrace,
    ModelExchangeRoundAttempt, ModelExchangeTraceConfig, ModelExchangeTraceSink,
};
use bitfun_observability::{
    DebugContentField, DebugCorrelation, DebugInferenceRecord, DebugTelemetryRecord,
    ObservationContext, Telemetry,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use tokio::sync::Mutex;
use uuid::Uuid;

const TRACE_LAYOUT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ModelExchangeTraceRecord {
    version: u32,
    trace_id: String,
    sequence: u64,
    recorded_at: DateTime<Utc>,
    session_id: String,
    turn_id: String,
    operation_kind: String,
    operation_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    operation_trigger: Option<String>,
    capture_mode: ModelExchangeTracingMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    response: Option<ModelExchangeResponseTrace>,
    request: ModelExchangeTraceRequestRecord,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct ModelExchangeTraceOperation<'a> {
    pub kind: &'a str,
    pub id: &'a str,
    pub trigger: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ModelExchangeTraceRequestRecord {
    provider: String,
    api_format: String,
    model_id: String,
    request_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    body: Option<Value>,
    /// Adapter-local HTTP/SSE retry number. This restarts for each logical
    /// model-round attempt.
    attempt_number: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    round_attempt: Option<ModelExchangeRoundAttempt>,
}

#[derive(Debug, Clone, Copy)]
struct ModelExchangeTracePolicy {
    mode: ModelExchangeTracingMode,
    capture_request_body: bool,
    capture_response_text: bool,
    capture_reasoning: bool,
    capture_tool_calls: bool,
    capture_usage: bool,
    capture_provider_metadata: bool,
}

impl ModelExchangeTracePolicy {
    fn from_config(config: ModelExchangeTracingConfig) -> Option<Self> {
        match config.mode {
            ModelExchangeTracingMode::Off => None,
            ModelExchangeTracingMode::Full => Some(Self {
                mode: ModelExchangeTracingMode::Full,
                capture_request_body: true,
                capture_response_text: true,
                capture_reasoning: true,
                capture_tool_calls: true,
                capture_usage: true,
                capture_provider_metadata: true,
            }),
            ModelExchangeTracingMode::UsageOnly => Some(Self {
                mode: ModelExchangeTracingMode::UsageOnly,
                capture_request_body: false,
                capture_response_text: false,
                capture_reasoning: false,
                capture_tool_calls: false,
                capture_usage: true,
                capture_provider_metadata: false,
            }),
        }
    }
}

#[derive(Debug)]
struct WorkspaceModelExchangeTraceSink {
    trace_session_dir: Option<PathBuf>,
    policy: ModelExchangeTracePolicy,
    session_id: String,
    turn_id: String,
    operation_kind: String,
    operation_id: String,
    operation_trigger: Option<String>,
    provider: String,
    api_format: String,
    model_id: String,
    trace_paths: DashMap<String, PathBuf>,
    telemetry: Telemetry,
    observation_context: Option<ObservationContext>,
    local_enabled: bool,
}

// Reverse declaration order preserves the previous function-parameter drop
// order; struct literals remain in the original evaluation order.
struct WorkspaceModelExchangeTraceInput {
    model_id: String,
    api_format: String,
    provider: String,
    operation_trigger: Option<String>,
    operation_id: String,
    operation_kind: String,
    turn_id: String,
    session_id: String,
    policy: ModelExchangeTracePolicy,
    trace_session_dir: Option<PathBuf>,
    telemetry: Telemetry,
    observation_context: Option<ObservationContext>,
    local_enabled: bool,
}

#[derive(Default)]
struct DebugRequestParts {
    system_prompt: Option<String>,
    tool_definitions: Option<Value>,
    context: Option<Value>,
    reminders: Option<Value>,
}

fn debug_request_parts(request: Option<&Value>) -> DebugRequestParts {
    let Some(request) = request else {
        return DebugRequestParts::default();
    };
    let envelope = request
        .get("request")
        .filter(|nested| nested.is_object())
        .unwrap_or(request);
    let system_prompt = ["instructions", "system", "systemInstruction"]
        .into_iter()
        .find_map(|key| envelope.get(key))
        .map(debug_value_text);
    let tool_definitions = envelope.get("tools").cloned();
    let context = ["messages", "input", "contents"]
        .into_iter()
        .find_map(|key| envelope.get(key).cloned());
    let mut reminders = Vec::new();
    if let Some(context) = context.as_ref() {
        collect_system_reminders(context, &mut reminders);
    }
    DebugRequestParts {
        system_prompt,
        tool_definitions,
        context,
        reminders: (!reminders.is_empty()).then(|| Value::Array(reminders)),
    }
}

fn debug_value_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

fn collect_system_reminders(value: &Value, reminders: &mut Vec<Value>) {
    match value {
        Value::String(text) if text.contains("<system_reminder>") => {
            reminders.push(Value::String(text.clone()));
        }
        Value::Array(values) => {
            for value in values {
                collect_system_reminders(value, reminders);
            }
        }
        Value::Object(values) => {
            for value in values.values() {
                collect_system_reminders(value, reminders);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
    }
}

impl WorkspaceModelExchangeTraceSink {
    fn new(input: WorkspaceModelExchangeTraceInput) -> Self {
        Self {
            trace_session_dir: input.trace_session_dir,
            policy: input.policy,
            session_id: input.session_id,
            turn_id: input.turn_id,
            operation_kind: input.operation_kind,
            operation_id: input.operation_id,
            operation_trigger: input.operation_trigger,
            provider: input.provider,
            api_format: input.api_format,
            model_id: input.model_id,
            trace_paths: DashMap::new(),
            telemetry: input.telemetry,
            observation_context: input.observation_context,
            local_enabled: input.local_enabled,
        }
    }

    async fn allocate_sequence(&self) -> Result<u64, String> {
        let trace_session_dir = self
            .trace_session_dir
            .as_deref()
            .ok_or_else(|| "local model exchange trace is disabled".to_string())?;
        let key = trace_session_dir.to_string_lossy().to_string();
        let allocator = sequence_allocators()
            .entry(key)
            .or_insert_with(|| Arc::new(Mutex::new(None)))
            .clone();
        let mut guard = allocator.lock().await;
        let current = match *guard {
            Some(value) => value,
            None => {
                let detected = detect_last_sequence(trace_session_dir).await?;
                *guard = Some(detected);
                detected
            }
        };
        let next = current.saturating_add(1);
        *guard = Some(next);
        Ok(next)
    }

    fn trace_path(&self, sequence: u64) -> PathBuf {
        self.trace_session_dir
            .as_deref()
            .expect("trace path is used only when local tracing is enabled")
            .join(format!("request-{:06}.json", sequence))
    }

    async fn write_record(
        &self,
        path: &Path,
        record: &ModelExchangeTraceRecord,
    ) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|error| format!("Failed to create trace directory: {}", error))?;
        }

        let bytes = serde_json::to_vec_pretty(record)
            .map_err(|error| format!("Failed to serialize trace record: {}", error))?;
        tokio::fs::write(path, bytes)
            .await
            .map_err(|error| format!("Failed to write trace record: {}", error))
    }

    async fn read_record(&self, path: &Path) -> Result<ModelExchangeTraceRecord, String> {
        let bytes = tokio::fs::read(path)
            .await
            .map_err(|error| format!("Failed to read trace record: {}", error))?;
        serde_json::from_slice(&bytes)
            .map_err(|error| format!("Failed to deserialize trace record: {}", error))
    }

    async fn update_response(
        &self,
        trace_id: &str,
        response: &ModelExchangeResponseTrace,
    ) -> Result<(), String> {
        let Some(path) = self
            .trace_paths
            .get(trace_id)
            .map(|entry| entry.value().clone())
        else {
            return Ok(());
        };

        let mut record = self.read_record(&path).await?;
        record.response = Some(self.sanitize_response(response));
        self.write_record(&path, &record).await?;
        self.trace_paths.remove(trace_id);
        Ok(())
    }

    fn sanitize_response(
        &self,
        response: &ModelExchangeResponseTrace,
    ) -> ModelExchangeResponseTrace {
        ModelExchangeResponseTrace {
            kind: response.kind.clone(),
            assistant_text: self
                .policy
                .capture_response_text
                .then(|| response.assistant_text.clone())
                .flatten(),
            thinking: self
                .policy
                .capture_reasoning
                .then(|| response.thinking.clone())
                .flatten(),
            tool_calls: self
                .policy
                .capture_tool_calls
                .then(|| response.tool_calls.clone())
                .flatten(),
            usage: self
                .policy
                .capture_usage
                .then(|| response.usage.clone())
                .flatten(),
            provider_metadata: self
                .policy
                .capture_provider_metadata
                .then(|| response.provider_metadata.clone())
                .flatten(),
            finish_reason: response.finish_reason.clone(),
            ttft_ms: response.ttft_ms,
            partial_recovery_reason: response.partial_recovery_reason.clone(),
            error: response.error.clone(),
        }
    }
}

#[async_trait]
impl ModelExchangeTraceSink for WorkspaceModelExchangeTraceSink {
    async fn request_attempt_started(
        &self,
        attempt: &ModelExchangeRequestAttempt,
    ) -> Option<ModelExchangeRequestTraceHandle> {
        let correlation_id = attempt
            .round_attempt
            .as_ref()
            .map(|round_attempt| {
                format!(
                    "{}:transport:{}",
                    round_attempt.attempt_id, attempt.attempt_number
                )
            })
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        self.telemetry.record_debug_lazy(
            || {
                let request_parts = debug_request_parts(attempt.request_body.as_ref());
                DebugTelemetryRecord::InferenceRequest(DebugInferenceRecord {
                    correlation: DebugCorrelation {
                        session_id: Some(self.session_id.clone()),
                        turn_id: Some(self.turn_id.clone()),
                        round_id: (self.operation_kind == "model_round")
                            .then(|| self.operation_id.clone()),
                        inference_id: Some(correlation_id.clone()),
                        ..Default::default()
                    },
                    provider: Some(self.provider.clone()),
                    model: Some(self.model_id.clone()),
                    request_url: Some(attempt.request_url.clone()),
                    request: attempt.request_body.clone().map(DebugContentField::value),
                    response: None,
                    system_prompt: request_parts.system_prompt.map(DebugContentField::text),
                    tool_definitions: request_parts.tool_definitions.map(DebugContentField::value),
                    context: request_parts.context.map(DebugContentField::value),
                    reminders: request_parts.reminders.map(DebugContentField::value),
                    answer: None,
                    reasoning: None,
                    provider_metadata: None,
                    error: None,
                })
            },
            self.observation_context.clone(),
        );
        let trace_id = Uuid::new_v4().to_string();
        let trace_handle = || ModelExchangeRequestTraceHandle {
            trace_id: trace_id.clone(),
            correlation_id: Some(correlation_id.clone()),
            attempt_number: Some(attempt.attempt_number),
        };
        if !self.local_enabled {
            return Some(trace_handle());
        }
        let sequence = match self.allocate_sequence().await {
            Ok(value) => value,
            Err(error) => {
                warn!(
                    "Model exchange trace sequence allocation failed: session_id={}, error={}",
                    self.session_id, error
                );
                // The lifecycle handle also correlates Debug telemetry. A local
                // diagnostics failure must not suppress the terminal record.
                return Some(trace_handle());
            }
        };

        let path = self.trace_path(sequence);
        let record = ModelExchangeTraceRecord {
            version: TRACE_LAYOUT_VERSION,
            trace_id: trace_id.clone(),
            sequence,
            recorded_at: Utc::now(),
            session_id: self.session_id.clone(),
            turn_id: self.turn_id.clone(),
            operation_kind: self.operation_kind.clone(),
            operation_id: self.operation_id.clone(),
            operation_trigger: self.operation_trigger.clone(),
            capture_mode: self.policy.mode,
            response: None,
            request: ModelExchangeTraceRequestRecord {
                provider: self.provider.clone(),
                api_format: self.api_format.clone(),
                model_id: self.model_id.clone(),
                request_url: attempt.request_url.clone(),
                body: attempt.request_body.clone(),
                attempt_number: attempt.attempt_number,
                round_attempt: attempt.round_attempt.clone(),
            },
        };

        if let Err(error) = self.write_record(&path, &record).await {
            warn!(
                "Model exchange trace write failed: session_id={}, trace_id={}, error={}",
                self.session_id, trace_id, error
            );
            return Some(trace_handle());
        }

        self.trace_paths.insert(trace_id.clone(), path);
        Some(trace_handle())
    }

    async fn request_attempt_failed(
        &self,
        handle: Option<&ModelExchangeRequestTraceHandle>,
        error: &str,
    ) {
        self.telemetry.record_debug_lazy(
            || {
                DebugTelemetryRecord::InferenceAttempt(DebugInferenceRecord {
                    correlation: DebugCorrelation {
                        session_id: Some(self.session_id.clone()),
                        turn_id: Some(self.turn_id.clone()),
                        round_id: (self.operation_kind == "model_round")
                            .then(|| self.operation_id.clone()),
                        inference_id: handle.and_then(|handle| handle.correlation_id.clone()),
                        ..Default::default()
                    },
                    provider: Some(self.provider.clone()),
                    model: Some(self.model_id.clone()),
                    request_url: None,
                    request: None,
                    response: None,
                    system_prompt: None,
                    tool_definitions: None,
                    context: None,
                    reminders: None,
                    answer: None,
                    reasoning: None,
                    provider_metadata: None,
                    error: Some(DebugContentField::text(error)),
                })
            },
            self.observation_context.clone(),
        );
        let Some(handle) = handle else {
            return;
        };

        if let Err(write_error) = self
            .update_response(
                &handle.trace_id,
                &ModelExchangeResponseTrace {
                    kind: "error".to_string(),
                    assistant_text: None,
                    thinking: None,
                    tool_calls: None,
                    usage: None,
                    provider_metadata: None,
                    finish_reason: Some("error".to_string()),
                    ttft_ms: None,
                    partial_recovery_reason: None,
                    error: Some(error.to_string()),
                },
            )
            .await
        {
            warn!(
                "Model exchange trace failure update failed: session_id={}, trace_id={}, error={}",
                self.session_id, handle.trace_id, write_error
            );
        }
    }

    async fn request_attempt_completed(
        &self,
        handle: &ModelExchangeRequestTraceHandle,
        response: &ModelExchangeResponseTrace,
    ) {
        self.telemetry.record_debug_lazy(
            || {
                DebugTelemetryRecord::InferenceResponse(DebugInferenceRecord {
                    correlation: DebugCorrelation {
                        session_id: Some(self.session_id.clone()),
                        turn_id: Some(self.turn_id.clone()),
                        round_id: (self.operation_kind == "model_round")
                            .then(|| self.operation_id.clone()),
                        inference_id: handle.correlation_id.clone(),
                        ..Default::default()
                    },
                    provider: Some(self.provider.clone()),
                    model: Some(self.model_id.clone()),
                    request_url: None,
                    request: None,
                    response: serde_json::to_value(response)
                        .ok()
                        .map(DebugContentField::value),
                    system_prompt: None,
                    tool_definitions: None,
                    context: None,
                    reminders: None,
                    answer: response.assistant_text.clone().map(DebugContentField::text),
                    reasoning: response.thinking.clone().map(DebugContentField::text),
                    provider_metadata: response
                        .provider_metadata
                        .clone()
                        .map(DebugContentField::value),
                    error: response.error.clone().map(DebugContentField::text),
                })
            },
            self.observation_context.clone(),
        );
        if let Err(error) = self.update_response(&handle.trace_id, response).await {
            warn!(
                "Model exchange trace completion update failed: session_id={}, trace_id={}, error={}",
                self.session_id, handle.trace_id, error
            );
        }
    }
}

pub(super) async fn prepare_model_exchange_trace(
    context: &RoundContext,
    round_id: &str,
    ai_client: &AIClient,
    telemetry: &Telemetry,
) -> Option<ModelExchangeTraceConfig> {
    prepare_model_exchange_trace_for_workspace(
        &context.session_id,
        &context.dialog_turn_id,
        context.workspace.as_ref(),
        context.model_exchange_trace_dir.as_deref(),
        ModelExchangeTraceOperation {
            kind: "model_round",
            id: round_id,
            trigger: None,
        },
        ai_client,
        telemetry,
        context.observation_context.clone(),
    )
    .await
}

pub(super) async fn prepare_model_exchange_trace_for_workspace(
    session_id: &str,
    turn_id: &str,
    workspace: Option<&WorkspaceBinding>,
    model_exchange_trace_dir: Option<&Path>,
    operation: ModelExchangeTraceOperation<'_>,
    ai_client: &AIClient,
    telemetry: &Telemetry,
    observation_context: Option<ObservationContext>,
) -> Option<ModelExchangeTraceConfig> {
    let local_policy = current_model_exchange_trace_policy().await;
    let debug_enabled =
        telemetry.policy_snapshot().level() == bitfun_observability::TelemetryLevel::Debug;
    if local_policy.is_none() && !debug_enabled {
        return None;
    }
    let policy = local_policy.unwrap_or(ModelExchangeTracePolicy {
        mode: ModelExchangeTracingMode::Off,
        capture_request_body: false,
        capture_response_text: false,
        capture_reasoning: false,
        capture_tool_calls: false,
        capture_usage: false,
        capture_provider_metadata: false,
    });

    let trace_session_dir = if local_policy.is_some() {
        match workspace {
            Some(workspace) => Some(match model_exchange_trace_dir {
                Some(path) => path.to_path_buf(),
                None => match get_workspace_runtime_service_arc()
                    .ensure_runtime_for_workspace_binding(workspace)
                    .await
                {
                    Ok(result) => result.context.request_trace_session_dir(session_id),
                    Err(error) => {
                        warn!(
                            "Local model exchange trace skipped because runtime init failed: session_id={}, operation_kind={}, operation_id={}, error={}",
                            session_id, operation.kind, operation.id, error
                        );
                        if !debug_enabled {
                            return None;
                        }
                        PathBuf::new()
                    }
                },
            })
            .filter(|path| !path.as_os_str().is_empty()),
            None => {
                debug!(
                    "Local model exchange trace skipped because operation has no workspace: session_id={}, turn_id={}, operation_kind={}, operation_id={}",
                    session_id, turn_id, operation.kind, operation.id
                );
                if !debug_enabled {
                    return None;
                }
                None
            }
        }
    } else {
        None
    };

    let local_enabled = local_policy.is_some() && trace_session_dir.is_some();
    Some(ModelExchangeTraceConfig::new(
        Arc::new(WorkspaceModelExchangeTraceSink::new(
            WorkspaceModelExchangeTraceInput {
                trace_session_dir,
                policy,
                session_id: session_id.to_string(),
                turn_id: turn_id.to_string(),
                operation_kind: operation.kind.to_string(),
                operation_id: operation.id.to_string(),
                operation_trigger: operation.trigger.map(str::to_string),
                provider: ai_client.config.format.clone(),
                api_format: ai_client.config.format.clone(),
                model_id: ai_client.config.model.clone(),
                telemetry: telemetry.clone(),
                observation_context,
                local_enabled,
            },
        )),
        policy.capture_request_body || debug_enabled,
    ))
}

async fn current_model_exchange_trace_policy() -> Option<ModelExchangeTracePolicy> {
    let Ok(config_service) = GlobalConfigManager::get_service().await else {
        return None;
    };

    let tracing_config: ModelExchangeTracingConfig = config_service
        .get_config(Some("app.logging.model_exchange_tracing"))
        .await
        .unwrap_or_default();
    ModelExchangeTracePolicy::from_config(tracing_config)
}

async fn detect_last_sequence(session_dir: &Path) -> Result<u64, String> {
    let mut last_sequence = 0u64;
    let mut entries = match tokio::fs::read_dir(session_dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => {
            return Err(format!(
                "Failed to inspect trace session directory '{}': {}",
                session_dir.display(),
                error
            ));
        }
    };

    loop {
        let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|error| format!("Failed to iterate trace session directory: {}", error))?
        else {
            break;
        };

        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        let Some(sequence) = parse_trace_sequence(file_name) else {
            continue;
        };
        last_sequence = last_sequence.max(sequence);
    }

    Ok(last_sequence)
}

fn parse_trace_sequence(file_name: &str) -> Option<u64> {
    file_name
        .strip_prefix("request-")?
        .strip_suffix(".json")?
        .parse::<u64>()
        .ok()
}

fn sequence_allocators() -> &'static DashMap<String, Arc<Mutex<Option<u64>>>> {
    static ALLOCATORS: OnceLock<DashMap<String, Arc<Mutex<Option<u64>>>>> = OnceLock::new();
    ALLOCATORS.get_or_init(DashMap::new)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitfun_observability::{InMemorySink, PolicySnapshot, TelemetryLevel};

    struct SequenceAllocatorCleanup(String);

    impl Drop for SequenceAllocatorCleanup {
        fn drop(&mut self) {
            sequence_allocators().remove(&self.0);
        }
    }

    #[tokio::test]
    async fn trace_request_preserves_operation_and_model_identity() {
        let directory = tempfile::tempdir().expect("trace directory should be created");
        let _allocator_cleanup =
            SequenceAllocatorCleanup(directory.path().to_string_lossy().to_string());
        let sink = WorkspaceModelExchangeTraceSink::new(WorkspaceModelExchangeTraceInput {
            trace_session_dir: Some(directory.path().to_path_buf()),
            policy: ModelExchangeTracePolicy {
                mode: ModelExchangeTracingMode::Full,
                capture_request_body: true,
                capture_response_text: true,
                capture_reasoning: true,
                capture_tool_calls: true,
                capture_usage: true,
                capture_provider_metadata: true,
            },
            session_id: "session-identity".to_string(),
            turn_id: "turn-identity".to_string(),
            operation_kind: "context_compression".to_string(),
            operation_id: "compression-identity".to_string(),
            operation_trigger: Some("manual".to_string()),
            provider: "provider-format".to_string(),
            api_format: "api-format".to_string(),
            model_id: "model-identity".to_string(),
            telemetry: Telemetry::noop(),
            observation_context: None,
            local_enabled: true,
        });

        let handle = sink
            .request_attempt_started(&ModelExchangeRequestAttempt {
                request_url: "https://example.invalid/model".to_string(),
                request_body: Some(serde_json::json!({"request": "body"})),
                attempt_number: 2,
                round_attempt: Some(ModelExchangeRoundAttempt {
                    attempt_id: "round-1:attempt:3".to_string(),
                    attempt_index: 3,
                }),
            })
            .await
            .expect("trace request should be recorded");
        let path = sink
            .trace_paths
            .get(&handle.trace_id)
            .expect("trace path should be registered")
            .value()
            .clone();
        let record = sink
            .read_record(&path)
            .await
            .expect("trace record should be readable");

        assert_eq!(record.session_id, "session-identity");
        assert_eq!(record.turn_id, "turn-identity");
        assert_eq!(record.operation_kind, "context_compression");
        assert_eq!(record.operation_id, "compression-identity");
        assert_eq!(record.operation_trigger.as_deref(), Some("manual"));
        assert_eq!(record.request.provider, "provider-format");
        assert_eq!(record.request.api_format, "api-format");
        assert_eq!(record.request.model_id, "model-identity");
        assert_eq!(record.request.attempt_number, 2);
        assert_eq!(
            record.request.round_attempt,
            Some(ModelExchangeRoundAttempt {
                attempt_id: "round-1:attempt:3".to_string(),
                attempt_index: 3,
            })
        );
        assert_eq!(
            record.request.body,
            Some(serde_json::json!({"request": "body"}))
        );
    }

    #[tokio::test]
    async fn debug_model_exchange_emits_one_correlated_request_and_response() {
        let memory = Arc::new(InMemorySink::default());
        let telemetry =
            Telemetry::build(PolicySnapshot::new(TelemetryLevel::Debug), memory.clone()).0;
        let sink = WorkspaceModelExchangeTraceSink::new(WorkspaceModelExchangeTraceInput {
            trace_session_dir: None,
            policy: ModelExchangeTracePolicy {
                mode: ModelExchangeTracingMode::Off,
                capture_request_body: false,
                capture_response_text: false,
                capture_reasoning: false,
                capture_tool_calls: false,
                capture_usage: false,
                capture_provider_metadata: false,
            },
            session_id: "session-debug".to_string(),
            turn_id: "turn-debug".to_string(),
            operation_kind: "model_round".to_string(),
            operation_id: "round-debug".to_string(),
            operation_trigger: None,
            provider: "provider-debug".to_string(),
            api_format: "api-debug".to_string(),
            model_id: "model-debug".to_string(),
            telemetry,
            observation_context: None,
            local_enabled: false,
        });

        let handle = sink
            .request_attempt_started(&ModelExchangeRequestAttempt {
                request_url: "https://example.invalid/model".to_string(),
                request_body: Some(serde_json::json!({
                    "instructions": "system prompt",
                    "messages": [{
                        "role": "user",
                        "content": "<system_reminder>remember this</system_reminder>\nhello"
                    }],
                    "tools": [{"name": "Read"}]
                })),
                attempt_number: 2,
                round_attempt: Some(ModelExchangeRoundAttempt {
                    attempt_id: "round-debug:attempt:4".to_string(),
                    attempt_index: 4,
                }),
            })
            .await
            .expect("Debug telemetry should retain a lifecycle handle");
        sink.request_attempt_completed(
            &handle,
            &ModelExchangeResponseTrace {
                kind: "message".to_string(),
                assistant_text: Some("answer".to_string()),
                thinking: Some("reasoning".to_string()),
                tool_calls: None,
                usage: Some(serde_json::json!({"input_tokens": 3, "output_tokens": 5})),
                provider_metadata: None,
                finish_reason: Some("stop".to_string()),
                ttft_ms: Some(12),
                partial_recovery_reason: None,
                error: None,
            },
        )
        .await;

        let records = memory.debug_records();
        assert_eq!(
            records
                .iter()
                .filter(|record| record.event_name() == "bitfun.inference.request")
                .count(),
            2
        );
        assert_eq!(
            records
                .iter()
                .filter(|record| record
                    .body()
                    .contains("\"record_type\":\"inference_request\""))
                .count(),
            1
        );
        assert_eq!(
            records
                .iter()
                .filter(|record| record
                    .body()
                    .contains("\"record_type\":\"inference_response\""))
                .count(),
            1
        );
        let correlation_id = handle
            .correlation_id
            .as_deref()
            .expect("correlation id should be assigned");
        assert!(records
            .iter()
            .all(|record| record.body().contains(correlation_id)));
        let request = records
            .iter()
            .find(|record| {
                record.event_name() == "bitfun.inference.request"
                    && record
                        .body()
                        .contains("\"record_type\":\"inference_request\"")
            })
            .expect("request record");
        assert!(request.body().contains("system prompt"));
        assert!(request.body().contains("remember this"));
        assert!(request.body().contains("Read"));
    }
}
