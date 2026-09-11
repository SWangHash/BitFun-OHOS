use crate::{ObservationContext, Severity, SpanContext};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

pub const DEBUG_INSTRUMENTATION_SCOPE_NAME: &str = "bitfun.observability.debug";
pub const DEBUG_TELEMETRY_SCHEMA_VERSION: u16 = 1;
pub const DEBUG_RECORD_MAX_BYTES: usize = 256 * 1024;
pub const DEBUG_QUEUE_MAX_RECORDS: usize = 256;
pub const DEBUG_QUEUE_MAX_BYTES: usize = 8 * 1024 * 1024;
pub const DEBUG_BATCH_MAX_BYTES: usize = 1024 * 1024;
const DEBUG_CONTENT_BUDGET_BYTES: usize = 240 * 1024;
const REDACTED: &str = "[REDACTED]";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DebugContentField {
    pub value: Value,
    pub original_size_bytes: u64,
    pub truncated: bool,
}

impl DebugContentField {
    pub fn value(value: Value) -> Self {
        let original_size_bytes = serde_json::to_vec(&value)
            .map(|serialized| serialized.len().min(u64::MAX as usize) as u64)
            .unwrap_or(0);
        Self {
            value,
            original_size_bytes,
            truncated: false,
        }
    }

    pub fn text(value: impl Into<String>) -> Self {
        Self::value(Value::String(value.into()))
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct DebugCorrelation {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub round_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inference_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_tool_call_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DebugTurnRecord {
    pub correlation: DebugCorrelation,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<DebugContentField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_file_paths: Option<DebugContentField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_file_paths_original_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_commit: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DebugInferenceRecord {
    pub correlation: DebugCorrelation,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request: Option<DebugContentField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response: Option<DebugContentField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<DebugContentField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_definitions: Option<DebugContentField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<DebugContentField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reminders: Option<DebugContentField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answer: Option<DebugContentField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<DebugContentField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_metadata: Option<DebugContentField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<DebugContentField>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DebugToolRecord {
    pub correlation: DebugCorrelation,
    pub part_index: u64,
    pub tool_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wire_tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<DebugContentField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_arguments: Option<DebugContentField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<DebugContentField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<DebugContentField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parse_error: Option<DebugContentField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<DebugContentField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_server: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DebugApprovalPhase {
    Evaluation,
    Confirmation,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DebugApprovalRecord {
    pub correlation: DebugCorrelation,
    pub phase: DebugApprovalPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feedback: Option<DebugContentField>,
}

/// Closed set of content-bearing telemetry events. There is intentionally no
/// generic event-name/body constructor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "record_type", content = "record", rename_all = "snake_case")]
pub enum DebugTelemetryRecord {
    TurnInput(DebugTurnRecord),
    TurnResult(DebugTurnRecord),
    InferenceRequest(DebugInferenceRecord),
    InferenceResponse(DebugInferenceRecord),
    InferenceAttempt(DebugInferenceRecord),
    ToolRequest(DebugToolRecord),
    ToolResult(DebugToolRecord),
    ToolFailure(DebugToolRecord),
    ApprovalDecision(DebugApprovalRecord),
}

impl DebugTelemetryRecord {
    pub fn event_name(&self) -> &'static str {
        match self {
            Self::TurnInput(_) | Self::TurnResult(_) => "bitfun.agent.turn",
            Self::InferenceRequest(_) | Self::InferenceResponse(_) => "bitfun.inference.request",
            Self::InferenceAttempt(_) => "bitfun.inference.attempt",
            Self::ToolRequest(_) | Self::ToolResult(_) | Self::ToolFailure(_) => {
                "bitfun.tool.execute"
            }
            Self::ApprovalDecision(record) => match record.phase {
                DebugApprovalPhase::Evaluation => "bitfun.permission.evaluate",
                DebugApprovalPhase::Confirmation => "bitfun.permission.confirmation",
            },
        }
    }

    pub fn severity(&self) -> Severity {
        match self {
            Self::InferenceAttempt(_) | Self::ToolFailure(_) => Severity::Warn,
            _ => Severity::Info,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DebugLogRecord {
    event_name: &'static str,
    timestamp_unix_nanos: u128,
    observed_unix_nanos: u128,
    severity: Severity,
    body: String,
    span_context: Option<SpanContext>,
    original_size_bytes: u64,
    truncated: bool,
}

impl DebugLogRecord {
    pub fn event_name(&self) -> &'static str {
        self.event_name
    }
    pub fn timestamp_unix_nanos(&self) -> u128 {
        self.timestamp_unix_nanos
    }
    pub fn observed_unix_nanos(&self) -> u128 {
        self.observed_unix_nanos
    }
    pub fn severity(&self) -> Severity {
        self.severity
    }
    pub fn body(&self) -> &str {
        &self.body
    }
    pub fn span_context(&self) -> Option<SpanContext> {
        self.span_context
    }
    pub fn original_size_bytes(&self) -> u64 {
        self.original_size_bytes
    }
    pub fn truncated(&self) -> bool {
        self.truncated
    }
    pub fn estimated_bytes(&self) -> usize {
        256usize.saturating_add(self.body.len())
    }
}

pub(crate) fn prepare_debug_record(
    record: DebugTelemetryRecord,
    context: Option<ObservationContext>,
) -> DebugLogRecord {
    let event_name = record.event_name();
    let severity = record.severity();
    let mut value = serde_json::to_value(record).unwrap_or(Value::Null);
    redact_value(None, &mut value);
    let mut remaining_content_bytes = DEBUG_CONTENT_BUDGET_BYTES;
    apply_content_budget(&mut value, &mut remaining_content_bytes);
    let serialized = serde_json::to_string(&value).unwrap_or_else(|_| "null".to_string());
    let original_size_bytes = serialized.len().min(u64::MAX as usize) as u64;
    let (body, truncated) = truncate_head_tail(&serialized, DEBUG_RECORD_MAX_BYTES);
    let now = unix_nanos();
    DebugLogRecord {
        event_name,
        timestamp_unix_nanos: now,
        observed_unix_nanos: now,
        severity,
        body,
        span_context: context.map(|context| context.span_context()),
        original_size_bytes,
        truncated,
    }
}

fn apply_content_budget(value: &mut Value, remaining: &mut usize) {
    match value {
        Value::Object(map)
            if map.contains_key("value")
                && map.contains_key("original_size_bytes")
                && map.contains_key("truncated") =>
        {
            let Some(content) = map.get_mut("value") else {
                return;
            };
            let serialized = match &*content {
                Value::String(text) => text.clone(),
                value => serde_json::to_string(value).unwrap_or_else(|_| "null".to_string()),
            };
            if serialized.len() <= *remaining {
                *remaining = remaining.saturating_sub(serialized.len());
            } else {
                let (truncated, _) = truncate_head_tail(&serialized, *remaining);
                *content = Value::String(truncated);
                map.insert("truncated".to_string(), Value::Bool(true));
                *remaining = 0;
            }
        }
        Value::Object(map) => {
            let mut keys = map.keys().cloned().collect::<Vec<_>>();
            keys.sort();
            for key in keys {
                if let Some(value) = map.get_mut(&key) {
                    apply_content_budget(value, remaining);
                }
            }
        }
        Value::Array(values) => {
            for value in values {
                apply_content_budget(value, remaining);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
    }
}

fn redact_value(key: Option<&str>, value: &mut Value) {
    if key.is_some_and(is_secret_key) {
        *value = Value::String(REDACTED.to_string());
        return;
    }
    match value {
        Value::Object(map) => redact_map(map),
        Value::Array(values) => {
            for value in values {
                redact_value(None, value);
            }
        }
        Value::String(text) => *text = redact_text(text),
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}

fn redact_map(map: &mut Map<String, Value>) {
    for (key, value) in map {
        redact_value(Some(key), value);
    }
}

fn is_secret_key(key: &str) -> bool {
    let normalized = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    matches!(
        normalized.as_str(),
        "authorization"
            | "proxyauthorization"
            | "cookie"
            | "setcookie"
            | "password"
            | "passwd"
            | "secret"
            | "clientsecret"
            | "apikey"
            | "accesstoken"
            | "refreshtoken"
            | "idtoken"
            | "token"
            | "authtoken"
            | "bearertoken"
            | "privatekey"
    ) || normalized.ends_with("apikey")
        || normalized.ends_with("accesstoken")
        || normalized.ends_with("refreshtoken")
        || normalized.ends_with("token")
        || normalized.ends_with("password")
        || normalized.ends_with("secret")
}

fn redact_text(text: &str) -> String {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| {
        [
            r"(?im)\b(authorization|proxy-authorization|cookie|set-cookie)(\s*[:=]\s*)[^\r\n]*",
            r#"(?i)\b(password|passwd|api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?secret|token)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)"#,
            r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+",
            r"(?s)-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----",
            r"(?i)([a-z][a-z0-9+.-]*://)[^/@\s]+:[^/@\s]+@",
        ]
        .into_iter()
        .map(|pattern| Regex::new(pattern).expect("debug redaction regex is valid"))
        .collect()
    });
    let mut output = patterns[0].replace_all(text, "$1$2[REDACTED]").into_owned();
    output = patterns[2]
        .replace_all(&output, "$1 [REDACTED]")
        .into_owned();
    output = patterns[1]
        .replace_all(&output, "$1$2[REDACTED]")
        .into_owned();
    output = patterns[3].replace_all(&output, REDACTED).into_owned();
    patterns[4]
        .replace_all(&output, "$1[REDACTED]@")
        .into_owned()
}

fn truncate_head_tail(value: &str, max_bytes: usize) -> (String, bool) {
    if value.len() <= max_bytes {
        return (value.to_string(), false);
    }
    const MARKER: &str = "\n...[TRUNCATED]...\n";
    if max_bytes <= MARKER.len() {
        return (
            value[..floor_char_boundary(value, max_bytes)].to_string(),
            true,
        );
    }
    let available = max_bytes.saturating_sub(MARKER.len());
    let head_end = floor_char_boundary(value, available / 2);
    let tail_start =
        ceil_char_boundary(value, value.len().saturating_sub(available - available / 2));
    (
        format!("{}{}{}", &value[..head_end], MARKER, &value[tail_start..]),
        true,
    )
}

fn floor_char_boundary(value: &str, mut index: usize) -> usize {
    index = index.min(value.len());
    while index > 0 && !value.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn ceil_char_boundary(value: &str, mut index: usize) -> usize {
    index = index.min(value.len());
    while index < value.len() && !value.is_char_boundary(index) {
        index += 1;
    }
    index
}

fn unix_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn structured_and_free_text_secrets_are_redacted_but_paths_and_ids_remain() {
        let record = DebugTelemetryRecord::ToolRequest(DebugToolRecord {
            correlation: DebugCorrelation {
                session_id: Some("session-42".into()),
                ..Default::default()
            },
            tool_name: "bash".into(),
            arguments: Some(DebugContentField::value(serde_json::json!({
                "path": "/workspace/project/src/main.rs",
                "api_key": "secret-value",
                "token": "structured-token",
                "command": "curl -H 'Authorization: Bearer abc.123' -H 'Cookie: sid=first; refresh=second' 'https://example.com?token=query-token' https://user:pass@example.com"
            }))),
            raw_arguments: None,
            command: Some(DebugContentField::text("git status")),
            wire_tool_name: None,
            part_index: 2,
            result: None,
            error: None,
            parse_error: None,
            workspace_path: None,
            mcp_server: None,
            skill: None,
            extension: None,
        });
        let prepared = prepare_debug_record(record, None);
        assert!(prepared.body().contains("session-42"));
        assert!(prepared.body().contains("/workspace/project/src/main.rs"));
        assert!(prepared.body().contains("git status"));
        assert!(!prepared.body().contains("secret-value"));
        assert!(!prepared.body().contains("structured-token"));
        assert!(!prepared.body().contains("abc.123"));
        assert!(!prepared.body().contains("refresh=second"));
        assert!(!prepared.body().contains("query-token"));
        assert!(!prepared.body().contains("user:pass"));
    }

    #[test]
    fn oversized_records_use_utf8_safe_head_tail_truncation() {
        let record = DebugTelemetryRecord::TurnInput(DebugTurnRecord {
            correlation: DebugCorrelation::default(),
            content: Some(DebugContentField::text("甲".repeat(DEBUG_RECORD_MAX_BYTES))),
            modified_file_paths: None,
            modified_file_paths_original_count: None,
            workspace_path: None,
            repository: None,
            branch: None,
            base_commit: None,
        });
        let prepared = prepare_debug_record(record, None);
        assert!(!prepared.truncated());
        assert!(prepared.body().len() <= DEBUG_RECORD_MAX_BYTES);
        assert!(prepared.body().contains("[TRUNCATED]"));
        let body: Value = serde_json::from_str(prepared.body()).unwrap();
        assert_eq!(body["record"]["content"]["truncated"], Value::Bool(true));
        assert_eq!(
            body["record"]["content"]["original_size_bytes"],
            Value::from((DEBUG_RECORD_MAX_BYTES * "甲".len()) as u64 + 2)
        );
    }
}
