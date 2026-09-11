//! Privacy-safe observations for the agent execution boundary.
//!
//! The execution engine owns lifecycle placement while this module only maps
//! product errors and configuration facts to the portable observability enums.

use crate::service::config::types::{AuthConfig, ModelCategory};
use crate::util::errors::BitFunError;
use bitfun_core_types::errors::ErrorCategory;
use bitfun_observability::domains::{
    AgentModeClass, CompletionFacts, FinishReasonClass, InferenceAuthClass, InferenceContextClass,
    InferenceProtocolClass, ModelClass, ProviderClass, SafeErrorType, StatusClass, ToolClass,
    ToolKind, ToolSourceClass, TurnTrigger,
};

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

pub(crate) fn agent_mode_class(agent_type: &str) -> AgentModeClass {
    let normalized = agent_type.to_ascii_lowercase();
    if normalized.contains("review") {
        AgentModeClass::Review
    } else if normalized.contains("chat") {
        AgentModeClass::Chat
    } else if normalized.contains("goal") {
        AgentModeClass::Goal
    } else if normalized.is_empty() {
        AgentModeClass::Other
    } else {
        AgentModeClass::Agentic
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

pub(crate) fn tool_identity(tool_name: &str) -> (ToolClass, ToolSourceClass, ToolKind) {
    let normalized = tool_name.to_ascii_lowercase();
    let source = if normalized.starts_with("mcp__") || normalized == "mcp" {
        ToolSourceClass::Mcp
    } else if normalized.contains("plugin") || normalized.contains("opencode") {
        ToolSourceClass::Plugin
    } else if normalized.contains("external") {
        ToolSourceClass::External
    } else if normalized == "skill" {
        ToolSourceClass::Skill
    } else {
        ToolSourceClass::BuiltIn
    };
    let kind = match normalized.as_str() {
        "read" | "write" | "edit" | "multiedit" | "glob" | "list" => ToolKind::Filesystem,
        "grep" | "search" | "websearch" | "codesearch" => ToolKind::Search,
        "bash" | "shell" | "terminal" | "execcommand" | "executecommand" => ToolKind::Shell,
        "git" | "gitstatus" | "gitdiff" => ToolKind::Git,
        "browser" | "webfetch" | "webdriver" => ToolKind::Browser,
        "computeruse" | "computer_use" => ToolKind::ComputerUse,
        "mcp" => ToolKind::Protocol,
        "task" | "subagent" | "createsubagent" => ToolKind::Task,
        _ if source == ToolSourceClass::Mcp => ToolKind::Protocol,
        _ => ToolKind::Other,
    };
    let class = if matches!(source, ToolSourceClass::BuiltIn | ToolSourceClass::Skill) {
        ToolClass::BuiltIn
    } else {
        ToolClass::Custom
    };
    (class, source, kind)
}

pub(crate) const fn inference_context_class() -> InferenceContextClass {
    InferenceContextClass::Turn
}
