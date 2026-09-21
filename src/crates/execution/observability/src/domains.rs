//! Typed Agent observability facts.
//!
//! These APIs accept only finite enums, booleans, counters, and durations.
//! They deliberately have no slots for prompts, model payloads, tool arguments,
//! paths, business identifiers, arbitrary names, or raw errors.

use crate::schema::{EventKind, OperationKind, TokenMetricKind};
use crate::{
    Attribute, ObservationContext, Severity, SpanStatus, Telemetry, TelemetrySpan, TraceRelation,
};

macro_rules! safe_enum {
    ($name:ident { $($variant:ident => $value:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum $name {
            $($variant),+
        }

        impl $name {
            const fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $value),+
                }
            }
        }
    };
}

safe_enum!(Outcome {
    Completed => "completed",
    Failed => "failed",
    Cancelled => "cancelled",
    Timeout => "timeout",
    Rejected => "rejected",
    Degraded => "degraded",
    Incomplete => "incomplete",
});
safe_enum!(SafeErrorType {
    Cancelled => "cancelled",
    Timeout => "timeout",
    Authentication => "authentication",
    RateLimited => "rate_limited",
    NetworkUnavailable => "network_unavailable",
    NetworkProtocol => "network_protocol",
    InvalidRequest => "invalid_request",
    ContextOverflow => "context_overflow",
    ToolValidation => "tool_validation",
    PermissionDenied => "permission_denied",
    Persistence => "persistence",
    Provider => "provider",
    Internal => "internal",
    Other => "other",
});
safe_enum!(AgentModeClass {
    Agentic => "agentic",
    Chat => "chat",
    Review => "review",
    Goal => "goal",
    Custom => "custom",
    Other => "other",
});
safe_enum!(TurnTrigger {
    User => "user",
    Continuation => "continuation",
    Scheduled => "scheduled",
    Remote => "remote",
    System => "system",
});
safe_enum!(FinishReasonClass {
    Completed => "completed",
    ToolCalls => "tool_calls",
    Cancelled => "cancelled",
    Length => "length",
    ContentFilter => "content_filter",
    MaxRounds => "max_rounds",
    RepeatedToolFailures => "repeated_tool_failures",
    Error => "error",
    Other => "other",
});
safe_enum!(IndexBucket {
    One => "1",
    Two => "2",
    ThreeToFive => "3_5",
    SixToTen => "6_10",
    ElevenPlus => "11_plus",
});
safe_enum!(AttemptBucket {
    One => "1",
    Two => "2",
    ThreePlus => "3_plus",
});
safe_enum!(ProviderClass {
    OpenAiCompatible => "openai_compatible",
    AnthropicCompatible => "anthropic_compatible",
    GoogleCompatible => "google_compatible",
    Local => "local",
    Other => "other",
});
safe_enum!(ModelClass {
    GeneralReasoning => "general_reasoning",
    Fast => "fast",
    Code => "code",
    Vision => "vision",
    Other => "other",
});
safe_enum!(InferenceProtocolClass {
    Responses => "responses",
    ChatCompletions => "chat_completions",
    Messages => "messages",
    Gemini => "gemini",
    Other => "other",
});
safe_enum!(InferenceContextClass {
    Turn => "turn",
    Session => "session",
    Standalone => "standalone",
});
safe_enum!(InferenceAuthClass {
    ApiKey => "api_key",
    Subscription => "subscription",
});
safe_enum!(InferenceStreamOutcomeClass {
    Complete => "complete",
    Interrupted => "interrupted",
    PartialRecovered => "partial_recovered",
    NoEffectiveOutput => "no_effective_output",
    RetryExhausted => "retry_exhausted",
});
safe_enum!(ToolArgumentRecoveryClass {
    Repaired => "repaired",
    Invalid => "invalid",
    RetryExhausted => "retry_exhausted",
});
safe_enum!(StatusClass {
    None => "none",
    Success => "2xx",
    Redirect => "3xx",
    ClientError => "4xx",
    ServerError => "5xx",
    Network => "network",
});
safe_enum!(ToolClass {
    BuiltIn => "built_in",
    Custom => "custom",
});
safe_enum!(ToolKind {
    Filesystem => "filesystem",
    Search => "search",
    Shell => "shell",
    Git => "git",
    Browser => "browser",
    ComputerUse => "computer_use",
    Protocol => "protocol",
    Task => "task",
    Other => "other",
});
safe_enum!(ToolSourceClass {
    BuiltIn => "builtin",
    Mcp => "mcp",
    Skill => "skill",
    Plugin => "plugin",
    External => "external",
    Custom => "custom",
});
safe_enum!(ToolFailureSource {
    Validation => "validation",
    Permission => "permission",
    Execution => "execution",
    Timeout => "timeout",
    Cancellation => "cancellation",
    Provider => "provider",
    Internal => "internal",
    Other => "other",
});
safe_enum!(ExitStatusClass {
    Success => "success",
    Nonzero => "nonzero",
    Signal => "signal",
    Unknown => "unknown",
});
safe_enum!(ToolArgumentState {
    Unchanged => "unchanged",
    Repaired => "repaired",
    Invalid => "invalid",
});
safe_enum!(ProgrammingLanguageClass {
    Rust => "rust",
    TypeScript => "typescript",
    JavaScript => "javascript",
    Python => "python",
    Go => "go",
    Java => "java",
    Kotlin => "kotlin",
    Swift => "swift",
    CSharp => "csharp",
    Cpp => "cpp",
    Ruby => "ruby",
    Php => "php",
    Vue => "vue",
    Svelte => "svelte",
    Markdown => "markdown",
    Json => "json",
    Yaml => "yaml",
    Toml => "toml",
    Xml => "xml",
    Html => "html",
    Css => "css",
    Shell => "shell",
    PowerShell => "powershell",
    Sql => "sql",
    Gradle => "gradle",
    Properties => "properties",
    Dockerfile => "dockerfile",
    Makefile => "makefile",
});
safe_enum!(PermissionUiSurface {
    ToolPermission => "tool_permission",
    Other => "other",
});
safe_enum!(SessionOperation {
    Create => "create",
    Resume => "resume",
    Delete => "delete",
});
safe_enum!(SessionClass {
    Standard => "standard",
    Subagent => "subagent",
    Internal => "internal",
    Transient => "transient",
});
safe_enum!(SlashCommandClass {
    Session => "session",
    Model => "model",
    Agent => "agent",
    Workspace => "workspace",
    Configuration => "configuration",
    Diagnostic => "diagnostic",
    External => "external",
    Other => "other",
});
safe_enum!(SlashCommandSource {
    BuiltIn => "builtin",
    External => "external",
    Unknown => "unknown",
});
safe_enum!(ImageAttachmentOutcome {
    Accepted => "accepted",
    Rejected => "rejected",
});
safe_enum!(CountBucket {
    Zero => "0",
    One => "1",
    Two => "2",
    ThreePlus => "3_plus",
});
safe_enum!(PermissionDecision {
    Allow => "allow",
    Ask => "ask",
    PolicyDeny => "policy_deny",
    UserReject => "user_reject",
    Cancelled => "cancelled",
    Failed => "failed",
});
safe_enum!(PermissionSource {
    Policy => "policy",
    StoredGrant => "stored_grant",
    Hook => "hook",
    AutoApprove => "auto_approve",
    User => "user",
    Delegated => "delegated",
    Other => "other",
});
safe_enum!(CompressionTrigger {
    Threshold => "threshold",
    ContextOverflow => "context_overflow",
    Manual => "manual",
    Recovery => "recovery",
    Other => "other",
});
safe_enum!(CompressionSource {
    Model => "model",
    LocalFallback => "local_fallback",
    None => "none",
});

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CompletionFacts {
    outcome: Outcome,
    error_type: Option<SafeErrorType>,
}

impl CompletionFacts {
    pub const fn completed() -> Self {
        Self {
            outcome: Outcome::Completed,
            error_type: None,
        }
    }

    pub const fn degraded(error_type: SafeErrorType) -> Self {
        Self {
            outcome: Outcome::Degraded,
            error_type: Some(error_type),
        }
    }

    pub const fn failed(error_type: SafeErrorType) -> Self {
        Self {
            outcome: Outcome::Failed,
            error_type: Some(error_type),
        }
    }

    pub const fn cancelled() -> Self {
        Self {
            outcome: Outcome::Cancelled,
            error_type: Some(SafeErrorType::Cancelled),
        }
    }

    pub const fn timeout() -> Self {
        Self {
            outcome: Outcome::Timeout,
            error_type: Some(SafeErrorType::Timeout),
        }
    }

    pub const fn rejected(error_type: SafeErrorType) -> Self {
        Self {
            outcome: Outcome::Rejected,
            error_type: Some(error_type),
        }
    }

    pub const fn incomplete() -> Self {
        Self {
            outcome: Outcome::Incomplete,
            error_type: None,
        }
    }

    pub const fn outcome(self) -> Outcome {
        self.outcome
    }

    pub const fn error_type(self) -> Option<SafeErrorType> {
        self.error_type
    }
}

fn completion_attributes(
    completion: CompletionFacts,
    outcome_key: &'static str,
    mut attributes: Vec<Attribute>,
) -> (Vec<Attribute>, SpanStatus, Severity) {
    attributes.push(Attribute::enumeration(
        outcome_key,
        completion.outcome.as_str(),
    ));
    if let Some(error_type) = completion.error_type {
        attributes.push(Attribute::enumeration("error.type", error_type.as_str()));
    }
    let status = match completion.outcome {
        Outcome::Completed | Outcome::Degraded => SpanStatus::Ok,
        Outcome::Incomplete => SpanStatus::Unset,
        Outcome::Failed | Outcome::Cancelled | Outcome::Timeout | Outcome::Rejected => {
            SpanStatus::Error
        }
    };
    let severity = match completion.outcome {
        Outcome::Completed => Severity::Info,
        Outcome::Degraded | Outcome::Cancelled | Outcome::Rejected => Severity::Warn,
        Outcome::Failed | Outcome::Timeout => Severity::Error,
        Outcome::Incomplete => Severity::Warn,
    };
    (attributes, status, severity)
}

macro_rules! observation {
    ($name:ident, $finish:ty) => {
        #[derive(Debug)]
        pub struct $name(TelemetrySpan);

        impl $name {
            pub fn context(&self) -> Option<ObservationContext> {
                self.0.context()
            }

            pub fn finish(self, facts: $finish) {
                let (attributes, status, severity) = facts.into_parts();
                self.0.finish_terminal(attributes, status, severity);
            }
        }
    };
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StartupFinishFacts {
    pub completion: CompletionFacts,
}

impl StartupFinishFacts {
    fn into_parts(self) -> (Vec<Attribute>, SpanStatus, Severity) {
        completion_attributes(self.completion, "bitfun.app.startup.outcome", Vec::new())
    }
}

observation!(StartupObservation, StartupFinishFacts);

pub fn start_startup(telemetry: &Telemetry) -> StartupObservation {
    StartupObservation(telemetry.start_operation(OperationKind::Startup, Vec::new, None))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionStartFacts {
    pub operation: SessionOperation,
    pub session_class: SessionClass,
    pub remote: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionFinishFacts {
    pub completion: CompletionFacts,
}

impl SessionFinishFacts {
    fn into_parts(self) -> (Vec<Attribute>, SpanStatus, Severity) {
        completion_attributes(self.completion, "bitfun.agent.session.outcome", Vec::new())
    }
}

observation!(SessionObservation, SessionFinishFacts);

pub fn start_session(
    telemetry: &Telemetry,
    facts: SessionStartFacts,
    parent: Option<ObservationContext>,
) -> SessionObservation {
    SessionObservation(telemetry.start_operation(
        OperationKind::Session,
        || {
            vec![
                Attribute::enumeration("bitfun.agent.session.operation", facts.operation.as_str()),
                Attribute::enumeration("bitfun.agent.session.class", facts.session_class.as_str()),
                Attribute::boolean("bitfun.agent.session.remote", facts.remote),
            ]
        },
        parent,
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SlashCommandFacts {
    pub command_class: SlashCommandClass,
    pub source: SlashCommandSource,
    pub has_arguments: bool,
}

pub fn record_slash_command(telemetry: &Telemetry, facts: SlashCommandFacts) {
    telemetry.record_instant_event(
        EventKind::SlashCommand,
        vec![
            Attribute::enumeration(
                "bitfun.agent.slash_command.class",
                facts.command_class.as_str(),
            ),
            Attribute::enumeration("bitfun.agent.slash_command.source", facts.source.as_str()),
            Attribute::boolean(
                "bitfun.agent.slash_command.has_arguments",
                facts.has_arguments,
            ),
        ],
    );
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionConfigFacts {
    pub max_context_tokens: u64,
    pub max_turns: u64,
    pub auto_compact: bool,
    pub context_compression_enabled: bool,
}

pub fn record_session_config(telemetry: &Telemetry, facts: SessionConfigFacts) {
    telemetry.record_instant_event(
        EventKind::SessionConfig,
        vec![
            Attribute::u64(
                "bitfun.agent.session.config.max_context_tokens",
                facts.max_context_tokens,
            ),
            Attribute::u64("bitfun.agent.session.config.max_turns", facts.max_turns),
            Attribute::boolean(
                "bitfun.agent.session.config.auto_compact",
                facts.auto_compact,
            ),
            Attribute::boolean(
                "bitfun.agent.session.config.context_compression_enabled",
                facts.context_compression_enabled,
            ),
        ],
    );
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImageAttachmentFacts {
    pub outcome: ImageAttachmentOutcome,
    pub count: u64,
    pub size_known_count: u64,
    pub dimensions_known_count: u64,
    pub total_size_bytes: Option<u64>,
    pub max_size_bytes: Option<u64>,
    pub max_width: Option<u64>,
    pub max_height: Option<u64>,
    pub has_png: bool,
    pub has_jpeg: bool,
    pub has_webp: bool,
    pub has_gif: bool,
    pub has_other: bool,
}

pub fn record_image_attachments(telemetry: &Telemetry, facts: ImageAttachmentFacts) {
    let mut attributes = vec![
        Attribute::enumeration(
            "bitfun.agent.input_attachment.outcome",
            facts.outcome.as_str(),
        ),
        Attribute::u64("bitfun.agent.input_attachment.image_count", facts.count),
        Attribute::u64(
            "bitfun.agent.input_attachment.image_size_known_count",
            facts.size_known_count,
        ),
        Attribute::u64(
            "bitfun.agent.input_attachment.image_dimensions_known_count",
            facts.dimensions_known_count,
        ),
        Attribute::boolean("bitfun.agent.input_attachment.image_has_png", facts.has_png),
        Attribute::boolean(
            "bitfun.agent.input_attachment.image_has_jpeg",
            facts.has_jpeg,
        ),
        Attribute::boolean(
            "bitfun.agent.input_attachment.image_has_webp",
            facts.has_webp,
        ),
        Attribute::boolean("bitfun.agent.input_attachment.image_has_gif", facts.has_gif),
        Attribute::boolean(
            "bitfun.agent.input_attachment.image_has_other",
            facts.has_other,
        ),
    ];
    for (key, value) in [
        (
            "bitfun.agent.input_attachment.image_total_size_bytes",
            facts.total_size_bytes,
        ),
        (
            "bitfun.agent.input_attachment.image_max_size_bytes",
            facts.max_size_bytes,
        ),
        (
            "bitfun.agent.input_attachment.image_max_width",
            facts.max_width,
        ),
        (
            "bitfun.agent.input_attachment.image_max_height",
            facts.max_height,
        ),
    ] {
        if let Some(value) = value {
            attributes.push(Attribute::u64(key, value));
        }
    }
    telemetry.record_instant_event(EventKind::InputAttachment, attributes);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TurnStartFacts {
    pub mode_class: AgentModeClass,
    pub trigger: TurnTrigger,
    pub remote: bool,
    pub subagent: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TurnFinishFacts {
    pub completion: CompletionFacts,
    pub finish_reason: Option<FinishReasonClass>,
    pub round_count: Option<u64>,
    pub tool_count: Option<u64>,
    pub first_result_ms: Option<u64>,
    pub modified_file_count: Option<u64>,
    pub added_lines: Option<u64>,
    pub deleted_lines: Option<u64>,
}

impl TurnFinishFacts {
    fn into_parts(self) -> (Vec<Attribute>, SpanStatus, Severity) {
        let mut attributes = Vec::new();
        if let Some(round_count) = self.round_count {
            attributes.push(Attribute::u64("bitfun.agent.turn.round_count", round_count));
        }
        if let Some(tool_count) = self.tool_count {
            attributes.push(Attribute::u64("bitfun.agent.turn.tool_count", tool_count));
        }
        for (key, value) in [
            ("bitfun.agent.turn.first_result_ms", self.first_result_ms),
            (
                "bitfun.agent.turn.modified_file_count",
                self.modified_file_count,
            ),
            ("bitfun.agent.turn.added_lines", self.added_lines),
            ("bitfun.agent.turn.deleted_lines", self.deleted_lines),
        ] {
            if let Some(value) = value {
                attributes.push(Attribute::u64(key, value));
            }
        }
        if let Some(reason) = self.finish_reason {
            attributes.push(Attribute::enumeration(
                "bitfun.agent.turn.finish_reason",
                reason.as_str(),
            ));
        }
        completion_attributes(self.completion, "bitfun.agent.turn.outcome", attributes)
    }
}

observation!(TurnObservation, TurnFinishFacts);

impl TurnObservation {
    pub fn finish_with_output_length(self, facts: TurnFinishFacts, output_length: Option<u64>) {
        let (mut attributes, status, severity) = facts.into_parts();
        if let Some(output_length) = output_length {
            attributes.push(Attribute::u64(
                "bitfun.agent.turn.output_length",
                output_length,
            ));
        }
        self.0.finish_terminal(attributes, status, severity);
    }
}

fn turn_start_attributes(
    facts: TurnStartFacts,
    sequence: Option<u64>,
    input_length: Option<u64>,
) -> Vec<Attribute> {
    let mut attributes = vec![
        Attribute::enumeration("bitfun.agent.turn.mode_class", facts.mode_class.as_str()),
        Attribute::enumeration("bitfun.agent.turn.trigger", facts.trigger.as_str()),
        Attribute::boolean("bitfun.agent.turn.remote", facts.remote),
        Attribute::boolean("bitfun.agent.turn.subagent", facts.subagent),
    ];
    if let Some(sequence) = sequence {
        attributes.push(Attribute::u64("bitfun.agent.turn.sequence", sequence));
    }
    if let Some(input_length) = input_length {
        attributes.push(Attribute::u64(
            "bitfun.agent.turn.input_length",
            input_length,
        ));
    }
    attributes
}

pub fn start_turn(
    telemetry: &Telemetry,
    facts: TurnStartFacts,
    parent: Option<ObservationContext>,
) -> TurnObservation {
    TurnObservation(telemetry.start_operation(
        OperationKind::Turn,
        || turn_start_attributes(facts, None, None),
        parent,
    ))
}

pub fn start_turn_with_relation(
    telemetry: &Telemetry,
    facts: TurnStartFacts,
    relation: TraceRelation,
) -> TurnObservation {
    TurnObservation(telemetry.start_operation_with_relation(
        OperationKind::Turn,
        || turn_start_attributes(facts, None, None),
        relation,
    ))
}

pub fn start_turn_with_relation_and_content_facts(
    telemetry: &Telemetry,
    facts: TurnStartFacts,
    relation: TraceRelation,
    sequence: Option<u64>,
    input_length: Option<u64>,
) -> TurnObservation {
    TurnObservation(telemetry.start_operation_with_relation(
        OperationKind::Turn,
        || turn_start_attributes(facts, sequence, input_length),
        relation,
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RoundStartFacts {
    pub index_bucket: IndexBucket,
    pub subagent: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RoundFinishFacts {
    pub completion: CompletionFacts,
    pub has_tool_calls: bool,
    pub attempt_bucket: AttemptBucket,
}

impl RoundFinishFacts {
    fn into_parts(self) -> (Vec<Attribute>, SpanStatus, Severity) {
        completion_attributes(
            self.completion,
            "bitfun.agent.round.outcome",
            vec![
                Attribute::boolean("bitfun.agent.round.has_tool_calls", self.has_tool_calls),
                Attribute::enumeration(
                    "bitfun.agent.round.attempt.index_bucket",
                    self.attempt_bucket.as_str(),
                ),
            ],
        )
    }
}

observation!(RoundObservation, RoundFinishFacts);

pub fn start_round(
    telemetry: &Telemetry,
    facts: RoundStartFacts,
    parent: Option<ObservationContext>,
) -> RoundObservation {
    RoundObservation(telemetry.start_operation(
        OperationKind::Round,
        || {
            vec![
                Attribute::enumeration(
                    "bitfun.agent.round.index_bucket",
                    facts.index_bucket.as_str(),
                ),
                Attribute::boolean("bitfun.agent.round.subagent", facts.subagent),
            ]
        },
        parent,
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InferenceStartFacts {
    pub provider_class: ProviderClass,
    pub model_class: ModelClass,
    pub protocol_class: InferenceProtocolClass,
    pub context_class: InferenceContextClass,
    pub auth_class: Option<InferenceAuthClass>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct InferenceRequestFacts {
    pub message_count: Option<u64>,
    pub tool_count: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InferenceFinishFacts {
    pub completion: CompletionFacts,
    pub attempt_bucket: AttemptBucket,
    pub status_class: Option<StatusClass>,
    pub retryable: Option<bool>,
    pub ttft_ms: Option<u64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
    pub cache_read_tokens: Option<u64>,
    pub cache_creation_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
    pub context_window_tokens: Option<u64>,
    pub tool_definition_tokens_estimate: Option<u64>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct InferenceResponseFacts {
    pub finish_reason: Option<FinishReasonClass>,
    pub has_tool_calls: Option<bool>,
    pub output_length: Option<u64>,
    pub reasoning_length: Option<u64>,
    pub output_line_count: Option<u64>,
    pub reasoning_present: Option<bool>,
    pub reasoning_first_ms: Option<u64>,
    pub reasoning_duration_ms: Option<u64>,
    pub stream_outcome: Option<InferenceStreamOutcomeClass>,
    pub tool_argument_recovery: Option<ToolArgumentRecoveryClass>,
}

impl InferenceFinishFacts {
    fn into_parts(self) -> (Vec<Attribute>, SpanStatus, Severity) {
        let mut attributes = vec![Attribute::enumeration(
            "bitfun.inference.attempt.index_bucket",
            self.attempt_bucket.as_str(),
        )];
        if let Some(status_class) = self.status_class {
            attributes.push(Attribute::enumeration(
                "bitfun.inference.request.http_status_class",
                status_class.as_str(),
            ));
        }
        if let Some(retryable) = self.retryable {
            attributes.push(Attribute::boolean(
                "bitfun.inference.request.retryable",
                retryable,
            ));
        }
        for (key, value) in [
            ("bitfun.inference.usage.input_tokens", self.input_tokens),
            ("bitfun.inference.usage.output_tokens", self.output_tokens),
            (
                "bitfun.inference.usage.reasoning_tokens",
                self.reasoning_tokens,
            ),
            (
                "bitfun.inference.usage.cache_read_tokens",
                self.cache_read_tokens,
            ),
            (
                "bitfun.inference.usage.cache_creation_tokens",
                self.cache_creation_tokens,
            ),
            ("bitfun.inference.usage.total_tokens", self.total_tokens),
            (
                "bitfun.inference.request.context_window_tokens",
                self.context_window_tokens,
            ),
            (
                "bitfun.inference.request.tool_definition_tokens_estimate",
                self.tool_definition_tokens_estimate,
            ),
        ] {
            if let Some(value) = value {
                attributes.push(Attribute::u64(key, value));
            }
        }
        if let Some(ttft_ms) = self.ttft_ms {
            attributes.push(Attribute::u64("bitfun.inference.request.ttft_ms", ttft_ms));
        }
        completion_attributes(
            self.completion,
            "bitfun.inference.request.outcome",
            attributes,
        )
    }
}

observation!(InferenceObservation, InferenceFinishFacts);

impl InferenceObservation {
    pub fn finish_with_response_facts(
        self,
        facts: InferenceFinishFacts,
        response: InferenceResponseFacts,
    ) {
        let (mut attributes, status, severity) = facts.into_parts();
        if let Some(finish_reason) = response.finish_reason {
            attributes.push(Attribute::enumeration(
                "bitfun.inference.response.finish_reason",
                finish_reason.as_str(),
            ));
        }
        for (key, value) in [
            (
                "bitfun.inference.response.has_tool_calls",
                response.has_tool_calls,
            ),
            (
                "bitfun.inference.response.reasoning_present",
                response.reasoning_present,
            ),
        ] {
            if let Some(value) = value {
                attributes.push(Attribute::boolean(key, value));
            }
        }
        for (key, value) in [
            (
                "bitfun.inference.response.output_length",
                response.output_length,
            ),
            (
                "bitfun.inference.response.reasoning_length",
                response.reasoning_length,
            ),
            (
                "bitfun.inference.response.output_line_count",
                response.output_line_count,
            ),
            (
                "bitfun.inference.response.reasoning_first_ms",
                response.reasoning_first_ms,
            ),
            (
                "bitfun.inference.response.reasoning_duration_ms",
                response.reasoning_duration_ms,
            ),
        ] {
            if let Some(value) = value {
                attributes.push(Attribute::u64(key, value));
            }
        }
        if let Some(stream_outcome) = response.stream_outcome {
            attributes.push(Attribute::enumeration(
                "bitfun.inference.response.stream_outcome",
                stream_outcome.as_str(),
            ));
        }
        if let Some(recovery) = response.tool_argument_recovery {
            attributes.push(Attribute::enumeration(
                "bitfun.inference.response.tool_argument_recovery",
                recovery.as_str(),
            ));
        }
        self.0.finish_terminal(attributes, status, severity);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InferenceAttemptStartFacts {
    pub attempt_bucket: AttemptBucket,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InferenceAttemptFinishFacts {
    pub completion: CompletionFacts,
    pub status_class: Option<StatusClass>,
    pub retryable: Option<bool>,
    pub ttft_ms: Option<u64>,
    pub stream_outcome: Option<InferenceStreamOutcomeClass>,
    pub tool_argument_recovery: Option<ToolArgumentRecoveryClass>,
}

impl InferenceAttemptFinishFacts {
    fn into_parts(self) -> (Vec<Attribute>, SpanStatus, Severity) {
        let mut attributes = Vec::new();
        if let Some(status_class) = self.status_class {
            attributes.push(Attribute::enumeration(
                "bitfun.inference.attempt.http_status_class",
                status_class.as_str(),
            ));
        }
        if let Some(retryable) = self.retryable {
            attributes.push(Attribute::boolean(
                "bitfun.inference.attempt.retryable",
                retryable,
            ));
        }
        if let Some(ttft_ms) = self.ttft_ms {
            attributes.push(Attribute::u64("bitfun.inference.attempt.ttft_ms", ttft_ms));
        }
        if let Some(stream_outcome) = self.stream_outcome {
            attributes.push(Attribute::enumeration(
                "bitfun.inference.attempt.stream_outcome",
                stream_outcome.as_str(),
            ));
        }
        if let Some(recovery) = self.tool_argument_recovery {
            attributes.push(Attribute::enumeration(
                "bitfun.inference.attempt.tool_argument_recovery",
                recovery.as_str(),
            ));
        }
        completion_attributes(
            self.completion,
            "bitfun.inference.attempt.outcome",
            attributes,
        )
    }
}

observation!(InferenceAttemptObservation, InferenceAttemptFinishFacts);

pub fn start_inference_attempt(
    telemetry: &Telemetry,
    facts: InferenceAttemptStartFacts,
    parent: Option<ObservationContext>,
) -> InferenceAttemptObservation {
    InferenceAttemptObservation(telemetry.start_operation(
        OperationKind::InferenceAttempt,
        || {
            vec![Attribute::enumeration(
                "bitfun.inference.attempt.index_bucket",
                facts.attempt_bucket.as_str(),
            )]
        },
        parent,
    ))
}

pub fn start_inference(
    telemetry: &Telemetry,
    facts: InferenceStartFacts,
    parent: Option<ObservationContext>,
) -> InferenceObservation {
    InferenceObservation(telemetry.start_operation(
        OperationKind::Inference,
        || {
            vec![
                Attribute::enumeration(
                    "bitfun.inference.provider_class",
                    facts.provider_class.as_str(),
                ),
                Attribute::enumeration("bitfun.inference.model_class", facts.model_class.as_str()),
                Attribute::enumeration(
                    "bitfun.inference.protocol_class",
                    facts.protocol_class.as_str(),
                ),
                Attribute::enumeration(
                    "bitfun.inference.context_class",
                    facts.context_class.as_str(),
                ),
            ]
            .into_iter()
            .chain(facts.auth_class.map(|auth_class| {
                Attribute::enumeration("bitfun.inference.auth_class", auth_class.as_str())
            }))
            .collect::<Vec<_>>()
        },
        parent,
    ))
}

pub fn start_inference_with_request_facts(
    telemetry: &Telemetry,
    facts: InferenceStartFacts,
    request: InferenceRequestFacts,
    parent: Option<ObservationContext>,
) -> InferenceObservation {
    InferenceObservation(telemetry.start_operation(
        OperationKind::Inference,
        || {
            let mut attributes = vec![
                Attribute::enumeration(
                    "bitfun.inference.provider_class",
                    facts.provider_class.as_str(),
                ),
                Attribute::enumeration("bitfun.inference.model_class", facts.model_class.as_str()),
                Attribute::enumeration(
                    "bitfun.inference.protocol_class",
                    facts.protocol_class.as_str(),
                ),
                Attribute::enumeration(
                    "bitfun.inference.context_class",
                    facts.context_class.as_str(),
                ),
            ];
            if let Some(auth_class) = facts.auth_class {
                attributes.push(Attribute::enumeration(
                    "bitfun.inference.auth_class",
                    auth_class.as_str(),
                ));
            }
            if let Some(message_count) = request.message_count {
                attributes.push(Attribute::u64(
                    "bitfun.inference.request.message_count",
                    message_count,
                ));
            }
            if let Some(tool_count) = request.tool_count {
                attributes.push(Attribute::u64(
                    "bitfun.inference.request.tool_count",
                    tool_count,
                ));
            }
            attributes
        },
        parent,
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InferenceUsageFacts {
    pub provider_class: ProviderClass,
    pub model_class: ModelClass,
    pub subagent: bool,
    pub input_tokens: u64,
    pub output_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
    pub cache_read_tokens: Option<u64>,
    pub cache_creation_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}

pub fn record_inference_usage(telemetry: &Telemetry, facts: InferenceUsageFacts) {
    if !telemetry.accepts_terminal_projection() {
        return;
    }
    let attributes = || {
        vec![
            Attribute::enumeration(
                "bitfun.inference.provider_class",
                facts.provider_class.as_str(),
            ),
            Attribute::enumeration("bitfun.inference.model_class", facts.model_class.as_str()),
            Attribute::boolean("bitfun.agent.turn.subagent", facts.subagent),
        ]
    };
    telemetry.record_token_metric(TokenMetricKind::Input, facts.input_tokens, attributes());
    if let Some(output_tokens) = facts.output_tokens {
        telemetry.record_token_metric(TokenMetricKind::Output, output_tokens, attributes());
    }
    if let Some(reasoning_tokens) = facts.reasoning_tokens {
        telemetry.record_token_metric(TokenMetricKind::Reasoning, reasoning_tokens, attributes());
    }
    if let Some(cache_read_tokens) = facts.cache_read_tokens {
        telemetry.record_token_metric(TokenMetricKind::CacheRead, cache_read_tokens, attributes());
    }
    if let Some(cache_creation_tokens) = facts.cache_creation_tokens {
        telemetry.record_token_metric(
            TokenMetricKind::CacheCreation,
            cache_creation_tokens,
            attributes(),
        );
    }
    if let Some(total_tokens) = facts.total_tokens {
        telemetry.record_token_metric(TokenMetricKind::Total, total_tokens, attributes());
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolStartFacts {
    pub tool_class: ToolClass,
    pub source_class: ToolSourceClass,
    pub tool_kind: ToolKind,
    pub parallel: bool,
    pub remote: bool,
    pub background: bool,
    pub argument_state: ToolArgumentState,
    pub arguments_truncated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolFinishFacts {
    pub completion: CompletionFacts,
    pub queue_ms: Option<u64>,
    pub preflight_ms: Option<u64>,
    pub confirmation_ms: Option<u64>,
    pub execution_ms: Option<u64>,
    pub failure_source: Option<ToolFailureSource>,
    pub exit_status_class: Option<ExitStatusClass>,
    pub content_length: Option<u64>,
    pub content_truncated: Option<bool>,
    pub retryable: Option<bool>,
    pub programming_language: Option<ProgrammingLanguageClass>,
}

impl ToolFinishFacts {
    fn into_parts(self) -> (Vec<Attribute>, SpanStatus, Severity) {
        let mut attributes = Vec::new();
        if let Some(queue_ms) = self.queue_ms {
            attributes.push(Attribute::u64("bitfun.tool.execute.queue_ms", queue_ms));
        }
        if let Some(preflight_ms) = self.preflight_ms {
            attributes.push(Attribute::u64(
                "bitfun.tool.execute.preflight_ms",
                preflight_ms,
            ));
        }
        if let Some(confirmation_ms) = self.confirmation_ms {
            attributes.push(Attribute::u64(
                "bitfun.tool.execute.confirmation_ms",
                confirmation_ms,
            ));
        }
        if let Some(execution_ms) = self.execution_ms {
            attributes.push(Attribute::u64(
                "bitfun.tool.execute.execution_ms",
                execution_ms,
            ));
        }
        if let Some(failure_source) = self.failure_source {
            attributes.push(Attribute::enumeration(
                "bitfun.tool.execute.failure_source",
                failure_source.as_str(),
            ));
        }
        if let Some(exit_status_class) = self.exit_status_class {
            attributes.push(Attribute::enumeration(
                "bitfun.tool.execute.exit_status_class",
                exit_status_class.as_str(),
            ));
        }
        if let Some(content_length) = self.content_length {
            attributes.push(Attribute::u64("bitfun.tool.content.length", content_length));
        }
        if let Some(content_truncated) = self.content_truncated {
            attributes.push(Attribute::boolean(
                "bitfun.tool.content.truncated",
                content_truncated,
            ));
        }
        if let Some(retryable) = self.retryable {
            attributes.push(Attribute::boolean(
                "bitfun.tool.execute.retryable",
                retryable,
            ));
        }
        if let Some(language) = self.programming_language {
            attributes.push(Attribute::enumeration(
                "bitfun.tool.programming_language",
                language.as_str(),
            ));
        }
        completion_attributes(self.completion, "bitfun.tool.execute.outcome", attributes)
    }
}

observation!(ToolObservation, ToolFinishFacts);

pub fn start_tool(
    telemetry: &Telemetry,
    facts: ToolStartFacts,
    parent: Option<ObservationContext>,
) -> ToolObservation {
    ToolObservation(telemetry.start_operation(
        OperationKind::Tool,
        || {
            vec![
                Attribute::enumeration("bitfun.tool.class", facts.tool_class.as_str()),
                Attribute::enumeration("bitfun.tool.source_class", facts.source_class.as_str()),
                Attribute::enumeration("bitfun.tool.kind", facts.tool_kind.as_str()),
                Attribute::boolean("bitfun.tool.execute.parallel", facts.parallel),
                Attribute::boolean("bitfun.tool.execute.remote", facts.remote),
                Attribute::boolean("bitfun.tool.execute.background", facts.background),
                Attribute::enumeration(
                    "bitfun.tool.arguments.state",
                    facts.argument_state.as_str(),
                ),
                Attribute::boolean("bitfun.tool.arguments.truncated", facts.arguments_truncated),
            ]
        },
        parent,
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PermissionEvaluateStartFacts {
    pub intent_count_bucket: CountBucket,
    pub delegated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PermissionFinishFacts {
    pub completion: CompletionFacts,
    pub decision: PermissionDecision,
    pub source: PermissionSource,
}

impl PermissionFinishFacts {
    fn evaluation_parts(self) -> (Vec<Attribute>, SpanStatus, Severity) {
        completion_attributes(
            self.completion,
            "bitfun.permission.evaluate.outcome",
            vec![
                Attribute::enumeration(
                    "bitfun.permission.evaluate.decision",
                    self.decision.as_str(),
                ),
                Attribute::enumeration("bitfun.permission.evaluate.source", self.source.as_str()),
            ],
        )
    }

    fn confirmation_parts(self) -> (Vec<Attribute>, SpanStatus, Severity) {
        completion_attributes(
            self.completion,
            "bitfun.permission.confirmation.outcome",
            vec![
                Attribute::enumeration(
                    "bitfun.permission.confirmation.decision",
                    self.decision.as_str(),
                ),
                Attribute::enumeration(
                    "bitfun.permission.confirmation.source",
                    self.source.as_str(),
                ),
            ],
        )
    }
}

#[derive(Debug)]
pub struct PermissionEvaluationObservation(TelemetrySpan);

impl PermissionEvaluationObservation {
    pub fn context(&self) -> Option<ObservationContext> {
        self.0.context()
    }

    pub fn finish(self, facts: PermissionFinishFacts) {
        let (attributes, status, severity) = facts.evaluation_parts();
        self.0.finish_terminal(attributes, status, severity);
    }
}

pub fn start_permission_evaluation(
    telemetry: &Telemetry,
    facts: PermissionEvaluateStartFacts,
    parent: Option<ObservationContext>,
) -> PermissionEvaluationObservation {
    PermissionEvaluationObservation(telemetry.start_operation(
        OperationKind::PermissionEvaluate,
        || {
            vec![
                Attribute::enumeration(
                    "bitfun.permission.evaluate.intent_count_bucket",
                    facts.intent_count_bucket.as_str(),
                ),
                Attribute::boolean("bitfun.permission.evaluate.delegated", facts.delegated),
            ]
        },
        parent,
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PermissionConfirmationStartFacts {
    pub request_count_bucket: CountBucket,
    pub auto_approve: bool,
    pub ui_surface: Option<PermissionUiSurface>,
}

#[derive(Debug)]
pub struct PermissionConfirmationObservation(TelemetrySpan);

impl PermissionConfirmationObservation {
    pub fn context(&self) -> Option<ObservationContext> {
        self.0.context()
    }

    pub fn finish(self, facts: PermissionFinishFacts) {
        let (attributes, status, severity) = facts.confirmation_parts();
        self.0.finish_terminal(attributes, status, severity);
    }
}

pub fn start_permission_confirmation(
    telemetry: &Telemetry,
    facts: PermissionConfirmationStartFacts,
    parent: Option<ObservationContext>,
) -> PermissionConfirmationObservation {
    PermissionConfirmationObservation(telemetry.start_operation(
        OperationKind::PermissionConfirmation,
        || {
            let mut attributes = vec![
                Attribute::enumeration(
                    "bitfun.permission.confirmation.request_count_bucket",
                    facts.request_count_bucket.as_str(),
                ),
                Attribute::boolean(
                    "bitfun.permission.confirmation.auto_approve",
                    facts.auto_approve,
                ),
            ];
            if let Some(ui_surface) = facts.ui_surface {
                attributes.push(Attribute::enumeration(
                    "bitfun.permission.confirmation.ui_surface",
                    ui_surface.as_str(),
                ));
            }
            attributes
        },
        parent,
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CompressionStartFacts {
    pub trigger: CompressionTrigger,
    pub threshold_tokens: Option<u64>,
    pub turns_since_last_compression: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CompressionFinishFacts {
    pub completion: CompletionFacts,
    pub source: Option<CompressionSource>,
    pub has_summary: Option<bool>,
    pub tokens_before: Option<u64>,
    pub tokens_after_estimate: Option<u64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
    pub cache_read_tokens: Option<u64>,
    pub cache_creation_tokens: Option<u64>,
}

impl CompressionFinishFacts {
    fn into_parts(self) -> (Vec<Attribute>, SpanStatus, Severity) {
        let mut attributes = Vec::new();
        if let Some(source) = self.source {
            attributes.push(Attribute::enumeration(
                "bitfun.agent.compression.source",
                source.as_str(),
            ));
        }
        if let Some(has_summary) = self.has_summary {
            attributes.push(Attribute::boolean(
                "bitfun.agent.compression.has_summary",
                has_summary,
            ));
        }
        if let Some(tokens_before) = self.tokens_before {
            attributes.push(Attribute::u64(
                "bitfun.agent.compression.tokens_before",
                tokens_before,
            ));
        }
        if let Some(tokens_after) = self.tokens_after_estimate {
            attributes.push(Attribute::u64(
                "bitfun.agent.compression.tokens_after_estimate",
                tokens_after,
            ));
        }
        for (key, value) in [
            (
                "bitfun.agent.compression.usage.input_tokens",
                self.input_tokens,
            ),
            (
                "bitfun.agent.compression.usage.output_tokens",
                self.output_tokens,
            ),
            (
                "bitfun.agent.compression.usage.total_tokens",
                self.total_tokens,
            ),
            (
                "bitfun.agent.compression.usage.cache_read_tokens",
                self.cache_read_tokens,
            ),
            (
                "bitfun.agent.compression.usage.cache_creation_tokens",
                self.cache_creation_tokens,
            ),
        ] {
            if let Some(value) = value {
                attributes.push(Attribute::u64(key, value));
            }
        }
        completion_attributes(
            self.completion,
            "bitfun.agent.compression.outcome",
            attributes,
        )
    }
}

observation!(CompressionObservation, CompressionFinishFacts);

pub fn start_compression(
    telemetry: &Telemetry,
    facts: CompressionStartFacts,
    parent: Option<ObservationContext>,
) -> CompressionObservation {
    CompressionObservation(telemetry.start_operation(
        OperationKind::Compression,
        || {
            let mut attributes = vec![Attribute::enumeration(
                "bitfun.agent.compression.trigger",
                facts.trigger.as_str(),
            )];
            if let Some(threshold_tokens) = facts.threshold_tokens {
                attributes.push(Attribute::u64(
                    "bitfun.agent.compression.threshold_tokens",
                    threshold_tokens,
                ));
            }
            if let Some(turns_since_last_compression) = facts.turns_since_last_compression {
                attributes.push(Attribute::u64(
                    "bitfun.agent.compression.turns_since_last",
                    turns_since_last_compression,
                ));
            }
            attributes
        },
        parent,
    ))
}

pub const fn index_bucket(index: usize) -> IndexBucket {
    match index.saturating_add(1) {
        1 => IndexBucket::One,
        2 => IndexBucket::Two,
        3..=5 => IndexBucket::ThreeToFive,
        6..=10 => IndexBucket::SixToTen,
        _ => IndexBucket::ElevenPlus,
    }
}

pub const fn attempt_bucket(attempts: u32) -> AttemptBucket {
    match attempts {
        0 | 1 => AttemptBucket::One,
        2 => AttemptBucket::Two,
        _ => AttemptBucket::ThreePlus,
    }
}

pub const fn count_bucket(count: usize) -> CountBucket {
    match count {
        0 => CountBucket::Zero,
        1 => CountBucket::One,
        2 => CountBucket::Two,
        _ => CountBucket::ThreePlus,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AttributeValue, InMemorySink, PolicySnapshot, TelemetryLevel, ValidatedRecord};
    use std::sync::Arc;

    fn enum_attribute<'a>(record: &'a ValidatedRecord, key: &str) -> Option<&'a str> {
        record
            .attributes()
            .iter()
            .find(|attribute| attribute.key() == key)
            .and_then(|attribute| match attribute.value() {
                AttributeValue::Enum(value) => Some(*value),
                _ => None,
            })
    }

    fn u64_attribute(record: &ValidatedRecord, key: &str) -> Option<u64> {
        record
            .attributes()
            .iter()
            .find(|attribute| attribute.key() == key)
            .and_then(|attribute| match attribute.value() {
                AttributeValue::U64(value) => Some(*value),
                _ => None,
            })
    }

    #[test]
    fn slash_command_is_safe_typed_telemetry_not_debug_content() {
        let sink = Arc::new(InMemorySink::default());
        let (telemetry, _) = Telemetry::build(
            PolicySnapshot::new(TelemetryLevel::Basic).with_success_log_sample_ratio(1.0),
            sink.clone(),
        );

        record_slash_command(
            &telemetry,
            SlashCommandFacts {
                command_class: SlashCommandClass::Workspace,
                source: SlashCommandSource::BuiltIn,
                has_arguments: true,
            },
        );

        let records = sink.records();
        assert_eq!(records.len(), 2);
        assert!(sink.debug_records().is_empty());
        let encoded = serde_json::to_string(&records).unwrap();
        assert!(encoded.contains("bitfun.agent.slash_command"));
        assert!(encoded.contains("workspace"));
        assert!(!encoded.contains("command_text"));
        assert!(!encoded.contains("arguments_text"));
    }

    #[test]
    fn owner_finish_emits_trace_and_one_terminal_projection() {
        let sink = Arc::new(InMemorySink::default());
        let (telemetry, _) = Telemetry::build(
            PolicySnapshot::new(TelemetryLevel::Diagnostic)
                .with_trace_sample_ratio(1.0)
                .with_success_log_sample_ratio(1.0),
            sink.clone(),
        );
        start_turn(
            &telemetry,
            TurnStartFacts {
                mode_class: AgentModeClass::Agentic,
                trigger: TurnTrigger::User,
                remote: false,
                subagent: false,
            },
            None,
        )
        .finish(TurnFinishFacts {
            completion: CompletionFacts::completed(),
            finish_reason: Some(FinishReasonClass::Completed),
            round_count: Some(1),
            tool_count: Some(0),
            first_result_ms: None,
            modified_file_count: None,
            added_lines: None,
            deleted_lines: None,
        });
        let records = sink.records();
        assert_eq!(records.len(), 4);
        assert_eq!(
            records
                .iter()
                .filter(|record| matches!(record, ValidatedRecord::Span(_)))
                .count(),
            1
        );
        assert_eq!(
            records
                .iter()
                .filter(|record| matches!(record, ValidatedRecord::Metric(_)))
                .count(),
            2
        );
        assert_eq!(
            records
                .iter()
                .filter(|record| matches!(record, ValidatedRecord::Log(_)))
                .count(),
            1
        );
    }

    #[test]
    fn owner_finish_preserves_inference_classes_and_error_type_across_signals() {
        let sink = Arc::new(InMemorySink::default());
        let (telemetry, _) = Telemetry::build(
            PolicySnapshot::new(TelemetryLevel::Diagnostic)
                .with_trace_sample_ratio(1.0)
                .with_success_log_sample_ratio(1.0),
            sink.clone(),
        );
        start_inference(
            &telemetry,
            InferenceStartFacts {
                provider_class: ProviderClass::AnthropicCompatible,
                model_class: ModelClass::Code,
                protocol_class: InferenceProtocolClass::Messages,
                context_class: InferenceContextClass::Turn,
                auth_class: Some(InferenceAuthClass::ApiKey),
            },
            None,
        )
        .finish(InferenceFinishFacts {
            completion: CompletionFacts::failed(SafeErrorType::RateLimited),
            attempt_bucket: AttemptBucket::Two,
            status_class: Some(StatusClass::ClientError),
            retryable: Some(true),
            ttft_ms: None,
            input_tokens: Some(10),
            output_tokens: Some(5),
            reasoning_tokens: None,
            cache_read_tokens: None,
            cache_creation_tokens: Some(2),
            total_tokens: Some(17),
            context_window_tokens: Some(128_000),
            tool_definition_tokens_estimate: Some(7),
        });

        let records = sink.records();
        assert_eq!(records.len(), 4);
        for record in &records {
            assert_eq!(enum_attribute(record, "error.type"), Some("rate_limited"));
            assert_eq!(
                enum_attribute(record, "bitfun.inference.provider_class"),
                Some("anthropic_compatible")
            );
            assert_eq!(
                enum_attribute(record, "bitfun.inference.model_class"),
                Some("code")
            );
        }
        for record in records
            .iter()
            .filter(|record| matches!(record, ValidatedRecord::Span(_) | ValidatedRecord::Log(_)))
        {
            assert_eq!(
                enum_attribute(record, "bitfun.inference.protocol_class"),
                Some("messages")
            );
        }
        assert!(records.iter().any(|record| {
            u64_attribute(record, "bitfun.inference.usage.total_tokens") == Some(17)
        }));
        assert!(records.iter().any(|record| {
            u64_attribute(record, "bitfun.inference.usage.cache_creation_tokens") == Some(2)
        }));
        assert!(records.iter().any(|record| {
            u64_attribute(record, "bitfun.inference.request.context_window_tokens") == Some(128_000)
        }));
        assert!(records.iter().any(|record| {
            u64_attribute(
                record,
                "bitfun.inference.request.tool_definition_tokens_estimate",
            ) == Some(7)
        }));
    }

    #[test]
    fn terminal_log_uses_owner_span_context_only_when_trace_exists() {
        let diagnostic_sink = Arc::new(InMemorySink::default());
        let (diagnostic, _) = Telemetry::build(
            PolicySnapshot::new(TelemetryLevel::Diagnostic)
                .with_trace_sample_ratio(1.0)
                .with_success_log_sample_ratio(1.0),
            diagnostic_sink.clone(),
        );
        let observation = start_turn(
            &diagnostic,
            TurnStartFacts {
                mode_class: AgentModeClass::Agentic,
                trigger: TurnTrigger::User,
                remote: false,
                subagent: false,
            },
            None,
        );
        let expected = observation.context().unwrap().span_context();
        observation.finish(TurnFinishFacts {
            completion: CompletionFacts::completed(),
            finish_reason: Some(FinishReasonClass::Completed),
            round_count: Some(1),
            tool_count: Some(0),
            first_result_ms: None,
            modified_file_count: None,
            added_lines: None,
            deleted_lines: None,
        });
        let diagnostic_records = diagnostic_sink.records();
        let span = diagnostic_records
            .iter()
            .find_map(|record| match record {
                ValidatedRecord::Span(span) => Some(span),
                _ => None,
            })
            .expect("turn span");
        let log = diagnostic_records
            .iter()
            .find_map(|record| match record {
                ValidatedRecord::Log(log) => Some(log),
                _ => None,
            })
            .expect("turn terminal log");
        assert_eq!(span.context(), expected);
        assert_eq!(log.span_context(), Some(expected));

        let basic_sink = Arc::new(InMemorySink::default());
        let (basic, _) = Telemetry::build(
            PolicySnapshot::new(TelemetryLevel::Basic).with_success_log_sample_ratio(1.0),
            basic_sink.clone(),
        );
        let observation = start_turn(
            &basic,
            TurnStartFacts {
                mode_class: AgentModeClass::Other,
                trigger: TurnTrigger::User,
                remote: false,
                subagent: false,
            },
            None,
        );
        assert!(observation.context().is_none());
        observation.finish(TurnFinishFacts {
            completion: CompletionFacts::failed(SafeErrorType::Timeout),
            finish_reason: Some(FinishReasonClass::Error),
            round_count: None,
            tool_count: None,
            first_result_ms: None,
            modified_file_count: None,
            added_lines: None,
            deleted_lines: None,
        });
        let basic_records = basic_sink.records();
        assert!(basic_records
            .iter()
            .all(|record| !matches!(record, ValidatedRecord::Span(_))));
        for record in &basic_records {
            assert_eq!(enum_attribute(record, "error.type"), Some("timeout"));
        }
        let log = basic_records
            .iter()
            .find_map(|record| match record {
                ValidatedRecord::Log(log) => Some(log),
                _ => None,
            })
            .expect("basic terminal log");
        assert_eq!(log.span_context(), None);
    }

    #[test]
    fn explicit_context_builds_parent_child_spans_without_business_ids() {
        let sink = Arc::new(InMemorySink::default());
        let (telemetry, _) = Telemetry::build(
            PolicySnapshot::new(TelemetryLevel::Diagnostic).with_trace_sample_ratio(1.0),
            sink.clone(),
        );
        let turn = start_turn(
            &telemetry,
            TurnStartFacts {
                mode_class: AgentModeClass::Agentic,
                trigger: TurnTrigger::User,
                remote: false,
                subagent: false,
            },
            None,
        );
        let turn_context = turn.context().unwrap();
        let round = start_round(
            &telemetry,
            RoundStartFacts {
                index_bucket: IndexBucket::One,
                subagent: false,
            },
            Some(turn_context.clone()),
        );
        round.finish(RoundFinishFacts {
            completion: CompletionFacts::completed(),
            has_tool_calls: false,
            attempt_bucket: AttemptBucket::One,
        });
        turn.finish(TurnFinishFacts {
            completion: CompletionFacts::completed(),
            finish_reason: Some(FinishReasonClass::Completed),
            round_count: Some(1),
            tool_count: Some(0),
            first_result_ms: None,
            modified_file_count: None,
            added_lines: None,
            deleted_lines: None,
        });

        let records = sink.records();
        let spans = records
            .iter()
            .filter_map(|record| match record {
                ValidatedRecord::Span(span) => Some(span),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(spans.len(), 2);
        let round_span = spans
            .iter()
            .find(|span| span.name() == "bitfun.agent.round")
            .unwrap();
        assert_eq!(
            round_span.parent_span_id(),
            Some(turn_context.span_context().span_id())
        );
        assert_eq!(
            round_span.context().trace_id(),
            turn_context.span_context().trace_id()
        );
    }

    #[test]
    fn terminal_projection_emits_metrics_and_fixed_log_without_trace() {
        let sink = Arc::new(InMemorySink::default());
        let (telemetry, _) = Telemetry::build(
            PolicySnapshot::new(TelemetryLevel::Basic).with_success_log_sample_ratio(1.0),
            sink.clone(),
        );
        start_tool(
            &telemetry,
            ToolStartFacts {
                tool_class: ToolClass::BuiltIn,
                source_class: ToolSourceClass::BuiltIn,
                tool_kind: ToolKind::Filesystem,
                parallel: false,
                remote: false,
                background: false,
                argument_state: ToolArgumentState::Unchanged,
                arguments_truncated: false,
            },
            None,
        )
        .finish(ToolFinishFacts {
            completion: CompletionFacts::completed(),
            queue_ms: Some(2),
            preflight_ms: Some(3),
            confirmation_ms: None,
            execution_ms: Some(5),
            failure_source: None,
            exit_status_class: Some(ExitStatusClass::Success),
            content_length: Some(0),
            content_truncated: Some(false),
            retryable: None,
            programming_language: None,
        });
        let records = sink.records();
        assert_eq!(records.len(), 3);
        assert_eq!(
            records
                .iter()
                .filter(|record| matches!(record, ValidatedRecord::Span(_)))
                .count(),
            0
        );
        let encoded = serde_json::to_string(&records).unwrap();
        for forbidden in [
            "prompt_text",
            "arguments_text",
            "result_content",
            "workspace_path",
            "session_id",
            "user_id",
        ] {
            assert!(!encoded.contains(forbidden));
        }
    }

    #[test]
    fn switching_off_discards_pending_records_and_invalidates_active_spans() {
        let sink = Arc::new(InMemorySink::default());
        let (telemetry, control) = Telemetry::build(
            PolicySnapshot::new(TelemetryLevel::Diagnostic)
                .with_trace_sample_ratio(1.0)
                .with_success_log_sample_ratio(1.0),
            sink.clone(),
        );
        let turn = start_turn(
            &telemetry,
            TurnStartFacts {
                mode_class: AgentModeClass::Agentic,
                trigger: TurnTrigger::User,
                remote: false,
                subagent: false,
            },
            None,
        );
        start_startup(&telemetry).finish(StartupFinishFacts {
            completion: CompletionFacts::completed(),
        });
        assert!(!sink.is_empty());

        control.apply(PolicySnapshot::new(TelemetryLevel::Off));
        assert!(sink.is_empty());
        turn.finish(TurnFinishFacts {
            completion: CompletionFacts::completed(),
            finish_reason: Some(FinishReasonClass::Completed),
            round_count: Some(1),
            tool_count: Some(0),
            first_result_ms: Some(1),
            modified_file_count: Some(0),
            added_lines: Some(0),
            deleted_lines: Some(0),
        });
        start_startup(&telemetry).finish(StartupFinishFacts {
            completion: CompletionFacts::completed(),
        });

        assert!(sink.is_empty());
        assert!(!telemetry.is_enabled());
    }

    #[test]
    fn full_agent_topology_uses_explicit_parent_contexts() {
        let sink = Arc::new(InMemorySink::default());
        let (telemetry, _) = Telemetry::build(
            PolicySnapshot::new(TelemetryLevel::Diagnostic).with_trace_sample_ratio(1.0),
            sink.clone(),
        );
        let turn = start_turn(
            &telemetry,
            TurnStartFacts {
                mode_class: AgentModeClass::Agentic,
                trigger: TurnTrigger::User,
                remote: false,
                subagent: false,
            },
            None,
        );
        let turn_context = turn.context().unwrap();
        let round = start_round(
            &telemetry,
            RoundStartFacts {
                index_bucket: IndexBucket::One,
                subagent: false,
            },
            Some(turn_context.clone()),
        );
        let round_context = round.context().unwrap();
        let inference = start_inference(
            &telemetry,
            InferenceStartFacts {
                provider_class: ProviderClass::OpenAiCompatible,
                model_class: ModelClass::Code,
                protocol_class: InferenceProtocolClass::Responses,
                context_class: InferenceContextClass::Turn,
                auth_class: Some(InferenceAuthClass::Subscription),
            },
            Some(round_context.clone()),
        );
        let inference_context = inference.context().unwrap();
        let attempt = start_inference_attempt(
            &telemetry,
            InferenceAttemptStartFacts {
                attempt_bucket: AttemptBucket::One,
            },
            Some(inference_context.clone()),
        );
        attempt.finish(InferenceAttemptFinishFacts {
            completion: CompletionFacts::completed(),
            status_class: Some(StatusClass::Success),
            retryable: Some(false),
            ttft_ms: Some(3),
            stream_outcome: Some(InferenceStreamOutcomeClass::Complete),
            tool_argument_recovery: None,
        });
        inference.finish(InferenceFinishFacts {
            completion: CompletionFacts::completed(),
            attempt_bucket: AttemptBucket::One,
            status_class: Some(StatusClass::Success),
            retryable: Some(false),
            ttft_ms: Some(3),
            input_tokens: Some(10),
            output_tokens: Some(5),
            reasoning_tokens: Some(2),
            cache_read_tokens: Some(1),
            cache_creation_tokens: Some(1),
            total_tokens: Some(19),
            context_window_tokens: Some(128_000),
            tool_definition_tokens_estimate: Some(4),
        });

        let tool = start_tool(
            &telemetry,
            ToolStartFacts {
                tool_class: ToolClass::Custom,
                source_class: ToolSourceClass::Mcp,
                tool_kind: ToolKind::Protocol,
                parallel: false,
                remote: false,
                background: false,
                argument_state: ToolArgumentState::Unchanged,
                arguments_truncated: false,
            },
            Some(round_context.clone()),
        );
        let tool_context = tool.context().unwrap();
        let evaluation = start_permission_evaluation(
            &telemetry,
            PermissionEvaluateStartFacts {
                intent_count_bucket: CountBucket::One,
                delegated: false,
            },
            Some(tool_context.clone()),
        );
        evaluation.finish(PermissionFinishFacts {
            completion: CompletionFacts::completed(),
            decision: PermissionDecision::Ask,
            source: PermissionSource::Policy,
        });
        let confirmation = start_permission_confirmation(
            &telemetry,
            PermissionConfirmationStartFacts {
                request_count_bucket: CountBucket::One,
                auto_approve: false,
                ui_surface: Some(PermissionUiSurface::ToolPermission),
            },
            Some(tool_context.clone()),
        );
        confirmation.finish(PermissionFinishFacts {
            completion: CompletionFacts::completed(),
            decision: PermissionDecision::Allow,
            source: PermissionSource::User,
        });
        tool.finish(ToolFinishFacts {
            completion: CompletionFacts::completed(),
            queue_ms: Some(1),
            preflight_ms: Some(2),
            confirmation_ms: Some(3),
            execution_ms: Some(4),
            failure_source: None,
            exit_status_class: Some(ExitStatusClass::Success),
            content_length: Some(0),
            content_truncated: Some(false),
            retryable: Some(false),
            programming_language: Some(ProgrammingLanguageClass::Rust),
        });
        round.finish(RoundFinishFacts {
            completion: CompletionFacts::completed(),
            has_tool_calls: true,
            attempt_bucket: AttemptBucket::One,
        });
        turn.finish(TurnFinishFacts {
            completion: CompletionFacts::completed(),
            finish_reason: Some(FinishReasonClass::Completed),
            round_count: Some(1),
            tool_count: Some(1),
            first_result_ms: Some(5),
            modified_file_count: Some(1),
            added_lines: Some(2),
            deleted_lines: Some(1),
        });

        let spans = sink
            .records()
            .into_iter()
            .filter_map(|record| match record {
                ValidatedRecord::Span(span) => Some(span),
                _ => None,
            })
            .collect::<Vec<_>>();
        let parent = |name: &str| {
            spans
                .iter()
                .find(|span| span.name() == name)
                .and_then(|span| span.parent_span_id())
        };
        assert_eq!(
            parent("bitfun.agent.round"),
            Some(turn_context.span_context().span_id())
        );
        assert_eq!(
            parent("bitfun.inference.request"),
            Some(round_context.span_context().span_id())
        );
        assert_eq!(
            parent("bitfun.inference.attempt"),
            Some(inference_context.span_context().span_id())
        );
        assert_eq!(
            parent("bitfun.tool.execute"),
            Some(round_context.span_context().span_id())
        );
        assert_eq!(
            parent("bitfun.permission.evaluate"),
            Some(tool_context.span_context().span_id())
        );
        assert_eq!(
            parent("bitfun.permission.confirmation"),
            Some(tool_context.span_context().span_id())
        );
    }

    #[test]
    fn independent_turns_never_share_trace_context() {
        let sink = Arc::new(InMemorySink::default());
        let (telemetry, _) = Telemetry::build(
            PolicySnapshot::new(TelemetryLevel::Diagnostic).with_trace_sample_ratio(1.0),
            sink,
        );
        let first = start_turn(
            &telemetry,
            TurnStartFacts {
                mode_class: AgentModeClass::Agentic,
                trigger: TurnTrigger::User,
                remote: false,
                subagent: false,
            },
            None,
        );
        let second = start_turn(
            &telemetry,
            TurnStartFacts {
                mode_class: AgentModeClass::Agentic,
                trigger: TurnTrigger::User,
                remote: false,
                subagent: false,
            },
            None,
        );
        assert_ne!(
            first.context().unwrap().span_context().trace_id(),
            second.context().unwrap().span_context().trace_id()
        );
    }

    #[test]
    fn linked_turn_starts_a_new_trace_and_preserves_causal_context() {
        let sink = Arc::new(InMemorySink::default());
        let (telemetry, _) = Telemetry::build(
            PolicySnapshot::new(TelemetryLevel::Diagnostic).with_trace_sample_ratio(1.0),
            sink.clone(),
        );
        let launcher = start_turn(
            &telemetry,
            TurnStartFacts {
                mode_class: AgentModeClass::Agentic,
                trigger: TurnTrigger::User,
                remote: false,
                subagent: false,
            },
            None,
        );
        let launcher_context = launcher.context().unwrap();
        let linked = start_turn_with_relation(
            &telemetry,
            TurnStartFacts {
                mode_class: AgentModeClass::Agentic,
                trigger: TurnTrigger::System,
                remote: false,
                subagent: true,
            },
            TraceRelation::Link(launcher_context.clone()),
        );
        let linked_context = linked.context().unwrap();
        linked.finish(TurnFinishFacts {
            completion: CompletionFacts::completed(),
            finish_reason: Some(FinishReasonClass::Completed),
            round_count: Some(1),
            tool_count: Some(0),
            first_result_ms: None,
            modified_file_count: None,
            added_lines: None,
            deleted_lines: None,
        });
        launcher.finish(TurnFinishFacts {
            completion: CompletionFacts::completed(),
            finish_reason: Some(FinishReasonClass::Completed),
            round_count: Some(1),
            tool_count: Some(0),
            first_result_ms: None,
            modified_file_count: None,
            added_lines: None,
            deleted_lines: None,
        });

        assert_ne!(
            launcher_context.span_context().trace_id(),
            linked_context.span_context().trace_id()
        );
        let linked_span = sink
            .records()
            .into_iter()
            .filter_map(|record| match record {
                ValidatedRecord::Span(span) => Some(span),
                _ => None,
            })
            .find(|span| span.context() == linked_context.span_context())
            .expect("linked turn span");
        assert_eq!(linked_span.parent_span_id(), None);
        assert_eq!(linked_span.links(), &[launcher_context.span_context()]);
    }
}
