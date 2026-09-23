//! Privacy-safe observations for the agent execution boundary.
//!
//! The execution engine owns lifecycle placement while this module only maps
//! product errors and configuration facts to the portable observability enums.

use crate::service::config::types::{AuthConfig, ModelCategory};
use crate::util::errors::BitFunError;
use bitfun_core_types::errors::ErrorCategory;
use bitfun_observability::domains::{
    AgentModeClass, CompletionFacts, FinishReasonClass, InferenceAuthClass, InferenceContextClass,
    InferenceProtocolClass, ModelClass, ProgrammingLanguageClass, ProviderClass, SafeErrorType,
    StatusClass, ToolClass, ToolFailureSource, ToolKind, ToolSourceClass, TurnTrigger,
};
use std::path::Path;

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
        BitFunError::Tool(_)
        | BitFunError::ClassifiedTool { .. }
        | BitFunError::Validation(_)
        | BitFunError::NotFound(_) => CompletionFacts::failed(SafeErrorType::ToolValidation),
        _ => completion_from_error(error),
    }
}

pub(crate) fn tool_failure_from_error(error: &BitFunError) -> (CompletionFacts, ToolFailureSource) {
    let completion = tool_completion_from_error(error);
    let source = match error {
        BitFunError::Tool(_)
        | BitFunError::ClassifiedTool { .. }
        | BitFunError::Validation(_)
        | BitFunError::NotFound(_) => ToolFailureSource::Validation,
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
        Some(BitFunError::Http(_)) | Some(BitFunError::Io(_)) => {
            return StatusClass::Network;
        }
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

pub(crate) fn agent_mode_class(
    category: crate::agentic::agents::AgentCategory,
    source: crate::agentic::agents::AgentSource,
    is_review: bool,
) -> AgentModeClass {
    use crate::agentic::agents::{AgentCategory, AgentSource};

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

pub(crate) fn model_class(category: Option<&ModelCategory>) -> ModelClass {
    match category {
        Some(ModelCategory::Multimodal) => ModelClass::Vision,
        Some(ModelCategory::CodeSpecialized) => ModelClass::Code,
        Some(ModelCategory::GeneralChat) => ModelClass::GeneralReasoning,
        _ => ModelClass::Other,
    }
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

pub(crate) fn inference_classes(
    format: &str,
    category: Option<&ModelCategory>,
    auth: Option<&AuthConfig>,
) -> (
    ProviderClass,
    ModelClass,
    InferenceProtocolClass,
    Option<InferenceAuthClass>,
) {
    let format = format.to_ascii_lowercase();
    let protocol = match format.as_str() {
        "responses" => InferenceProtocolClass::Responses,
        "openai" => InferenceProtocolClass::ChatCompletions,
        "anthropic" => InferenceProtocolClass::Messages,
        "gemini" | "google" => InferenceProtocolClass::Gemini,
        _ => InferenceProtocolClass::Other,
    };
    let provider = match format.as_str() {
        "responses" | "openai" => ProviderClass::OpenAiCompatible,
        "anthropic" => ProviderClass::AnthropicCompatible,
        "gemini" | "google" => ProviderClass::GoogleCompatible,
        "ollama" | "local" => ProviderClass::Local,
        _ => ProviderClass::Other,
    };
    let auth = auth.map(|value| match value {
        AuthConfig::ApiKey => InferenceAuthClass::ApiKey,
        AuthConfig::Subscription { .. } => InferenceAuthClass::Subscription,
    });
    (provider, model_class(category), protocol, auth)
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

pub(crate) fn tool_identity(
    tool_name: &str,
    provider_kind: Option<&str>,
) -> (ToolClass, ToolSourceClass, ToolKind) {
    let normalized = tool_name.to_ascii_lowercase();
    let source = match provider_kind.map(str::to_ascii_lowercase).as_deref() {
        Some("mcp") => ToolSourceClass::Mcp,
        Some("external_source" | "external") => ToolSourceClass::External,
        Some("plugin" | "opencode" | "extension") => ToolSourceClass::Plugin,
        Some("builtin" | "static") => ToolSourceClass::BuiltIn,
        Some(_) => ToolSourceClass::Custom,
        None if normalized == "skill" => ToolSourceClass::Skill,
        None if normalized.starts_with("mcp__") || normalized == "mcp" => ToolSourceClass::Mcp,
        None => ToolSourceClass::BuiltIn,
    };
    let kind = match normalized.as_str() {
        "read" | "write" | "edit" | "multiedit" | "glob" | "list" => ToolKind::Filesystem,
        "grep" | "search" | "websearch" | "codesearch" => ToolKind::Search,
        "bash" | "shell" | "terminal" | "execcommand" | "executecommand" => ToolKind::Shell,
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

pub(crate) const fn inference_context_class() -> InferenceContextClass {
    InferenceContextClass::Turn
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitfun_core_types::errors::AiProviderError;

    #[test]
    fn typed_errors_map_to_precise_terminal_facts() {
        let timeout = completion_from_error(&BitFunError::Timeout("opaque".to_string()));
        assert_eq!(
            timeout.outcome(),
            bitfun_observability::domains::Outcome::Timeout
        );
        assert_eq!(timeout.error_type(), Some(SafeErrorType::Timeout));

        let overflow = completion_from_error(&BitFunError::RecoverableContextOverflow(
            AiProviderError::classified("opaque".to_string(), ErrorCategory::ContextOverflow),
        ));
        assert_eq!(overflow.error_type(), Some(SafeErrorType::ContextOverflow));
    }

    #[test]
    fn tool_failure_source_uses_typed_error_variants() {
        assert_eq!(
            tool_failure_from_error(&BitFunError::Validation("opaque".to_string())).1,
            ToolFailureSource::Validation
        );
        assert_eq!(
            tool_failure_from_error(&BitFunError::Timeout("opaque".to_string())).1,
            ToolFailureSource::Timeout
        );
        assert_eq!(
            tool_failure_from_error(&BitFunError::Cancelled("opaque".to_string())).1,
            ToolFailureSource::Cancellation
        );
    }

    #[test]
    fn inference_classes_use_only_typed_configuration() {
        assert_eq!(
            inference_classes("anthropic", Some(&ModelCategory::CodeSpecialized), None),
            (
                ProviderClass::AnthropicCompatible,
                ModelClass::Code,
                InferenceProtocolClass::Messages,
                None,
            )
        );
        assert_eq!(
            inference_classes("arbitrary-code-vl-haiku-name", None, None),
            (
                ProviderClass::Other,
                ModelClass::Other,
                InferenceProtocolClass::Other,
                None,
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
        assert_eq!(programming_language_class_from_path("README"), None);
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
