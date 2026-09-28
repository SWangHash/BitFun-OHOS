use crate::service::config::types::ModelCategory;
use crate::util::errors::BitFunError;
use bitfun_core_types::errors::ErrorCategory;
use bitfun_events::{
    SafeCountBucket, SafeOperationErrorType, SafeOperationOutcome, SafePermissionDecision,
    SafePermissionSource, SafeSessionClass, SafeSessionOperation,
};
use bitfun_observability::domains::{
    AgentModeClass, CompletionFacts, CountBucket, FinishReasonClass, InferenceProtocolClass,
    ModelClass, Outcome, PermissionDecision, PermissionSource, ProgrammingLanguageClass,
    ProviderClass, SafeErrorType, SessionClass, SessionOperation, StatusClass, ToolClass,
    ToolFailureSource, ToolKind, ToolSourceClass, TurnTrigger,
};
use std::path::Path;

pub(crate) fn safe_terminal_completion(
    completion: CompletionFacts,
) -> (SafeOperationOutcome, Option<SafeOperationErrorType>) {
    let outcome = match completion.outcome() {
        Outcome::Completed => SafeOperationOutcome::Completed,
        Outcome::Failed => SafeOperationOutcome::Failed,
        Outcome::Cancelled => SafeOperationOutcome::Cancelled,
        Outcome::Timeout => SafeOperationOutcome::Timeout,
        Outcome::Rejected => SafeOperationOutcome::Rejected,
        Outcome::Degraded => SafeOperationOutcome::Degraded,
        Outcome::Incomplete => SafeOperationOutcome::Incomplete,
    };
    let error_type = completion.error_type().map(|error_type| match error_type {
        SafeErrorType::Cancelled => SafeOperationErrorType::Cancelled,
        SafeErrorType::Timeout => SafeOperationErrorType::Timeout,
        SafeErrorType::Authentication => SafeOperationErrorType::Authentication,
        SafeErrorType::RateLimited => SafeOperationErrorType::RateLimited,
        SafeErrorType::NetworkUnavailable => SafeOperationErrorType::NetworkUnavailable,
        SafeErrorType::NetworkProtocol => SafeOperationErrorType::NetworkProtocol,
        SafeErrorType::InvalidRequest => SafeOperationErrorType::InvalidRequest,
        SafeErrorType::ContextOverflow => SafeOperationErrorType::ContextOverflow,
        SafeErrorType::ToolValidation => SafeOperationErrorType::ToolValidation,
        SafeErrorType::PermissionDenied => SafeOperationErrorType::PermissionDenied,
        SafeErrorType::Persistence => SafeOperationErrorType::Persistence,
        SafeErrorType::Provider => SafeOperationErrorType::Provider,
        SafeErrorType::Internal => SafeOperationErrorType::Internal,
        SafeErrorType::Other => SafeOperationErrorType::Other,
    });
    (outcome, error_type)
}

pub(crate) fn safe_session_operation(value: SessionOperation) -> SafeSessionOperation {
    match value {
        SessionOperation::Create => SafeSessionOperation::Create,
        SessionOperation::Resume => SafeSessionOperation::Resume,
        SessionOperation::Delete => SafeSessionOperation::Delete,
    }
}

pub(crate) fn safe_session_class(value: SessionClass) -> SafeSessionClass {
    match value {
        SessionClass::Standard => SafeSessionClass::Standard,
        SessionClass::Subagent => SafeSessionClass::Subagent,
        SessionClass::Internal => SafeSessionClass::Internal,
        SessionClass::Transient => SafeSessionClass::Transient,
    }
}

pub(crate) fn safe_count_bucket(value: CountBucket) -> SafeCountBucket {
    match value {
        CountBucket::Zero => SafeCountBucket::Zero,
        CountBucket::One => SafeCountBucket::One,
        CountBucket::Two => SafeCountBucket::Two,
        CountBucket::ThreePlus => SafeCountBucket::ThreePlus,
    }
}

pub(crate) fn safe_permission_decision(value: PermissionDecision) -> SafePermissionDecision {
    match value {
        PermissionDecision::Allow => SafePermissionDecision::Allow,
        PermissionDecision::Ask => SafePermissionDecision::Ask,
        PermissionDecision::PolicyDeny => SafePermissionDecision::PolicyDeny,
        PermissionDecision::UserReject => SafePermissionDecision::UserReject,
        PermissionDecision::Cancelled => SafePermissionDecision::Cancelled,
        PermissionDecision::Failed => SafePermissionDecision::Failed,
    }
}

pub(crate) fn safe_permission_source(value: PermissionSource) -> SafePermissionSource {
    match value {
        PermissionSource::Policy => SafePermissionSource::Policy,
        PermissionSource::StoredGrant => SafePermissionSource::StoredGrant,
        PermissionSource::Hook => SafePermissionSource::Hook,
        PermissionSource::AutoApprove => SafePermissionSource::AutoApprove,
        PermissionSource::User => SafePermissionSource::User,
        PermissionSource::Delegated => SafePermissionSource::Delegated,
        PermissionSource::Other => SafePermissionSource::Other,
    }
}

pub(crate) fn completion_from_error(error: &BitFunError) -> CompletionFacts {
    match error {
        BitFunError::Cancelled(_) => CompletionFacts::cancelled(),
        BitFunError::Timeout(_) => CompletionFacts::timeout(),
        BitFunError::Validation(_) => CompletionFacts::failed(SafeErrorType::InvalidRequest),
        BitFunError::AIProvider(error) => {
            CompletionFacts::failed(safe_error_category(&error.category))
        }
        BitFunError::RecoverableContextOverflow(_) => {
            CompletionFacts::failed(SafeErrorType::ContextOverflow)
        }
        BitFunError::AIClient(_) => CompletionFacts::failed(SafeErrorType::Provider),
        BitFunError::Io(_) => CompletionFacts::failed(SafeErrorType::Persistence),
        BitFunError::Http(_) => CompletionFacts::failed(SafeErrorType::NetworkProtocol),
        BitFunError::Configuration(_) | BitFunError::Deserialization(_) => {
            CompletionFacts::failed(SafeErrorType::InvalidRequest)
        }
        BitFunError::Tool(_) | BitFunError::NotFound(_) => {
            CompletionFacts::failed(SafeErrorType::ToolValidation)
        }
        _ => CompletionFacts::failed(SafeErrorType::Other),
    }
}

pub(crate) fn tool_completion_from_error(error: &BitFunError) -> CompletionFacts {
    match error {
        BitFunError::Tool(_) | BitFunError::Validation(_) | BitFunError::NotFound(_) => {
            CompletionFacts::failed(SafeErrorType::ToolValidation)
        }
        _ => completion_from_error(error),
    }
}

pub(crate) fn tool_failure_from_error(error: &BitFunError) -> (CompletionFacts, ToolFailureSource) {
    let completion = tool_completion_from_error(error);
    let source = match error {
        BitFunError::Tool(_) | BitFunError::Validation(_) | BitFunError::NotFound(_) => {
            ToolFailureSource::Validation
        }
        BitFunError::Timeout(_) => ToolFailureSource::Timeout,
        BitFunError::Cancelled(_) => ToolFailureSource::Cancellation,
        BitFunError::AIProvider(provider) => match provider.category {
            ErrorCategory::Permission => ToolFailureSource::Permission,
            ErrorCategory::Timeout => ToolFailureSource::Timeout,
            _ => ToolFailureSource::Provider,
        },
        BitFunError::RecoverableContextOverflow(_) | BitFunError::AIClient(_) => {
            ToolFailureSource::Provider
        }
        BitFunError::Configuration(_)
        | BitFunError::Deserialization(_)
        | BitFunError::Serialization(_)
        | BitFunError::Other(_)
        | BitFunError::Semaphore(_)
        | BitFunError::Service(_)
        | BitFunError::Agent(_)
        | BitFunError::Session(_)
        | BitFunError::SessionInUse { .. }
        | BitFunError::OutcomeUnknown(_)
        | BitFunError::SessionCreateCleanupRequired { .. }
        | BitFunError::Workspace(_)
        | BitFunError::NotImplemented(_) => ToolFailureSource::Internal,
        BitFunError::Io(_)
        | BitFunError::Http(_)
        | BitFunError::MCPError(_)
        | BitFunError::ProcessError(_) => ToolFailureSource::Execution,
    };
    (completion, source)
}

pub(crate) fn safe_error_category(category: &ErrorCategory) -> SafeErrorType {
    match category {
        ErrorCategory::Network => SafeErrorType::NetworkUnavailable,
        ErrorCategory::Auth => SafeErrorType::Authentication,
        ErrorCategory::RateLimit => SafeErrorType::RateLimited,
        ErrorCategory::ContextOverflow => SafeErrorType::ContextOverflow,
        ErrorCategory::Timeout => SafeErrorType::Timeout,
        ErrorCategory::Permission => SafeErrorType::PermissionDenied,
        ErrorCategory::InvalidRequest => SafeErrorType::InvalidRequest,
        ErrorCategory::ProviderQuota
        | ErrorCategory::ProviderBilling
        | ErrorCategory::ProviderUnavailable
        | ErrorCategory::ContentPolicy
        | ErrorCategory::ModelError => SafeErrorType::Provider,
        ErrorCategory::Unknown => SafeErrorType::Other,
    }
}

pub(crate) fn retryable_error(error: &BitFunError) -> bool {
    match error {
        BitFunError::AIProvider(error) => matches!(
            error.category,
            ErrorCategory::Network
                | ErrorCategory::RateLimit
                | ErrorCategory::Timeout
                | ErrorCategory::ProviderUnavailable
        ),
        BitFunError::Timeout(_) | BitFunError::Http(_) | BitFunError::Io(_) => true,
        _ => false,
    }
}

pub(crate) fn status_class(error: Option<&BitFunError>) -> StatusClass {
    let status = match error {
        Some(BitFunError::AIProvider(error))
        | Some(BitFunError::RecoverableContextOverflow(error)) => error.http_status,
        Some(BitFunError::Http(_)) | Some(BitFunError::Io(_)) => return StatusClass::Network,
        Some(_) => return StatusClass::None,
        None => return StatusClass::Success,
    };
    match status {
        Some(200..=299) => StatusClass::Success,
        Some(300..=399) => StatusClass::Redirect,
        Some(400..=499) => StatusClass::ClientError,
        Some(500..=599) => StatusClass::ServerError,
        _ => StatusClass::None,
    }
}

pub(crate) fn agent_mode_class(
    category: crate::agentic::agents::AgentCategory,
    source: crate::agentic::agents::AgentSource,
    is_review: bool,
) -> AgentModeClass {
    use crate::agentic::agents::AgentCategory;
    use crate::agentic::agents::AgentSource;

    if source != AgentSource::Builtin {
        return AgentModeClass::Custom;
    }
    if is_review {
        return AgentModeClass::Review;
    }
    match category {
        AgentCategory::Mode | AgentCategory::SubAgent | AgentCategory::Hidden => {
            AgentModeClass::Agentic
        }
    }
}

pub(crate) fn turn_trigger(is_subagent: bool, remote: bool) -> TurnTrigger {
    if is_subagent {
        TurnTrigger::Continuation
    } else if remote {
        TurnTrigger::Remote
    } else {
        TurnTrigger::User
    }
}

pub(crate) fn finish_reason_class(value: &str) -> FinishReasonClass {
    match value {
        "complete" | "completed" => FinishReasonClass::Completed,
        "tool_calls" => FinishReasonClass::ToolCalls,
        "cancelled" => FinishReasonClass::Cancelled,
        "length" => FinishReasonClass::Length,
        "content_filter" => FinishReasonClass::ContentFilter,
        "max_rounds" => FinishReasonClass::MaxRounds,
        "repeated_tool_failures" => FinishReasonClass::RepeatedToolFailures,
        "error" => FinishReasonClass::Error,
        _ => FinishReasonClass::Other,
    }
}

pub(crate) fn model_class_from_category(category: Option<&ModelCategory>) -> ModelClass {
    match category {
        Some(ModelCategory::GeneralChat) => ModelClass::GeneralReasoning,
        Some(ModelCategory::Multimodal) => ModelClass::Vision,
        Some(ModelCategory::CodeSpecialized) => ModelClass::Code,
        Some(
            ModelCategory::ImageGeneration
            | ModelCategory::Embedding
            | ModelCategory::SearchEnhanced
            | ModelCategory::SpeechRecognition,
        )
        | None => ModelClass::Other,
    }
}

pub(crate) fn inference_classes(
    format: &str,
    model_class: ModelClass,
) -> (ProviderClass, ModelClass, InferenceProtocolClass) {
    let format = format.to_ascii_lowercase();
    let protocol_class = match format.as_str() {
        "responses" => InferenceProtocolClass::Responses,
        "openai" => InferenceProtocolClass::ChatCompletions,
        "anthropic" => InferenceProtocolClass::Messages,
        "gemini" | "google" => InferenceProtocolClass::Gemini,
        _ => InferenceProtocolClass::Other,
    };
    let provider_class = match format.as_str() {
        "responses" | "openai" => ProviderClass::OpenAiCompatible,
        "anthropic" => ProviderClass::AnthropicCompatible,
        "gemini" | "google" => ProviderClass::GoogleCompatible,
        "ollama" | "local" => ProviderClass::Local,
        _ => ProviderClass::Other,
    };
    (provider_class, model_class, protocol_class)
}

pub(crate) fn tool_identity(
    tool_name: &str,
    provider_kind: Option<&str>,
) -> (ToolClass, ToolSourceClass, ToolKind) {
    let normalized_name = tool_name.to_ascii_lowercase();
    let source = match provider_kind.map(str::to_ascii_lowercase).as_deref() {
        Some("mcp") => ToolSourceClass::Mcp,
        Some("external_source" | "external") => ToolSourceClass::External,
        Some("plugin" | "opencode" | "extension") => ToolSourceClass::Plugin,
        Some("builtin" | "static") => ToolSourceClass::BuiltIn,
        Some(_) => ToolSourceClass::Custom,
        None if normalized_name == "skill" => ToolSourceClass::Skill,
        None => ToolSourceClass::BuiltIn,
    };
    let kind = match normalized_name.as_str() {
        "read" | "write" | "edit" | "multiedit" | "glob" | "list" => ToolKind::Filesystem,
        "grep" | "search" | "websearch" | "codesearch" => ToolKind::Search,
        "bash" | "shell" | "terminal" | "executecommand" => ToolKind::Shell,
        "git" | "gitstatus" | "gitdiff" => ToolKind::Git,
        "browser" | "webfetch" | "webdriver" => ToolKind::Browser,
        "computeruse" | "computer_use" => ToolKind::ComputerUse,
        "mcp" | "calldeferredtool" | "gettoolspec" => ToolKind::Protocol,
        "task" | "subagent" | "createsubagent" => ToolKind::Task,
        _ => ToolKind::Other,
    };
    let kind = if source == ToolSourceClass::Mcp && kind == ToolKind::Other {
        ToolKind::Protocol
    } else {
        kind
    };
    let class = match source {
        ToolSourceClass::BuiltIn | ToolSourceClass::Skill => ToolClass::BuiltIn,
        ToolSourceClass::Mcp
        | ToolSourceClass::Plugin
        | ToolSourceClass::External
        | ToolSourceClass::Custom => ToolClass::Custom,
    };
    (class, source, kind)
}

pub(crate) fn programming_language_class_from_path(path: &str) -> Option<ProgrammingLanguageClass> {
    let path = Path::new(path);
    if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
        match name.to_ascii_lowercase().as_str() {
            "dockerfile" | "containerfile" => return Some(ProgrammingLanguageClass::Dockerfile),
            "makefile" | "gnumakefile" => return Some(ProgrammingLanguageClass::Makefile),
            "cargo.toml" | "cargo.lock" => return Some(ProgrammingLanguageClass::Rust),
            _ => {}
        }
    }
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match extension.as_str() {
        "ts" | "tsx" => ProgrammingLanguageClass::TypeScript,
        "js" | "jsx" | "mjs" | "cjs" => ProgrammingLanguageClass::JavaScript,
        "py" | "pyi" | "pyw" => ProgrammingLanguageClass::Python,
        "rs" => ProgrammingLanguageClass::Rust,
        "go" => ProgrammingLanguageClass::Go,
        "java" => ProgrammingLanguageClass::Java,
        "kt" | "kts" => ProgrammingLanguageClass::Kotlin,
        "swift" => ProgrammingLanguageClass::Swift,
        "cs" => ProgrammingLanguageClass::CSharp,
        "cpp" | "cc" | "cxx" | "hpp" | "c" | "h" => ProgrammingLanguageClass::Cpp,
        "rb" => ProgrammingLanguageClass::Ruby,
        "php" => ProgrammingLanguageClass::Php,
        "vue" => ProgrammingLanguageClass::Vue,
        "svelte" => ProgrammingLanguageClass::Svelte,
        "md" | "mdx" => ProgrammingLanguageClass::Markdown,
        "json" | "jsonc" => ProgrammingLanguageClass::Json,
        "yaml" | "yml" => ProgrammingLanguageClass::Yaml,
        "toml" => ProgrammingLanguageClass::Toml,
        "xml" => ProgrammingLanguageClass::Xml,
        "html" | "htm" => ProgrammingLanguageClass::Html,
        "css" | "scss" | "sass" | "less" => ProgrammingLanguageClass::Css,
        "sh" | "bash" | "zsh" | "fish" => ProgrammingLanguageClass::Shell,
        "ps1" => ProgrammingLanguageClass::PowerShell,
        "sql" => ProgrammingLanguageClass::Sql,
        "gradle" => ProgrammingLanguageClass::Gradle,
        "properties" => ProgrammingLanguageClass::Properties,
        _ => return None,
    })
}

pub(crate) const fn programming_language_name(language: ProgrammingLanguageClass) -> &'static str {
    match language {
        ProgrammingLanguageClass::Rust => "Rust",
        ProgrammingLanguageClass::TypeScript => "TypeScript",
        ProgrammingLanguageClass::JavaScript => "JavaScript",
        ProgrammingLanguageClass::Python => "Python",
        ProgrammingLanguageClass::Go => "Go",
        ProgrammingLanguageClass::Java => "Java",
        ProgrammingLanguageClass::Kotlin => "Kotlin",
        ProgrammingLanguageClass::Swift => "Swift",
        ProgrammingLanguageClass::CSharp => "C#",
        ProgrammingLanguageClass::Cpp => "C/C++",
        ProgrammingLanguageClass::Ruby => "Ruby",
        ProgrammingLanguageClass::Php => "PHP",
        ProgrammingLanguageClass::Vue => "Vue",
        ProgrammingLanguageClass::Svelte => "Svelte",
        ProgrammingLanguageClass::Markdown => "Markdown",
        ProgrammingLanguageClass::Json => "JSON",
        ProgrammingLanguageClass::Yaml => "YAML",
        ProgrammingLanguageClass::Toml => "TOML",
        ProgrammingLanguageClass::Xml => "XML",
        ProgrammingLanguageClass::Html => "HTML",
        ProgrammingLanguageClass::Css => "CSS",
        ProgrammingLanguageClass::Shell => "Shell",
        ProgrammingLanguageClass::PowerShell => "PowerShell",
        ProgrammingLanguageClass::Sql => "SQL",
        ProgrammingLanguageClass::Gradle => "Gradle",
        ProgrammingLanguageClass::Properties => "Properties",
        ProgrammingLanguageClass::Dockerfile => "Dockerfile",
        ProgrammingLanguageClass::Makefile => "Makefile",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitfun_core_types::errors::AiProviderError;
    use bitfun_observability::domains::{
        start_inference, AttemptBucket, InferenceAuthClass, InferenceContextClass,
        InferenceFinishFacts, InferenceStartFacts,
    };
    use bitfun_observability::{
        AttributeValue, InMemorySink, PolicySnapshot, Telemetry, TelemetryLevel,
    };
    use std::sync::Arc;

    fn assert_error_type_on_all_inference_signals(error: BitFunError, expected: &'static str) {
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
                provider_class: ProviderClass::OpenAiCompatible,
                model_class: ModelClass::GeneralReasoning,
                model_name: None,
                protocol_class: InferenceProtocolClass::Responses,
                context_class: InferenceContextClass::Turn,
                auth_class: Some(InferenceAuthClass::ApiKey),
            },
            None,
        )
        .finish(InferenceFinishFacts {
            completion: completion_from_error(&error),
            attempt_bucket: AttemptBucket::One,
            retry_count: 0,
            status_class: Some(status_class(Some(&error))),
            retryable: Some(retryable_error(&error)),
            ttft_ms: None,
            input_tokens: None,
            output_tokens: None,
            reasoning_tokens: None,
            cache_read_tokens: None,
            cache_creation_tokens: None,
            total_tokens: None,
            context_window_tokens: None,
            tool_definition_tokens_estimate: None,
        });

        let records = sink.records();
        assert_eq!(records.len(), 4);
        for record in records {
            let actual = record
                .attributes()
                .iter()
                .find(|attribute| attribute.key() == "error.type")
                .and_then(|attribute| match attribute.value() {
                    AttributeValue::Enum(value) => Some(*value),
                    _ => None,
                });
            assert_eq!(actual, Some(expected));
        }
    }

    #[test]
    fn typed_errors_map_to_precise_terminal_facts() {
        let timeout = completion_from_error(&BitFunError::Timeout("opaque".to_string()));
        assert_eq!(timeout.outcome(), Outcome::Timeout);
        assert_eq!(timeout.error_type(), Some(SafeErrorType::Timeout));

        let overflow = completion_from_error(&BitFunError::RecoverableContextOverflow(
            AiProviderError::classified("opaque".to_string(), ErrorCategory::ContextOverflow),
        ));
        assert_eq!(overflow.outcome(), Outcome::Failed);
        assert_eq!(overflow.error_type(), Some(SafeErrorType::ContextOverflow));

        let rate_limit = completion_from_error(&BitFunError::AIProvider(
            AiProviderError::classified("opaque".to_string(), ErrorCategory::RateLimit),
        ));
        assert_eq!(rate_limit.outcome(), Outcome::Failed);
        assert_eq!(rate_limit.error_type(), Some(SafeErrorType::RateLimited));
    }

    #[test]
    fn typed_error_classification_is_identical_on_span_metric_and_log() {
        assert_error_type_on_all_inference_signals(
            BitFunError::Timeout("opaque".to_string()),
            "timeout",
        );
        assert_error_type_on_all_inference_signals(
            BitFunError::RecoverableContextOverflow(AiProviderError::classified(
                "opaque".to_string(),
                ErrorCategory::ContextOverflow,
            )),
            "context_overflow",
        );
        assert_error_type_on_all_inference_signals(
            BitFunError::AIProvider(AiProviderError::classified(
                "opaque".to_string(),
                ErrorCategory::RateLimit,
            )),
            "rate_limited",
        );
    }

    #[test]
    fn tool_failure_source_uses_typed_error_variants() {
        let cases = [
            (
                BitFunError::Validation("opaque".to_string()),
                ToolFailureSource::Validation,
            ),
            (
                BitFunError::Timeout("opaque".to_string()),
                ToolFailureSource::Timeout,
            ),
            (
                BitFunError::Cancelled("opaque".to_string()),
                ToolFailureSource::Cancellation,
            ),
            (
                BitFunError::AIProvider(AiProviderError::classified(
                    "opaque".to_string(),
                    ErrorCategory::Permission,
                )),
                ToolFailureSource::Permission,
            ),
            (
                BitFunError::AIProvider(AiProviderError::classified(
                    "opaque".to_string(),
                    ErrorCategory::RateLimit,
                )),
                ToolFailureSource::Provider,
            ),
            (
                BitFunError::Service("opaque".to_string()),
                ToolFailureSource::Internal,
            ),
        ];
        for (error, expected) in cases {
            assert_eq!(tool_failure_from_error(&error).1, expected);
        }
    }

    #[test]
    fn inference_classes_use_only_adapter_and_model_config_facts() {
        assert_eq!(
            model_class_from_category(Some(&ModelCategory::CodeSpecialized)),
            ModelClass::Code
        );
        assert_eq!(
            model_class_from_category(Some(&ModelCategory::Multimodal)),
            ModelClass::Vision
        );
        assert_eq!(model_class_from_category(None), ModelClass::Other);
        assert_eq!(
            inference_classes("anthropic", ModelClass::Other),
            (
                ProviderClass::AnthropicCompatible,
                ModelClass::Other,
                InferenceProtocolClass::Messages,
            )
        );
        assert_eq!(
            inference_classes("arbitrary-code-vl-haiku-name", ModelClass::Other),
            (
                ProviderClass::Other,
                ModelClass::Other,
                InferenceProtocolClass::Other,
            )
        );
    }

    #[test]
    fn programming_language_uses_only_validated_file_paths() {
        assert_eq!(
            programming_language_class_from_path("src/main.rs"),
            Some(ProgrammingLanguageClass::Rust)
        );
        assert_eq!(
            programming_language_class_from_path("web/App.tsx"),
            Some(ProgrammingLanguageClass::TypeScript)
        );
        assert_eq!(
            programming_language_class_from_path("Containerfile"),
            Some(ProgrammingLanguageClass::Dockerfile)
        );
        assert_eq!(programming_language_class_from_path("README"), None);
        assert_eq!(
            programming_language_class_from_path("archive.unknown"),
            None
        );
    }

    #[test]
    fn agent_mode_class_uses_registry_facts_not_agent_names() {
        use crate::agentic::agents::{AgentCategory, AgentSource};

        assert_eq!(
            agent_mode_class(AgentCategory::Mode, AgentSource::Builtin, false),
            AgentModeClass::Agentic
        );
        assert_eq!(
            agent_mode_class(AgentCategory::SubAgent, AgentSource::Builtin, true),
            AgentModeClass::Review
        );
        assert_eq!(
            agent_mode_class(AgentCategory::Mode, AgentSource::External, false),
            AgentModeClass::Custom
        );
    }
}
