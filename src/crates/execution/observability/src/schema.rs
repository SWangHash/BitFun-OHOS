use crate::{AttributeValue, SignalKind, SpanStatus, TelemetryLevel, ValidatedRecord};
use std::collections::HashSet;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldType {
    Enum,
    Bool,
    U64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetricUnit {
    One,
    Seconds,
    Tokens,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrequencyClass {
    Low,
    Normal,
    AggregateOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FieldView {
    key: &'static str,
    field_type: FieldType,
    required: bool,
    enum_values: &'static [&'static str],
    label_eligible: bool,
}

impl FieldView {
    pub fn key(&self) -> &'static str {
        self.key
    }
    pub fn field_type(&self) -> FieldType {
        self.field_type
    }
    pub fn is_required(&self) -> bool {
        self.required
    }
    pub fn enum_values(&self) -> &'static [&'static str] {
        self.enum_values
    }
    pub fn is_label_eligible(&self) -> bool {
        self.label_eligible
    }
}

const fn enum_field(
    key: &'static str,
    required: bool,
    values: &'static [&'static str],
    label_eligible: bool,
) -> FieldView {
    FieldView {
        key,
        field_type: FieldType::Enum,
        required,
        enum_values: values,
        label_eligible,
    }
}

const fn bool_field(key: &'static str, required: bool, label_eligible: bool) -> FieldView {
    FieldView {
        key,
        field_type: FieldType::Bool,
        required,
        enum_values: &[],
        label_eligible,
    }
}

const fn u64_field(key: &'static str, required: bool) -> FieldView {
    FieldView {
        key,
        field_type: FieldType::U64,
        required,
        enum_values: &[],
        label_eligible: false,
    }
}

#[derive(Debug, Clone, Copy)]
pub struct DescriptorView {
    name: &'static str,
    version: u16,
    signal: SignalKind,
    minimum_level: TelemetryLevel,
    fields: &'static [FieldView],
    metric_unit: Option<MetricUnit>,
    body: Option<&'static str>,
    owner: &'static str,
    frequency: FrequencyClass,
    max_per_operation: u16,
}

impl DescriptorView {
    pub fn name(&self) -> &'static str {
        self.name
    }
    pub fn version(&self) -> u16 {
        self.version
    }
    pub fn signal(&self) -> SignalKind {
        self.signal
    }
    pub fn minimum_level(&self) -> TelemetryLevel {
        self.minimum_level
    }
    pub fn fields(&self) -> &'static [FieldView] {
        self.fields
    }
    pub fn metric_unit(&self) -> Option<MetricUnit> {
        self.metric_unit
    }
    pub fn body(&self) -> Option<&'static str> {
        self.body
    }
    pub fn owner(&self) -> &'static str {
        self.owner
    }
    pub fn frequency(&self) -> FrequencyClass {
        self.frequency
    }
    pub fn max_per_operation(&self) -> u16 {
        self.max_per_operation
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OperationKind {
    Startup,
    Session,
    Turn,
    Round,
    Inference,
    InferenceAttempt,
    Tool,
    PermissionEvaluate,
    PermissionConfirmation,
    Compression,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EventKind {
    SlashCommand,
    SessionConfig,
    InputAttachment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TokenMetricKind {
    Input,
    Output,
    Reasoning,
    CacheRead,
    CacheCreation,
    Total,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct OperationSchema {
    pub span: &'static DescriptorView,
    pub total: &'static DescriptorView,
    pub duration: &'static DescriptorView,
    pub log: &'static DescriptorView,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct EventSchema {
    pub total: &'static DescriptorView,
    pub log: &'static DescriptorView,
}

const OUTCOMES: &[&str] = &[
    "completed",
    "failed",
    "cancelled",
    "timeout",
    "rejected",
    "degraded",
    "incomplete",
];
const ERROR_TYPES: &[&str] = &[
    "cancelled",
    "timeout",
    "authentication",
    "rate_limited",
    "network_unavailable",
    "network_protocol",
    "invalid_request",
    "context_overflow",
    "tool_validation",
    "permission_denied",
    "persistence",
    "provider",
    "internal",
    "other",
];
const MODE_CLASSES: &[&str] = &["agentic", "chat", "review", "goal", "custom", "other"];
const TURN_TRIGGERS: &[&str] = &["user", "continuation", "scheduled", "remote", "system"];
const FINISH_REASONS: &[&str] = &[
    "completed",
    "tool_calls",
    "cancelled",
    "length",
    "content_filter",
    "max_rounds",
    "repeated_tool_failures",
    "error",
    "other",
];
const INDEX_BUCKETS: &[&str] = &["1", "2", "3_5", "6_10", "11_plus"];
const ATTEMPT_BUCKETS: &[&str] = &["1", "2", "3_plus"];
const PROVIDER_CLASSES: &[&str] = &[
    "openai_compatible",
    "anthropic_compatible",
    "google_compatible",
    "local",
    "other",
];
const MODEL_CLASSES: &[&str] = &["general_reasoning", "fast", "code", "vision", "other"];
const PROTOCOL_CLASSES: &[&str] = &[
    "responses",
    "chat_completions",
    "messages",
    "gemini",
    "other",
];
const INFERENCE_CONTEXT_CLASSES: &[&str] = &["turn", "session", "standalone"];
const INFERENCE_AUTH_CLASSES: &[&str] = &["api_key", "subscription"];
const INFERENCE_STREAM_OUTCOMES: &[&str] = &[
    "complete",
    "interrupted",
    "partial_recovered",
    "no_effective_output",
    "retry_exhausted",
];
const TOOL_ARGUMENT_RECOVERIES: &[&str] = &["repaired", "invalid", "retry_exhausted"];
const STATUS_CLASSES: &[&str] = &["none", "2xx", "3xx", "4xx", "5xx", "network"];
const TOOL_CLASSES: &[&str] = &["built_in", "custom"];
const TOOL_SOURCE_CLASSES: &[&str] = &["builtin", "mcp", "skill", "plugin", "external", "custom"];
const TOOL_KINDS: &[&str] = &[
    "filesystem",
    "search",
    "shell",
    "git",
    "browser",
    "computer_use",
    "protocol",
    "task",
    "other",
];
const TOOL_FAILURE_SOURCES: &[&str] = &[
    "validation",
    "permission",
    "execution",
    "timeout",
    "cancellation",
    "provider",
    "internal",
    "other",
];
const TOOL_ARGUMENT_STATES: &[&str] = &["unchanged", "repaired", "invalid"];
const PROGRAMMING_LANGUAGE_CLASSES: &[&str] = &[
    "rust",
    "typescript",
    "javascript",
    "python",
    "go",
    "java",
    "kotlin",
    "swift",
    "csharp",
    "cpp",
    "ruby",
    "php",
    "vue",
    "svelte",
    "markdown",
    "json",
    "yaml",
    "toml",
    "xml",
    "html",
    "css",
    "shell",
    "powershell",
    "sql",
    "gradle",
    "properties",
    "dockerfile",
    "makefile",
];
const PERMISSION_UI_SURFACES: &[&str] = &["tool_permission", "other"];
const EXIT_STATUS_CLASSES: &[&str] = &["success", "nonzero", "signal", "unknown"];
const SESSION_OPERATIONS: &[&str] = &["create", "resume", "delete"];
const SESSION_CLASSES: &[&str] = &["standard", "subagent", "internal", "transient"];
const SLASH_COMMAND_CLASSES: &[&str] = &[
    "session",
    "model",
    "agent",
    "workspace",
    "configuration",
    "diagnostic",
    "external",
    "other",
];
const SLASH_COMMAND_SOURCES: &[&str] = &["builtin", "external", "unknown"];
const IMAGE_ATTACHMENT_OUTCOMES: &[&str] = &["accepted", "rejected"];
const COUNT_BUCKETS: &[&str] = &["0", "1", "2", "3_plus"];
const PERMISSION_DECISIONS: &[&str] = &[
    "allow",
    "ask",
    "policy_deny",
    "user_reject",
    "cancelled",
    "failed",
];
const PERMISSION_SOURCES: &[&str] = &[
    "policy",
    "stored_grant",
    "hook",
    "auto_approve",
    "user",
    "delegated",
    "other",
];
const COMPRESSION_TRIGGERS: &[&str] = &[
    "threshold",
    "context_overflow",
    "manual",
    "recovery",
    "other",
];
const COMPRESSION_SOURCES: &[&str] = &["model", "local_fallback", "none"];

const STARTUP_FIELDS: &[FieldView] = &[
    enum_field("bitfun.app.startup.outcome", true, OUTCOMES, true),
    u64_field("bitfun.app.startup.duration_ms", false),
    enum_field("error.type", false, ERROR_TYPES, true),
];
const SESSION_FIELDS: &[FieldView] = &[
    enum_field(
        "bitfun.agent.session.operation",
        true,
        SESSION_OPERATIONS,
        true,
    ),
    enum_field("bitfun.agent.session.class", true, SESSION_CLASSES, true),
    bool_field("bitfun.agent.session.remote", true, true),
    enum_field("bitfun.agent.session.outcome", true, OUTCOMES, true),
    u64_field("bitfun.agent.session.duration_ms", false),
    enum_field("error.type", false, ERROR_TYPES, true),
];
const SLASH_COMMAND_FIELDS: &[FieldView] = &[
    enum_field(
        "bitfun.agent.slash_command.class",
        true,
        SLASH_COMMAND_CLASSES,
        true,
    ),
    enum_field(
        "bitfun.agent.slash_command.source",
        true,
        SLASH_COMMAND_SOURCES,
        true,
    ),
    bool_field("bitfun.agent.slash_command.has_arguments", true, true),
];
const SESSION_CONFIG_FIELDS: &[FieldView] = &[
    u64_field("bitfun.agent.session.config.max_context_tokens", true),
    u64_field("bitfun.agent.session.config.max_turns", true),
    bool_field("bitfun.agent.session.config.auto_compact", true, false),
    bool_field(
        "bitfun.agent.session.config.context_compression_enabled",
        true,
        false,
    ),
];
const INPUT_ATTACHMENT_FIELDS: &[FieldView] = &[
    enum_field(
        "bitfun.agent.input_attachment.outcome",
        true,
        IMAGE_ATTACHMENT_OUTCOMES,
        true,
    ),
    u64_field("bitfun.agent.input_attachment.image_count", true),
    u64_field("bitfun.agent.input_attachment.image_size_known_count", true),
    u64_field(
        "bitfun.agent.input_attachment.image_dimensions_known_count",
        true,
    ),
    u64_field(
        "bitfun.agent.input_attachment.image_total_size_bytes",
        false,
    ),
    u64_field("bitfun.agent.input_attachment.image_max_size_bytes", false),
    u64_field("bitfun.agent.input_attachment.image_max_width", false),
    u64_field("bitfun.agent.input_attachment.image_max_height", false),
    bool_field("bitfun.agent.input_attachment.image_has_png", true, true),
    bool_field("bitfun.agent.input_attachment.image_has_jpeg", true, true),
    bool_field("bitfun.agent.input_attachment.image_has_webp", true, true),
    bool_field("bitfun.agent.input_attachment.image_has_gif", true, true),
    bool_field("bitfun.agent.input_attachment.image_has_other", true, true),
];

const TURN_FIELDS: &[FieldView] = &[
    enum_field("bitfun.agent.turn.mode_class", false, MODE_CLASSES, true),
    enum_field("bitfun.agent.turn.trigger", false, TURN_TRIGGERS, true),
    bool_field("bitfun.agent.turn.remote", false, true),
    bool_field("bitfun.agent.turn.subagent", false, true),
    u64_field("bitfun.agent.turn.sequence", false),
    u64_field("bitfun.agent.turn.input_length", false),
    u64_field("bitfun.agent.turn.output_length", false),
    enum_field("bitfun.agent.turn.outcome", true, OUTCOMES, true),
    enum_field(
        "bitfun.agent.turn.finish_reason",
        false,
        FINISH_REASONS,
        true,
    ),
    u64_field("bitfun.agent.turn.round_count", false),
    u64_field("bitfun.agent.turn.tool_count", false),
    u64_field("bitfun.agent.turn.first_result_ms", false),
    u64_field("bitfun.agent.turn.modified_file_count", false),
    u64_field("bitfun.agent.turn.added_lines", false),
    u64_field("bitfun.agent.turn.deleted_lines", false),
    u64_field("bitfun.agent.turn.duration_ms", false),
    enum_field("error.type", false, ERROR_TYPES, true),
];
const ROUND_FIELDS: &[FieldView] = &[
    enum_field(
        "bitfun.agent.round.index_bucket",
        false,
        INDEX_BUCKETS,
        true,
    ),
    bool_field("bitfun.agent.round.subagent", false, true),
    bool_field("bitfun.agent.round.has_tool_calls", false, true),
    enum_field(
        "bitfun.agent.round.attempt.index_bucket",
        false,
        ATTEMPT_BUCKETS,
        true,
    ),
    enum_field("bitfun.agent.round.outcome", true, OUTCOMES, true),
    u64_field("bitfun.agent.round.duration_ms", false),
    enum_field("error.type", false, ERROR_TYPES, true),
];
const INFERENCE_FIELDS: &[FieldView] = &[
    enum_field(
        "bitfun.inference.provider_class",
        false,
        PROVIDER_CLASSES,
        true,
    ),
    enum_field("bitfun.inference.model_class", false, MODEL_CLASSES, true),
    enum_field(
        "bitfun.inference.protocol_class",
        false,
        PROTOCOL_CLASSES,
        true,
    ),
    enum_field(
        "bitfun.inference.context_class",
        true,
        INFERENCE_CONTEXT_CLASSES,
        true,
    ),
    enum_field(
        "bitfun.inference.auth_class",
        false,
        INFERENCE_AUTH_CLASSES,
        true,
    ),
    enum_field(
        "bitfun.inference.attempt.index_bucket",
        false,
        ATTEMPT_BUCKETS,
        true,
    ),
    enum_field(
        "bitfun.inference.request.http_status_class",
        false,
        STATUS_CLASSES,
        true,
    ),
    enum_field("bitfun.inference.request.outcome", true, OUTCOMES, true),
    bool_field("bitfun.inference.request.retryable", false, true),
    u64_field("bitfun.inference.request.duration_ms", false),
    u64_field("bitfun.inference.request.ttft_ms", false),
    u64_field("bitfun.inference.request.message_count", false),
    u64_field("bitfun.inference.request.tool_count", false),
    enum_field(
        "bitfun.inference.response.finish_reason",
        false,
        FINISH_REASONS,
        true,
    ),
    bool_field("bitfun.inference.response.has_tool_calls", false, true),
    bool_field("bitfun.inference.response.reasoning_present", false, true),
    enum_field(
        "bitfun.inference.response.stream_outcome",
        false,
        INFERENCE_STREAM_OUTCOMES,
        true,
    ),
    enum_field(
        "bitfun.inference.response.tool_argument_recovery",
        false,
        TOOL_ARGUMENT_RECOVERIES,
        true,
    ),
    u64_field("bitfun.inference.response.output_length", false),
    u64_field("bitfun.inference.response.reasoning_length", false),
    u64_field("bitfun.inference.response.output_line_count", false),
    u64_field("bitfun.inference.response.reasoning_first_ms", false),
    u64_field("bitfun.inference.response.reasoning_duration_ms", false),
    u64_field("bitfun.inference.usage.input_tokens", false),
    u64_field("bitfun.inference.usage.output_tokens", false),
    u64_field("bitfun.inference.usage.reasoning_tokens", false),
    u64_field("bitfun.inference.usage.cache_read_tokens", false),
    u64_field("bitfun.inference.usage.cache_creation_tokens", false),
    u64_field("bitfun.inference.usage.total_tokens", false),
    u64_field("bitfun.inference.request.context_window_tokens", false),
    u64_field(
        "bitfun.inference.request.tool_definition_tokens_estimate",
        false,
    ),
    enum_field("error.type", false, ERROR_TYPES, true),
];
const INFERENCE_ATTEMPT_FIELDS: &[FieldView] = &[
    enum_field(
        "bitfun.inference.attempt.index_bucket",
        true,
        ATTEMPT_BUCKETS,
        true,
    ),
    enum_field(
        "bitfun.inference.attempt.http_status_class",
        false,
        STATUS_CLASSES,
        true,
    ),
    bool_field("bitfun.inference.attempt.retryable", false, true),
    enum_field(
        "bitfun.inference.attempt.stream_outcome",
        false,
        INFERENCE_STREAM_OUTCOMES,
        true,
    ),
    enum_field(
        "bitfun.inference.attempt.tool_argument_recovery",
        false,
        TOOL_ARGUMENT_RECOVERIES,
        true,
    ),
    enum_field("bitfun.inference.attempt.outcome", true, OUTCOMES, true),
    u64_field("bitfun.inference.attempt.ttft_ms", false),
    u64_field("bitfun.inference.attempt.duration_ms", false),
    enum_field("error.type", false, ERROR_TYPES, true),
];
const TOOL_FIELDS: &[FieldView] = &[
    enum_field("bitfun.tool.class", false, TOOL_CLASSES, true),
    enum_field("bitfun.tool.source_class", true, TOOL_SOURCE_CLASSES, true),
    enum_field("bitfun.tool.kind", false, TOOL_KINDS, true),
    bool_field("bitfun.tool.execute.parallel", false, true),
    bool_field("bitfun.tool.execute.remote", false, true),
    bool_field("bitfun.tool.execute.background", false, true),
    enum_field(
        "bitfun.tool.arguments.state",
        false,
        TOOL_ARGUMENT_STATES,
        true,
    ),
    bool_field("bitfun.tool.arguments.truncated", false, true),
    enum_field("bitfun.tool.execute.outcome", true, OUTCOMES, true),
    u64_field("bitfun.tool.execute.duration_ms", false),
    u64_field("bitfun.tool.execute.queue_ms", false),
    u64_field("bitfun.tool.execute.preflight_ms", false),
    u64_field("bitfun.tool.execute.confirmation_ms", false),
    u64_field("bitfun.tool.execute.execution_ms", false),
    enum_field(
        "bitfun.tool.execute.failure_source",
        false,
        TOOL_FAILURE_SOURCES,
        true,
    ),
    enum_field(
        "bitfun.tool.execute.exit_status_class",
        false,
        EXIT_STATUS_CLASSES,
        true,
    ),
    u64_field("bitfun.tool.content.length", false),
    bool_field("bitfun.tool.content.truncated", false, true),
    bool_field("bitfun.tool.execute.retryable", false, true),
    enum_field(
        "bitfun.tool.programming_language",
        false,
        PROGRAMMING_LANGUAGE_CLASSES,
        true,
    ),
    enum_field("error.type", false, ERROR_TYPES, true),
];
const PERMISSION_EVALUATE_FIELDS: &[FieldView] = &[
    enum_field(
        "bitfun.permission.evaluate.intent_count_bucket",
        true,
        COUNT_BUCKETS,
        true,
    ),
    bool_field("bitfun.permission.evaluate.delegated", true, true),
    enum_field(
        "bitfun.permission.evaluate.decision",
        true,
        PERMISSION_DECISIONS,
        true,
    ),
    enum_field(
        "bitfun.permission.evaluate.source",
        true,
        PERMISSION_SOURCES,
        true,
    ),
    enum_field("bitfun.permission.evaluate.outcome", true, OUTCOMES, true),
    u64_field("bitfun.permission.evaluate.duration_ms", false),
    enum_field("error.type", false, ERROR_TYPES, true),
];
const PERMISSION_CONFIRMATION_FIELDS: &[FieldView] = &[
    enum_field(
        "bitfun.permission.confirmation.request_count_bucket",
        true,
        COUNT_BUCKETS,
        true,
    ),
    bool_field("bitfun.permission.confirmation.auto_approve", true, true),
    enum_field(
        "bitfun.permission.confirmation.ui_surface",
        false,
        PERMISSION_UI_SURFACES,
        true,
    ),
    enum_field(
        "bitfun.permission.confirmation.decision",
        true,
        PERMISSION_DECISIONS,
        true,
    ),
    enum_field(
        "bitfun.permission.confirmation.source",
        true,
        PERMISSION_SOURCES,
        true,
    ),
    enum_field(
        "bitfun.permission.confirmation.outcome",
        true,
        OUTCOMES,
        true,
    ),
    u64_field("bitfun.permission.confirmation.duration_ms", false),
    enum_field("error.type", false, ERROR_TYPES, true),
];
const COMPRESSION_FIELDS: &[FieldView] = &[
    enum_field(
        "bitfun.agent.compression.trigger",
        true,
        COMPRESSION_TRIGGERS,
        true,
    ),
    u64_field("bitfun.agent.compression.threshold_tokens", false),
    u64_field("bitfun.agent.compression.turns_since_last", false),
    enum_field(
        "bitfun.agent.compression.source",
        false,
        COMPRESSION_SOURCES,
        true,
    ),
    bool_field("bitfun.agent.compression.has_summary", false, true),
    u64_field("bitfun.agent.compression.tokens_before", false),
    u64_field("bitfun.agent.compression.tokens_after_estimate", false),
    u64_field("bitfun.agent.compression.usage.input_tokens", false),
    u64_field("bitfun.agent.compression.usage.output_tokens", false),
    u64_field("bitfun.agent.compression.usage.total_tokens", false),
    u64_field("bitfun.agent.compression.usage.cache_read_tokens", false),
    u64_field(
        "bitfun.agent.compression.usage.cache_creation_tokens",
        false,
    ),
    enum_field("bitfun.agent.compression.outcome", true, OUTCOMES, true),
    u64_field("bitfun.agent.compression.duration_ms", false),
    enum_field("error.type", false, ERROR_TYPES, true),
];

const STARTUP_METRIC_FIELDS: &[FieldView] = &[
    enum_field("bitfun.app.startup.outcome", true, OUTCOMES, true),
    enum_field("error.type", false, ERROR_TYPES, true),
];
const SESSION_METRIC_FIELDS: &[FieldView] = &[
    enum_field(
        "bitfun.agent.session.operation",
        true,
        SESSION_OPERATIONS,
        true,
    ),
    enum_field("bitfun.agent.session.class", true, SESSION_CLASSES, true),
    bool_field("bitfun.agent.session.remote", true, true),
    enum_field("bitfun.agent.session.outcome", true, OUTCOMES, true),
    enum_field("error.type", false, ERROR_TYPES, true),
];
const SLASH_COMMAND_METRIC_FIELDS: &[FieldView] = &[
    enum_field(
        "bitfun.agent.slash_command.class",
        true,
        SLASH_COMMAND_CLASSES,
        true,
    ),
    enum_field(
        "bitfun.agent.slash_command.source",
        true,
        SLASH_COMMAND_SOURCES,
        true,
    ),
    bool_field("bitfun.agent.slash_command.has_arguments", true, true),
];
const SESSION_CONFIG_METRIC_FIELDS: &[FieldView] = SESSION_CONFIG_FIELDS;
const INPUT_ATTACHMENT_METRIC_FIELDS: &[FieldView] = INPUT_ATTACHMENT_FIELDS;
const TURN_METRIC_FIELDS: &[FieldView] = &[
    enum_field("bitfun.agent.turn.outcome", true, OUTCOMES, true),
    enum_field("bitfun.agent.turn.mode_class", false, MODE_CLASSES, true),
    bool_field("bitfun.agent.turn.remote", false, true),
    bool_field("bitfun.agent.turn.subagent", false, true),
    enum_field("error.type", false, ERROR_TYPES, true),
];
const ROUND_METRIC_FIELDS: &[FieldView] = &[
    enum_field("bitfun.agent.round.outcome", true, OUTCOMES, true),
    bool_field("bitfun.agent.round.has_tool_calls", false, true),
    enum_field(
        "bitfun.agent.round.attempt.index_bucket",
        false,
        ATTEMPT_BUCKETS,
        true,
    ),
    enum_field("error.type", false, ERROR_TYPES, true),
];
const INFERENCE_METRIC_FIELDS: &[FieldView] = &[
    enum_field("bitfun.inference.request.outcome", true, OUTCOMES, true),
    enum_field(
        "bitfun.inference.provider_class",
        false,
        PROVIDER_CLASSES,
        true,
    ),
    enum_field("bitfun.inference.model_class", false, MODEL_CLASSES, true),
    enum_field(
        "bitfun.inference.context_class",
        true,
        INFERENCE_CONTEXT_CLASSES,
        true,
    ),
    enum_field(
        "bitfun.inference.auth_class",
        false,
        INFERENCE_AUTH_CLASSES,
        true,
    ),
    enum_field(
        "bitfun.inference.response.stream_outcome",
        false,
        INFERENCE_STREAM_OUTCOMES,
        true,
    ),
    enum_field(
        "bitfun.inference.request.http_status_class",
        false,
        STATUS_CLASSES,
        true,
    ),
    enum_field("error.type", false, ERROR_TYPES, true),
];
const INFERENCE_ATTEMPT_METRIC_FIELDS: &[FieldView] = &[
    enum_field(
        "bitfun.inference.attempt.index_bucket",
        true,
        ATTEMPT_BUCKETS,
        true,
    ),
    enum_field(
        "bitfun.inference.attempt.http_status_class",
        false,
        STATUS_CLASSES,
        true,
    ),
    enum_field("bitfun.inference.attempt.outcome", true, OUTCOMES, true),
    enum_field(
        "bitfun.inference.attempt.stream_outcome",
        false,
        INFERENCE_STREAM_OUTCOMES,
        true,
    ),
    enum_field(
        "bitfun.inference.attempt.tool_argument_recovery",
        false,
        TOOL_ARGUMENT_RECOVERIES,
        true,
    ),
];
const TOOL_METRIC_FIELDS: &[FieldView] = &[
    enum_field("bitfun.tool.execute.outcome", true, OUTCOMES, true),
    enum_field("bitfun.tool.class", false, TOOL_CLASSES, true),
    enum_field("bitfun.tool.source_class", true, TOOL_SOURCE_CLASSES, true),
    enum_field("bitfun.tool.kind", false, TOOL_KINDS, true),
    bool_field("bitfun.tool.execute.parallel", false, true),
    bool_field("bitfun.tool.execute.remote", false, true),
    bool_field("bitfun.tool.execute.background", false, true),
    enum_field(
        "bitfun.tool.execute.failure_source",
        false,
        TOOL_FAILURE_SOURCES,
        true,
    ),
    enum_field(
        "bitfun.tool.execute.exit_status_class",
        false,
        EXIT_STATUS_CLASSES,
        true,
    ),
    bool_field("bitfun.tool.execute.retryable", false, true),
    enum_field(
        "bitfun.tool.programming_language",
        false,
        PROGRAMMING_LANGUAGE_CLASSES,
        true,
    ),
    enum_field("error.type", false, ERROR_TYPES, true),
];
const PERMISSION_EVALUATE_METRIC_FIELDS: &[FieldView] = &[
    enum_field(
        "bitfun.permission.evaluate.decision",
        true,
        PERMISSION_DECISIONS,
        true,
    ),
    enum_field(
        "bitfun.permission.evaluate.source",
        true,
        PERMISSION_SOURCES,
        true,
    ),
    enum_field("bitfun.permission.evaluate.outcome", true, OUTCOMES, true),
    bool_field("bitfun.permission.evaluate.delegated", true, true),
    enum_field("error.type", false, ERROR_TYPES, true),
];
const PERMISSION_CONFIRMATION_METRIC_FIELDS: &[FieldView] = &[
    enum_field(
        "bitfun.permission.confirmation.decision",
        true,
        PERMISSION_DECISIONS,
        true,
    ),
    enum_field(
        "bitfun.permission.confirmation.source",
        true,
        PERMISSION_SOURCES,
        true,
    ),
    enum_field(
        "bitfun.permission.confirmation.outcome",
        true,
        OUTCOMES,
        true,
    ),
    bool_field("bitfun.permission.confirmation.auto_approve", true, true),
    enum_field("error.type", false, ERROR_TYPES, true),
];
const COMPRESSION_METRIC_FIELDS: &[FieldView] = &[
    enum_field(
        "bitfun.agent.compression.trigger",
        true,
        COMPRESSION_TRIGGERS,
        true,
    ),
    enum_field(
        "bitfun.agent.compression.source",
        false,
        COMPRESSION_SOURCES,
        true,
    ),
    enum_field("bitfun.agent.compression.outcome", true, OUTCOMES, true),
    enum_field("error.type", false, ERROR_TYPES, true),
];
const TOKEN_METRIC_FIELDS: &[FieldView] = &[
    enum_field(
        "bitfun.inference.provider_class",
        false,
        PROVIDER_CLASSES,
        true,
    ),
    enum_field("bitfun.inference.model_class", false, MODEL_CLASSES, true),
    bool_field("bitfun.agent.turn.subagent", false, true),
];

macro_rules! descriptors {
    ($span:ident, $total:ident, $duration:ident, $log:ident, $name:literal, $fields:ident, $metric_fields:ident, $body:literal, $owner:literal, $frequency:expr, $max:literal) => {
        static $span: DescriptorView = DescriptorView {
            name: $name,
            version: 1,
            signal: SignalKind::Trace,
            minimum_level: TelemetryLevel::Diagnostic,
            fields: $fields,
            metric_unit: None,
            body: None,
            owner: $owner,
            frequency: $frequency,
            max_per_operation: $max,
        };
        static $total: DescriptorView = DescriptorView {
            name: concat!($name, ".total"),
            version: 1,
            signal: SignalKind::Metric,
            minimum_level: TelemetryLevel::Basic,
            fields: $metric_fields,
            metric_unit: Some(MetricUnit::One),
            body: None,
            owner: $owner,
            frequency: $frequency,
            max_per_operation: $max,
        };
        static $duration: DescriptorView = DescriptorView {
            name: concat!($name, ".duration"),
            version: 1,
            signal: SignalKind::Metric,
            minimum_level: TelemetryLevel::Basic,
            fields: $metric_fields,
            metric_unit: Some(MetricUnit::Seconds),
            body: None,
            owner: $owner,
            frequency: $frequency,
            max_per_operation: $max,
        };
        static $log: DescriptorView = DescriptorView {
            name: $name,
            version: 1,
            signal: SignalKind::Log,
            minimum_level: TelemetryLevel::Basic,
            fields: $fields,
            metric_unit: None,
            body: Some($body),
            owner: $owner,
            frequency: $frequency,
            max_per_operation: $max,
        };
    };
}

descriptors!(
    STARTUP_SPAN,
    STARTUP_TOTAL,
    STARTUP_DURATION,
    STARTUP_LOG,
    "bitfun.app.startup",
    STARTUP_FIELDS,
    STARTUP_METRIC_FIELDS,
    "Application startup finished",
    "product-runtime",
    FrequencyClass::Low,
    1
);
descriptors!(
    SESSION_SPAN,
    SESSION_TOTAL,
    SESSION_DURATION,
    SESSION_LOG,
    "bitfun.agent.session",
    SESSION_FIELDS,
    SESSION_METRIC_FIELDS,
    "Agent session operation finished",
    "conversation-coordinator",
    FrequencyClass::Low,
    1
);
static SLASH_COMMAND_TOTAL: DescriptorView = DescriptorView {
    name: "bitfun.agent.slash_command.total",
    version: 1,
    signal: SignalKind::Metric,
    minimum_level: TelemetryLevel::Basic,
    fields: SLASH_COMMAND_METRIC_FIELDS,
    metric_unit: Some(MetricUnit::One),
    body: None,
    owner: "interface-command-router",
    frequency: FrequencyClass::Normal,
    max_per_operation: 1,
};
static SLASH_COMMAND_LOG: DescriptorView = DescriptorView {
    name: "bitfun.agent.slash_command",
    version: 1,
    signal: SignalKind::Log,
    minimum_level: TelemetryLevel::Basic,
    fields: SLASH_COMMAND_FIELDS,
    metric_unit: None,
    body: Some("Slash command invoked"),
    owner: "interface-command-router",
    frequency: FrequencyClass::Normal,
    max_per_operation: 1,
};
static SESSION_CONFIG_TOTAL: DescriptorView = DescriptorView {
    name: "bitfun.agent.session.config.total",
    version: 1,
    signal: SignalKind::Metric,
    minimum_level: TelemetryLevel::Basic,
    fields: SESSION_CONFIG_METRIC_FIELDS,
    metric_unit: Some(MetricUnit::One),
    body: None,
    owner: "conversation-coordinator",
    frequency: FrequencyClass::Low,
    max_per_operation: 1,
};
static SESSION_CONFIG_LOG: DescriptorView = DescriptorView {
    name: "bitfun.agent.session.config",
    version: 1,
    signal: SignalKind::Log,
    minimum_level: TelemetryLevel::Basic,
    fields: SESSION_CONFIG_FIELDS,
    metric_unit: None,
    body: Some("Agent session configuration resolved"),
    owner: "conversation-coordinator",
    frequency: FrequencyClass::Low,
    max_per_operation: 1,
};
static INPUT_ATTACHMENT_TOTAL: DescriptorView = DescriptorView {
    name: "bitfun.agent.input_attachment.total",
    version: 1,
    signal: SignalKind::Metric,
    minimum_level: TelemetryLevel::Basic,
    fields: INPUT_ATTACHMENT_METRIC_FIELDS,
    metric_unit: Some(MetricUnit::One),
    body: None,
    owner: "dialog-scheduler",
    frequency: FrequencyClass::Normal,
    max_per_operation: 1,
};
static INPUT_ATTACHMENT_LOG: DescriptorView = DescriptorView {
    name: "bitfun.agent.input_attachment",
    version: 1,
    signal: SignalKind::Log,
    minimum_level: TelemetryLevel::Basic,
    fields: INPUT_ATTACHMENT_FIELDS,
    metric_unit: None,
    body: Some("Agent input attachments submitted"),
    owner: "dialog-scheduler",
    frequency: FrequencyClass::Normal,
    max_per_operation: 1,
};

descriptors!(
    TURN_SPAN,
    TURN_TOTAL,
    TURN_DURATION,
    TURN_LOG,
    "bitfun.agent.turn",
    TURN_FIELDS,
    TURN_METRIC_FIELDS,
    "Agent turn finished",
    "execution-engine",
    FrequencyClass::Normal,
    1
);
descriptors!(
    ROUND_SPAN,
    ROUND_TOTAL,
    ROUND_DURATION,
    ROUND_LOG,
    "bitfun.agent.round",
    ROUND_FIELDS,
    ROUND_METRIC_FIELDS,
    "Agent round finished",
    "round-executor",
    FrequencyClass::Normal,
    64
);
descriptors!(
    INFERENCE_SPAN,
    INFERENCE_TOTAL,
    INFERENCE_DURATION,
    INFERENCE_LOG,
    "bitfun.inference.request",
    INFERENCE_FIELDS,
    INFERENCE_METRIC_FIELDS,
    "Inference request finished",
    "round-executor",
    FrequencyClass::Normal,
    64
);
descriptors!(
    INFERENCE_ATTEMPT_SPAN,
    INFERENCE_ATTEMPT_TOTAL,
    INFERENCE_ATTEMPT_DURATION,
    INFERENCE_ATTEMPT_LOG,
    "bitfun.inference.attempt",
    INFERENCE_ATTEMPT_FIELDS,
    INFERENCE_ATTEMPT_METRIC_FIELDS,
    "Inference attempt finished",
    "round-executor",
    FrequencyClass::Normal,
    128
);
descriptors!(
    TOOL_SPAN,
    TOOL_TOTAL,
    TOOL_DURATION,
    TOOL_LOG,
    "bitfun.tool.execute",
    TOOL_FIELDS,
    TOOL_METRIC_FIELDS,
    "Tool execution finished",
    "tool-pipeline",
    FrequencyClass::Normal,
    128
);
descriptors!(
    PERMISSION_EVALUATE_SPAN,
    PERMISSION_EVALUATE_TOTAL,
    PERMISSION_EVALUATE_DURATION,
    PERMISSION_EVALUATE_LOG,
    "bitfun.permission.evaluate",
    PERMISSION_EVALUATE_FIELDS,
    PERMISSION_EVALUATE_METRIC_FIELDS,
    "Permission evaluation finished",
    "tool-pipeline",
    FrequencyClass::Normal,
    128
);
descriptors!(
    PERMISSION_CONFIRMATION_SPAN,
    PERMISSION_CONFIRMATION_TOTAL,
    PERMISSION_CONFIRMATION_DURATION,
    PERMISSION_CONFIRMATION_LOG,
    "bitfun.permission.confirmation",
    PERMISSION_CONFIRMATION_FIELDS,
    PERMISSION_CONFIRMATION_METRIC_FIELDS,
    "Permission confirmation finished",
    "tool-pipeline",
    FrequencyClass::Normal,
    128
);
descriptors!(
    COMPRESSION_SPAN,
    COMPRESSION_TOTAL,
    COMPRESSION_DURATION,
    COMPRESSION_LOG,
    "bitfun.agent.compression",
    COMPRESSION_FIELDS,
    COMPRESSION_METRIC_FIELDS,
    "Agent context compression finished",
    "execution-engine",
    FrequencyClass::Low,
    16
);

macro_rules! token_descriptor {
    ($name:ident, $metric_name:literal) => {
        static $name: DescriptorView = DescriptorView {
            name: $metric_name,
            version: 1,
            signal: SignalKind::Metric,
            minimum_level: TelemetryLevel::Basic,
            fields: TOKEN_METRIC_FIELDS,
            metric_unit: Some(MetricUnit::Tokens),
            body: None,
            owner: "agent-runtime",
            frequency: FrequencyClass::AggregateOnly,
            max_per_operation: 1,
        };
    };
}

token_descriptor!(
    INFERENCE_INPUT_TOKENS,
    "bitfun.inference.usage.input_tokens"
);
token_descriptor!(
    INFERENCE_OUTPUT_TOKENS,
    "bitfun.inference.usage.output_tokens"
);
token_descriptor!(
    INFERENCE_REASONING_TOKENS,
    "bitfun.inference.usage.reasoning_tokens"
);
token_descriptor!(
    INFERENCE_CACHE_READ_TOKENS,
    "bitfun.inference.usage.cache_read_tokens"
);
token_descriptor!(
    INFERENCE_CACHE_CREATION_TOKENS,
    "bitfun.inference.usage.cache_creation_tokens"
);
token_descriptor!(
    INFERENCE_TOTAL_TOKENS,
    "bitfun.inference.usage.total_tokens"
);

static REGISTRY: &[DescriptorView] = &[
    STARTUP_SPAN,
    STARTUP_TOTAL,
    STARTUP_DURATION,
    STARTUP_LOG,
    SESSION_SPAN,
    SESSION_TOTAL,
    SESSION_DURATION,
    SESSION_LOG,
    SLASH_COMMAND_TOTAL,
    SLASH_COMMAND_LOG,
    SESSION_CONFIG_TOTAL,
    SESSION_CONFIG_LOG,
    INPUT_ATTACHMENT_TOTAL,
    INPUT_ATTACHMENT_LOG,
    TURN_SPAN,
    TURN_TOTAL,
    TURN_DURATION,
    TURN_LOG,
    ROUND_SPAN,
    ROUND_TOTAL,
    ROUND_DURATION,
    ROUND_LOG,
    INFERENCE_SPAN,
    INFERENCE_TOTAL,
    INFERENCE_DURATION,
    INFERENCE_LOG,
    INFERENCE_ATTEMPT_SPAN,
    INFERENCE_ATTEMPT_TOTAL,
    INFERENCE_ATTEMPT_DURATION,
    INFERENCE_ATTEMPT_LOG,
    TOOL_SPAN,
    TOOL_TOTAL,
    TOOL_DURATION,
    TOOL_LOG,
    PERMISSION_EVALUATE_SPAN,
    PERMISSION_EVALUATE_TOTAL,
    PERMISSION_EVALUATE_DURATION,
    PERMISSION_EVALUATE_LOG,
    PERMISSION_CONFIRMATION_SPAN,
    PERMISSION_CONFIRMATION_TOTAL,
    PERMISSION_CONFIRMATION_DURATION,
    PERMISSION_CONFIRMATION_LOG,
    COMPRESSION_SPAN,
    COMPRESSION_TOTAL,
    COMPRESSION_DURATION,
    COMPRESSION_LOG,
    INFERENCE_INPUT_TOKENS,
    INFERENCE_OUTPUT_TOKENS,
    INFERENCE_REASONING_TOKENS,
    INFERENCE_CACHE_READ_TOKENS,
    INFERENCE_CACHE_CREATION_TOKENS,
    INFERENCE_TOTAL_TOKENS,
];

pub fn descriptor_registry() -> &'static [DescriptorView] {
    REGISTRY
}

pub(crate) fn operation_schema(kind: OperationKind) -> OperationSchema {
    match kind {
        OperationKind::Startup => OperationSchema {
            span: &STARTUP_SPAN,
            total: &STARTUP_TOTAL,
            duration: &STARTUP_DURATION,
            log: &STARTUP_LOG,
        },
        OperationKind::Session => OperationSchema {
            span: &SESSION_SPAN,
            total: &SESSION_TOTAL,
            duration: &SESSION_DURATION,
            log: &SESSION_LOG,
        },
        OperationKind::Turn => OperationSchema {
            span: &TURN_SPAN,
            total: &TURN_TOTAL,
            duration: &TURN_DURATION,
            log: &TURN_LOG,
        },
        OperationKind::Round => OperationSchema {
            span: &ROUND_SPAN,
            total: &ROUND_TOTAL,
            duration: &ROUND_DURATION,
            log: &ROUND_LOG,
        },
        OperationKind::Inference => OperationSchema {
            span: &INFERENCE_SPAN,
            total: &INFERENCE_TOTAL,
            duration: &INFERENCE_DURATION,
            log: &INFERENCE_LOG,
        },
        OperationKind::InferenceAttempt => OperationSchema {
            span: &INFERENCE_ATTEMPT_SPAN,
            total: &INFERENCE_ATTEMPT_TOTAL,
            duration: &INFERENCE_ATTEMPT_DURATION,
            log: &INFERENCE_ATTEMPT_LOG,
        },
        OperationKind::Tool => OperationSchema {
            span: &TOOL_SPAN,
            total: &TOOL_TOTAL,
            duration: &TOOL_DURATION,
            log: &TOOL_LOG,
        },
        OperationKind::PermissionEvaluate => OperationSchema {
            span: &PERMISSION_EVALUATE_SPAN,
            total: &PERMISSION_EVALUATE_TOTAL,
            duration: &PERMISSION_EVALUATE_DURATION,
            log: &PERMISSION_EVALUATE_LOG,
        },
        OperationKind::PermissionConfirmation => OperationSchema {
            span: &PERMISSION_CONFIRMATION_SPAN,
            total: &PERMISSION_CONFIRMATION_TOTAL,
            duration: &PERMISSION_CONFIRMATION_DURATION,
            log: &PERMISSION_CONFIRMATION_LOG,
        },
        OperationKind::Compression => OperationSchema {
            span: &COMPRESSION_SPAN,
            total: &COMPRESSION_TOTAL,
            duration: &COMPRESSION_DURATION,
            log: &COMPRESSION_LOG,
        },
    }
}

pub(crate) const fn event_schema(kind: EventKind) -> EventSchema {
    match kind {
        EventKind::SlashCommand => EventSchema {
            total: &SLASH_COMMAND_TOTAL,
            log: &SLASH_COMMAND_LOG,
        },
        EventKind::SessionConfig => EventSchema {
            total: &SESSION_CONFIG_TOTAL,
            log: &SESSION_CONFIG_LOG,
        },
        EventKind::InputAttachment => EventSchema {
            total: &INPUT_ATTACHMENT_TOTAL,
            log: &INPUT_ATTACHMENT_LOG,
        },
    }
}

pub(crate) fn token_metric_descriptor(kind: TokenMetricKind) -> &'static DescriptorView {
    match kind {
        TokenMetricKind::Input => &INFERENCE_INPUT_TOKENS,
        TokenMetricKind::Output => &INFERENCE_OUTPUT_TOKENS,
        TokenMetricKind::Reasoning => &INFERENCE_REASONING_TOKENS,
        TokenMetricKind::CacheRead => &INFERENCE_CACHE_READ_TOKENS,
        TokenMetricKind::CacheCreation => &INFERENCE_CACHE_CREATION_TOKENS,
        TokenMetricKind::Total => &INFERENCE_TOTAL_TOKENS,
    }
}

pub(crate) fn metric_attributes(
    kind: OperationKind,
    attributes: &[crate::Attribute],
) -> Vec<crate::Attribute> {
    let fields = operation_schema(kind).total.fields;
    attributes
        .iter()
        .filter(|attribute| fields.iter().any(|field| field.key == attribute.key()))
        .cloned()
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum PrivacyError {
    #[error("signal descriptor is not registered")]
    UnknownDescriptor,
    #[error("record contains too many attributes")]
    TooManyAttributes,
    #[error("attribute key is duplicated")]
    DuplicateAttribute,
    #[error("attribute is not registered for this signal")]
    UnknownField,
    #[error("attribute type does not match the schema")]
    TypeMismatch,
    #[error("enum value is outside the registered finite set")]
    InvalidEnumValue,
    #[error("required attribute is missing")]
    MissingRequiredField,
    #[error("failed signal is missing a safe error type")]
    MissingSafeErrorType,
    #[error("structured log body differs from its static descriptor")]
    InvalidLogBody,
}

pub(crate) fn validate(record: &ValidatedRecord) -> Result<(), PrivacyError> {
    let descriptor = REGISTRY
        .iter()
        .find(|descriptor| {
            descriptor.signal == record.signal_kind() && descriptor.name == record.name()
        })
        .ok_or(PrivacyError::UnknownDescriptor)?;
    let attributes = record.attributes();
    if attributes.len() > 32 {
        return Err(PrivacyError::TooManyAttributes);
    }
    let mut keys = HashSet::with_capacity(attributes.len());
    for attribute in attributes {
        if !keys.insert(attribute.key()) {
            return Err(PrivacyError::DuplicateAttribute);
        }
        let field = descriptor
            .fields
            .iter()
            .find(|field| field.key == attribute.key())
            .ok_or(PrivacyError::UnknownField)?;
        match (field.field_type, attribute.value()) {
            (FieldType::Enum, AttributeValue::Enum(value)) => {
                if !field.enum_values.contains(value) {
                    return Err(PrivacyError::InvalidEnumValue);
                }
            }
            (FieldType::Bool, AttributeValue::Bool(_))
            | (FieldType::U64, AttributeValue::U64(_)) => {}
            _ => return Err(PrivacyError::TypeMismatch),
        }
    }
    if descriptor
        .fields
        .iter()
        .any(|field| field.required && !keys.contains(field.key))
    {
        return Err(PrivacyError::MissingRequiredField);
    }
    let is_failed = attributes.iter().any(|attribute| {
        attribute.key().ends_with(".outcome")
            && matches!(
                attribute.value(),
                AttributeValue::Enum("failed" | "timeout" | "rejected")
            )
    });
    let requires_error = match record {
        ValidatedRecord::Span(span) => span.status() == SpanStatus::Error,
        ValidatedRecord::Log(_) => is_failed,
        ValidatedRecord::Metric(_) => false,
    };
    if requires_error && !keys.contains("error.type") {
        return Err(PrivacyError::MissingSafeErrorType);
    }
    if let ValidatedRecord::Log(log) = record {
        if descriptor.body != Some(log.body()) {
            return Err(PrivacyError::InvalidLogBody);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_contains_only_allowed_namespaces() {
        for descriptor in descriptor_registry() {
            assert!(matches!(
                descriptor.name().split('.').nth(1),
                Some("agent" | "app" | "inference" | "permission" | "tool")
            ));
            assert!(descriptor.fields().iter().all(|field| {
                field.key() == "error.type"
                    || field.key().starts_with("bitfun.agent.")
                    || field.key().starts_with("bitfun.app.")
                    || field.key().starts_with("bitfun.inference.")
                    || field.key().starts_with("bitfun.permission.")
                    || field.key().starts_with("bitfun.tool.")
            }));
        }
    }

    #[test]
    fn registry_has_no_content_or_identity_fields() {
        for descriptor in descriptor_registry() {
            for forbidden in [
                "prompt",
                "inference.response.body",
                "inference.response.content",
                "tool.arguments.raw",
                "tool.result",
                ".path",
                "user.",
                "machine.",
                "session.id",
                "session_id",
                "endpoint",
                "error.message",
            ] {
                assert!(!descriptor.name().contains(forbidden));
                assert!(descriptor
                    .fields()
                    .iter()
                    .all(|field| !field.key().contains(forbidden)));
            }
        }
    }

    #[test]
    fn every_descriptor_declares_owner_frequency_and_bound() {
        for descriptor in descriptor_registry() {
            assert!(!descriptor.owner().is_empty());
            assert!(descriptor.max_per_operation() > 0);
            assert!(matches!(
                descriptor.frequency(),
                FrequencyClass::Low | FrequencyClass::Normal | FrequencyClass::AggregateOnly
            ));
        }
    }

    #[test]
    fn registry_covers_frozen_p0_operations() {
        for name in [
            "bitfun.app.startup",
            "bitfun.agent.session",
            "bitfun.agent.turn",
            "bitfun.agent.round",
            "bitfun.inference.request",
            "bitfun.inference.attempt",
            "bitfun.tool.execute",
            "bitfun.permission.evaluate",
            "bitfun.permission.confirmation",
            "bitfun.agent.compression",
        ] {
            assert!(descriptor_registry()
                .iter()
                .any(|descriptor| descriptor.name() == name
                    && descriptor.signal() == SignalKind::Trace));
        }
        assert!(descriptor_registry().iter().any(|descriptor| {
            descriptor.name() == "bitfun.agent.slash_command"
                && descriptor.signal() == SignalKind::Log
        }));
    }
}
