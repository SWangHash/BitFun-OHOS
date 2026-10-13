//! AskUserQuestion tool
//!
//! Allows AI to ask questions to users during execution and wait for answers

use async_trait::async_trait;
use bitfun_agent_runtime::user_questions::{
    ask_user_question_available_in_context, build_answered_user_question_result,
    build_cancelled_user_question_result, build_timed_out_user_question_result,
    validate_ask_user_question_input, wait_for_user_question_response, AskUserQuestionInput,
    PendingQuestionRequestMeta, PendingUserQuestion, QuestionPresentation, ResolvedQuestionRequest,
    UserQuestionController, UserQuestionWaitOutcome, DEFAULT_USER_QUESTION_TIMEOUT_SECONDS,
    USER_INPUT_AVAILABLE_CONTEXT_KEY, USER_INPUT_MODEL_ROUND_CONTEXT_KEY,
    USER_INPUT_PARENT_CONTEXT_KEY,
};
use log::{debug, warn};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::agentic::tools::user_input_manager::get_user_input_manager;
use crate::infrastructure::events::event_system::{get_global_event_system, BackendEvent};
use crate::util::errors::BitFunResult;

/// How long the runtime may wait for the user's first interaction.
///
/// The model's `timeout_seconds` bounds a plain question. A template that owns
/// its wait (`allowTimeout: false`) returns `None`, which means "wait until the
/// user answers or the turn is cancelled" — the Qt migration intake needs its
/// four paths before any work starts, so a skipped question would be a silent
/// failure rather than a convenient default.
fn unattended_question_timeout(
    presentation: Option<&QuestionPresentation>,
    timeout_seconds: u32,
) -> Option<std::time::Duration> {
    let allow_timeout = presentation
        .map(|presentation| presentation.allow_timeout)
        .unwrap_or(true);
    allow_timeout.then(|| std::time::Duration::from_secs(u64::from(timeout_seconds)))
}

/// AskUserQuestion tool
pub struct AskUserQuestionTool;

impl Default for AskUserQuestionTool {
    fn default() -> Self {
        Self::new()
    }
}

impl AskUserQuestionTool {
    /// Facts registered template contributions append to the resumed tool
    /// result so the model acts on a decided consequence inside the current turn.
    fn answer_receipt_facts(
        resolved_request: Option<&ResolvedQuestionRequest>,
        answers: &Value,
        context: &ToolUseContext,
    ) -> Vec<String> {
        let Some(registry) = context.runtime_handles.question_template_registry() else {
            return Vec::new();
        };
        let Some(state) = context.runtime_handles.domain_state_reader() else {
            return Vec::new();
        };
        let template_id = resolved_request.and_then(|resolved| resolved.template_id.as_deref());
        registry
            .iter()
            .flat_map(|contribution| {
                contribution
                    .on_answers(template_id, answers, state.as_ref())
                    .into_iter()
                    .map(|fact| fact.text)
            })
            .collect()
    }

    async fn question_controllers(context: &ToolUseContext) -> Vec<UserQuestionController> {
        let Some(parent) = context
            .custom_data
            .get(USER_INPUT_PARENT_CONTEXT_KEY)
            .and_then(|value| serde_json::from_value::<UserQuestionController>(value.clone()).ok())
        else {
            return Vec::new();
        };
        let mut controllers = vec![parent];
        let Some(coordinator) = crate::agentic::coordination::get_global_coordinator() else {
            return controllers;
        };
        let manager = coordinator.get_session_manager();
        let mut visited = std::collections::HashSet::new();
        if let Some(session_id) = context.session_id.as_ref() {
            visited.insert(session_id.clone());
        }
        while let Some(current) = controllers.last() {
            let session_id = current.session_id.clone();
            if !visited.insert(session_id.clone()) {
                controllers.pop();
                break;
            }
            let Some(storage) = manager.effective_session_storage_path(&session_id).await else {
                break;
            };
            let metadata = match manager.load_session_metadata(&storage, &session_id).await {
                Ok(Some(metadata)) => metadata,
                Ok(None) => break,
                Err(error) => {
                    warn!(
                        "Failed to resolve question controller lineage: session_id={}, error={}",
                        session_id, error
                    );
                    break;
                }
            };
            let Some(relationship) =
                bitfun_services_core::session::normalized_session_relationship(&metadata)
            else {
                break;
            };
            if relationship.kind != Some(crate::service::session::SessionRelationshipKind::Subagent)
            {
                break;
            }
            let Some(parent_session_id) = relationship.parent_session_id else {
                break;
            };
            controllers.push(UserQuestionController {
                session_id: parent_session_id,
                dialog_turn_id: relationship.parent_dialog_turn_id,
            });
        }
        controllers
    }

    pub fn new() -> Self {
        Self
    }

    fn is_available_for_tool_context(context: Option<&ToolUseContext>) -> bool {
        ask_user_question_available_in_context(
            context.and_then(|ctx| ctx.custom_data.get("acp_transport")),
            context.and_then(|ctx| ctx.custom_data.get(USER_INPUT_AVAILABLE_CONTEXT_KEY)),
        )
    }

    /// Generate tool ID
    fn generate_tool_id(context: &ToolUseContext) -> String {
        // Prefer tool_call_id
        if let Some(tool_call_id) = &context.tool_call_id {
            return tool_call_id.clone();
        }

        // Only generate UUID as last resort (shouldn't reach here)
        warn!("Unable to get tool_call_id, using UUID for AskUserQuestion tool");
        format!("ask_user_{}", Uuid::new_v4())
    }
}

#[async_trait]
impl Tool for AskUserQuestionTool {
    fn name(&self) -> &str {
        "AskUserQuestion"
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok(r#"Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take

WHEN TO USE:
- The request is ambiguous or could be interpreted in multiple ways
- Multiple valid approaches exist with different trade-offs
- The change affects critical files or has significant impact
- You are unsure about the user's intent or preferences
- The decision has security, performance, or architectural implications

WHEN NOT TO USE:
- The request is clear and specific
- You are following an already-approved plan exactly
- The change is trivial and clearly correct

RECOMMENDATION GUIDELINES:
- Always state your recommendation and reasoning
- Make your recommended option the first option in the list
- Add "(Recommended)" at the end of the recommended option's label
- Provide 2-4 clear options with descriptions of trade-offs

Usage notes:
- This tool waits up to 30 seconds by default for the first user interaction. Once the user clicks an option or input, the timeout is disabled and the tool waits for submission or cancellation. If the user does not interact, it skips the questions and returns so you can continue execution.
- Prefer the default timeout. Set timeout_seconds only when necessary to wait a shorter or longer time. A timeout is not user approval or a selected answer.
- A backend template may own the wait instead: the `qt-migration-paths` intake never times out, because a migration cannot start before its paths are confirmed. Such a call blocks until the user answers or the turn is cancelled.
- Put all questions you need into a single AskUserQuestion call instead of calling it repeatedly in one response
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- When a question may need a custom value beyond the predefined choices (for example a file path, host, or version), set the optional `inputPlaceholder` field on that question to the placeholder text (e.g. "请填写您原始工程路径"). The UI then shows a text input below the options and prefers the typed value over the selected option."#.to_string())
    }

    fn short_description(&self) -> String {
        "Ask the user focused follow-up questions during execution.".to_string()
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "timeout_seconds": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": u32::MAX,
                    "default": DEFAULT_USER_QUESTION_TIMEOUT_SECONDS,
                    "description": "Seconds to wait for the first user interaction, default 30. Once the user starts answering, wait until submission or cancellation without a timeout. Prefer omitting this parameter; use a shorter or longer wait only when necessary. On timeout, skip the questions and continue execution."
                },
                "questions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "question": {
                                "type": "string",
                                "description": "The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: \"Which library should we use for date formatting?\" If multiSelect is true, phrase it accordingly, e.g. \"Which features do you want to enable?\""
                            },
                            "header": {
                                "type": "string",
                                "maxLength": 20,
                                "description": "Very short label displayed as a chip/tag (max 20 characters). Examples: \"Auth method\", \"Library\", \"Approach\"."
                            },
                            "options": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "label": {
                                            "type": "string",
                                            "description": "The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice."
                                        },
                                        "description": {
                                            "type": "string",
                                            "description": "Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications."
                                        },
                                        "value": {
                                            "type": "string",
                                            "description": "Optional. Machine-readable answer submitted instead of `label`. The user always sees `label`; a program that has to read the answer reads this value. Use it when the runtime asks for a specific option value (for example a workflow that must act on the choice)."
                                        }
                                    },
                                    "required": [
                                        "label",
                                        "description"
                                    ],
                                    "additionalProperties": false
                                },
                                "minItems": 2,
                                "maxItems": 10,
                                "description": "The available choices for this question. Must have 2-10 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). There should be no 'Other' option, that will be provided automatically."
                            },
                            "multiSelect": {
                                "type": "boolean",
                                "default": false,
                                "description": "Optional. Defaults to false. Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive."
                            },
                            "inputPlaceholder": {
                                "type": "string",
                                "description": "Optional. When provided, the question shows a text input below the options with this placeholder text. The submitted answer prefers the typed value over the selected option. Use it when the user may need to provide a custom value (e.g. a path) beyond the predefined choices."
                            }
                        },
                        "required": [
                            "question",
                            "header",
                            "options"
                        ],
                        "additionalProperties": false
                    },
                    "minItems": 1,
                    "maxItems": 4,
                    "description": "Questions to ask the user (1-4 questions). May be an empty array when templateId is provided."
                },
                "templateId": {
                    "type": "string",
                    "description": "Optional. Reference to a static backend question template (e.g. \"qt-migration-paths\"). When provided, the questions are loaded from the template and any inline `questions` array is ignored. Prefer this over hand-writing questions when a fixed confirmation flow exists."
                },
                "candidates": {
                    "type": "object",
                    "description": "Optional. Map of field_id -> list of candidate paths probed by the Agent, used to fill option labels when templateId is provided. Fields without candidates get empty options and the UI shows only the text input. Only effective with templateId; ignored for inline questions.",
                    "additionalProperties": {
                        "type": "array",
                        "items": { "type": "string" }
                    }
                }
            },
            "additionalProperties": false,
        })
    }

    fn is_readonly(&self) -> bool {
        true
    }

    fn is_concurrency_safe(&self, _input: Option<&Value>) -> bool {
        true
    }

    fn manages_own_execution_timeout(&self) -> bool {
        true
    }

    async fn is_available_in_context(&self, context: Option<&ToolUseContext>) -> bool {
        Self::is_available_for_tool_context(context)
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        if !Self::is_available_for_tool_context(Some(context)) {
            return Err(crate::util::errors::BitFunError::tool(
                "AskUserQuestion is unavailable because this execution surface cannot accept interactive user input",
            ));
        }

        // 1. Parse input parameters
        let raw_input: Value = input.clone();
        let mut tool_input: AskUserQuestionInput =
            serde_json::from_value(input.clone()).map_err(|e| {
                crate::util::errors::BitFunError::Validation(format!(
                    "Failed to parse input parameters: {}",
                    e
                ))
            })?;

        // 1b. Load questions (+ backend presentation policy + version) from a
        // static backend template when templateId is referenced. Template
        // content is backend-owned: the model cannot rephrase or drop fields,
        // and inline `presentation` is never accepted from the model. The
        // contribution owns candidate preparation and the render end to end.
        let mut resolved_request: Option<ResolvedQuestionRequest> = None;
        if let Some(template_id) = tool_input.template_id.clone() {
            let contribution = context
                .runtime_handles
                .question_template_registry()
                .and_then(|registry| registry.get(&template_id))
                .ok_or_else(|| {
                    crate::util::errors::BitFunError::Validation(format!(
                        "Unknown AskUserQuestion template: {template_id}"
                    ))
                })?;

            let candidates: std::collections::HashMap<String, Vec<String>> = input
                .get("candidates")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();

            // Host resources are pre-resolved into plain data; a listing that
            // could not be produced is `None`, not an empty workspace.
            let workspace_root = context.workspace_root();
            let workspace_is_remote = context.is_remote();
            let workspace_dir_entries = match (&workspace_root, workspace_is_remote) {
                (Some(workspace), false) => {
                    let listing = match context.workspace_services() {
                        Some(services) => services
                            .fs
                            .read_dir(&workspace.to_string_lossy())
                            .await
                            .ok(),
                        None => None,
                    };
                    listing.map(|entries| {
                        entries
                            .into_iter()
                            .map(|entry| bitfun_runtime_ports::TemplateDirEntry {
                                name: entry.name,
                                path: entry.path,
                                is_dir: entry.is_dir,
                                is_symlink: entry.is_symlink,
                            })
                            .collect::<Vec<_>>()
                    })
                }
                _ => None,
            };
            let managed_resources_root =
                Some(crate::infrastructure::get_path_manager_arc().qt_migration_root_dir());
            let official_toolchain_qt_major = {
                #[cfg(feature = "qt-toolchain")]
                {
                    Some(bitfun_runtime_ports::QT_MIGRATION_OFFICIAL_QT_MAJOR)
                }
                #[cfg(not(feature = "qt-toolchain"))]
                {
                    None
                }
            };

            let template_context = bitfun_runtime_ports::TemplateContext {
                template_id: template_id.as_str(),
                candidates: &candidates,
                raw_input: &raw_input,
                context_vars: &context.custom_data,
                workspace_root,
                workspace_is_remote,
                workspace_dir_entries: workspace_dir_entries.as_deref(),
                managed_resources_root: managed_resources_root.as_deref(),
                official_toolchain_qt_major,
            };
            let resolved = contribution
                .render(&template_context)
                .map_err(|rejection| {
                    crate::util::errors::BitFunError::Validation(rejection.message)
                })?;
            // The opaque payload travels back verbatim under `templatePayload`,
            // plus the template's legacy wire field for older surfaces.
            let legacy_payload = match (&resolved.payload, contribution.legacy_payload_wire_field())
            {
                (Some(payload), Some(_)) => Some(payload.clone()),
                _ => None,
            };
            tool_input.questions = resolved.questions.clone();
            resolved_request = Some(ResolvedQuestionRequest {
                raw_params: raw_input,
                resolved_questions: resolved.questions,
                presentation: Some(resolved.presentation),
                template_id: Some(template_id),
                template_version: Some(resolved.template_version),
                template_payload: resolved.payload,
                qt_migration_questions: legacy_payload,
            });
        }

        // 2. Validate question format. Template-resolved questions are backend-owned
        // and may carry a single candidate option (one probed path) next to the
        // text input, and their text fields are i18n keys (header included), so
        // the strict 2-10 options and 20-char header guards only apply to
        // model-written questions.
        if let Err(error) =
            validate_ask_user_question_input(&tool_input, resolved_request.is_some())
        {
            return Err(crate::util::errors::BitFunError::Validation(error));
        }

        let question_count = tool_input.questions.len();
        debug!(
            "AskUserQuestion tool called with {} question(s)",
            question_count
        );

        // 3. Generate tool ID
        let tool_id = Self::generate_tool_id(context);

        let session_id = context
            .session_id
            .clone()
            .unwrap_or_else(|| "unknown".to_string());
        let model_round_id = context
            .custom_data
            .get(USER_INPUT_MODEL_ROUND_CONTEXT_KEY)
            .and_then(Value::as_str)
            .map(str::to_string);

        // 4. Create oneshot channel
        let (tx, rx) = tokio::sync::oneshot::channel();

        // 5. Register the channel together with the replayable request before
        // emitting. The registration carries the template metadata bound at
        // resolve time so answer submission can re-validate answers against
        // the exact request; the guard removes it if cancellation drops this
        // Tool future, so later Surface snapshots cannot revive stale questions.
        let manager = get_user_input_manager();
        let pending_meta = PendingQuestionRequestMeta {
            session_id: session_id.clone(),
            template_id: resolved_request
                .as_ref()
                .and_then(|resolved| resolved.template_id.clone()),
            template_version: resolved_request
                .as_ref()
                .and_then(|resolved| resolved.template_version.clone()),
            required_fields: resolved_request
                .as_ref()
                .and_then(|resolved| resolved.presentation.as_ref())
                .and_then(|presentation| presentation.required_fields.clone()),
        };

        // Send the resolved payload to the frontend: template-backed calls carry the
        // immutable raw params plus resolvedQuestions/presentation/templateVersion;
        // plain questions keep their original shape so existing consumers are
        // unaffected.
        let payload = if let Some(resolved) = &resolved_request {
            serde_json::to_value(resolved).unwrap_or_else(|_| json!({}))
        } else {
            serde_json::to_value(&tool_input).unwrap_or_else(|_| json!({}))
        };
        let registration = manager.register_question_with_controllers(
            PendingUserQuestion::new_with_meta(
                tool_id.clone(),
                session_id.clone(),
                context.dialog_turn_id.clone(),
                model_round_id,
                payload.clone(),
                Some(pending_meta),
            ),
            tx,
            Self::question_controllers(context).await,
        );

        // 6. Send backend event to notify frontend to display question card
        let event_system = get_global_event_system();
        debug!(
            "AskUserQuestion emit ToolAwaitingUserInput: tool_id={}, template={:?}, question_count={}",
            tool_id, tool_input.template_id, question_count
        );
        let event = BackendEvent::ToolAwaitingUserInput {
            tool_id: tool_id.clone(),
            session_id,
            questions: payload,
        };

        log::info!(
            "AskUserQuestion awaiting user input, emitting ToolAwaitingUserInput: tool_id={}",
            tool_id
        );
        if let Err(error) = event_system.emit(event).await {
            warn!("AskUserQuestion failed to emit ToolAwaitingUserInput: {error}");
        }
        debug!(
            "AskUserQuestion tool event emitted, waiting for user input, tool_id: {}",
            tool_id
        );

        // 7. Bound the wait in the runtime host, including for remote driving surfaces.
        // The registration guard clears replay state on timeout or turn cancellation.
        // A template that owns its wait (`allowTimeout: false`, the Qt migration
        // intake) passes `None`: its answers are required to start the work, so
        // giving up would silently skip them.
        match wait_for_user_question_response(
            &registration,
            rx,
            unattended_question_timeout(
                resolved_request
                    .as_ref()
                    .and_then(|resolved| resolved.presentation.as_ref()),
                tool_input.timeout_seconds,
            ),
        )
        .await
        {
            UserQuestionWaitOutcome::Answered(response) => {
                debug!(
                    "AskUserQuestion tool received user response, tool_id: {}",
                    tool_id
                );
                let mut result =
                    build_answered_user_question_result(&tool_input, response.answers.clone());
                // A decided consequence must reach the model on this very tool
                // result — the moment it resumes, inside the current turn.
                let follow_ups = Self::answer_receipt_facts(
                    resolved_request.as_ref(),
                    &response.answers,
                    context,
                );
                if !follow_ups.is_empty() {
                    result.result_for_assistant.push_str("\n\n");
                    result
                        .result_for_assistant
                        .push_str(&follow_ups.join("\n\n"));
                }

                Ok(vec![ToolResult::Result {
                    data: result.data,
                    result_for_assistant: Some(result.result_for_assistant),
                    image_attachments: None,
                }])
            }
            UserQuestionWaitOutcome::TimedOut => {
                debug!("AskUserQuestion timed out, tool_id: {}", tool_id);
                let result = build_timed_out_user_question_result(&tool_input);
                Ok(vec![ToolResult::Result {
                    data: result.data,
                    result_for_assistant: Some(result.result_for_assistant),
                    image_attachments: None,
                }])
            }
            UserQuestionWaitOutcome::Cancelled => {
                warn!("AskUserQuestion tool channel closed, tool_id: {}", tool_id);
                let result = build_cancelled_user_question_result(&tool_input);
                Ok(vec![ToolResult::Result {
                    data: result.data,
                    result_for_assistant: Some(result.result_for_assistant),
                    image_attachments: None,
                }])
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::AskUserQuestionTool;
    use crate::agentic::tools::framework::{Tool, ToolUseContext};
    use crate::agentic::tools::user_input_manager::get_user_input_manager;
    use bitfun_agent_runtime::user_questions::USER_INPUT_MODEL_ROUND_CONTEXT_KEY;
    use std::collections::HashMap;
    use std::sync::Arc;

    fn context_with_custom_data(custom_data: HashMap<String, serde_json::Value>) -> ToolUseContext {
        ToolUseContext {
            tool_call_id: None,
            agent_type: None,
            session_id: None,
            dialog_turn_id: None,
            workspace: None,
            loaded_deferred_tool_specs: Vec::new(),
            primary_model_facts: tool_runtime::context::PrimaryModelFacts::default(),
            custom_data,
            computer_use_host: None,
            runtime_tool_restrictions: Default::default(),
            runtime_handles: bitfun_runtime_ports::ToolRuntimeHandles::default(),
        }
    }

    fn context_with_original_user_input(input: &str) -> ToolUseContext {
        context_with_custom_data(HashMap::from([(
            "original_user_input".to_string(),
            serde_json::Value::String(input.to_string()),
        )]))
    }

    /// Attach the assembled question-template registry the way the real tool
    /// runtime wires it, so template-backed calls reach their contribution.
    fn with_question_template_registry(mut context: ToolUseContext) -> ToolUseContext {
        context.runtime_handles = context
            .runtime_handles
            .with_question_template_registry(Some(Arc::new(
                crate::agentic::tools::tool_admission::assemble_question_template_registry(),
            )));
        context
    }

    #[tokio::test]
    async fn qt_migration_template_rejects_request_without_harmonyos_target() {
        let tool = AskUserQuestionTool::new();
        let context =
            with_question_template_registry(context_with_original_user_input("将QT工程迁移"));
        let input = serde_json::json!({ "templateId": "qt-migration-paths" });

        let error = tool
            .call(&input, &context)
            .await
            .expect_err("incomplete migration intent must not show the path card");

        assert!(error
            .to_string()
            .contains("available only for a classified Qt to HarmonyOS migration request"));
    }

    #[tokio::test]
    async fn qt_migration_template_accepts_explicit_harmonyos_target() {
        let tool = AskUserQuestionTool::new();
        let unique = uuid::Uuid::new_v4().to_string();
        let tool_id = format!("qt-question-{unique}");
        let mut context = with_question_template_registry(context_with_original_user_input(
            "将QT工程迁移成鸿蒙工程",
        ));
        context.custom_data.insert(
            "qt_migration_enabled".to_string(),
            serde_json::Value::Bool(true),
        );
        context.tool_call_id = Some(tool_id.clone());
        let input = serde_json::json!({ "templateId": "qt-migration-paths" });

        // Drive the tool future on its own task: it blocks on the user answer
        // while the main task waits for the question to reach the mailbox.
        let handle = tokio::spawn(async move { tool.call(&input, &context).await });

        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                if get_user_input_manager().has_pending(&tool_id) {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("explicit migration intent should reach the question mailbox");

        assert!(get_user_input_manager().cancel(&tool_id));
        let result = tokio::time::timeout(std::time::Duration::from_secs(5), handle)
            .await
            .expect("cancelled question should resume");
        result
            .expect("tool task must join")
            .expect("template call should be accepted");
    }

    #[tokio::test]
    async fn ask_user_question_is_hidden_for_acp_transport() {
        let tool = AskUserQuestionTool::new();
        let mut custom_data = HashMap::new();
        custom_data.insert(
            "acp_transport".to_string(),
            serde_json::Value::String("true".to_string()),
        );
        let context = context_with_custom_data(custom_data);

        assert!(!tool.is_available_in_context(Some(&context)).await);
    }

    #[tokio::test]
    async fn ask_user_question_remains_available_without_acp_transport() {
        let tool = AskUserQuestionTool::new();
        let context = context_with_custom_data(HashMap::new());

        assert!(tool.is_available_in_context(Some(&context)).await);
    }

    #[tokio::test]
    async fn ask_user_question_is_hidden_when_human_input_is_unavailable() {
        let tool = AskUserQuestionTool::new();
        let context = context_with_custom_data(HashMap::from([(
            "user_input_available".to_string(),
            serde_json::Value::Bool(false),
        )]));

        assert!(!tool.is_available_in_context(Some(&context)).await);
    }

    #[tokio::test]
    async fn ask_user_question_fails_without_waiting_when_human_input_is_unavailable() {
        let tool = AskUserQuestionTool::new();
        let context = context_with_custom_data(HashMap::from([(
            "user_input_available".to_string(),
            serde_json::Value::Bool(false),
        )]));
        let input = serde_json::json!({
            "questions": [{
                "question": "Continue?",
                "header": "Continue",
                "options": [
                    { "label": "Yes", "description": "Continue" },
                    { "label": "No", "description": "Stop" }
                ]
            }]
        });

        let error = tokio::time::timeout(
            std::time::Duration::from_millis(100),
            tool.call(&input, &context),
        )
        .await
        .expect("non-interactive question must not wait")
        .expect_err("non-interactive question must fail");

        assert!(error.to_string().contains("cannot accept interactive"));
    }

    #[test]
    fn ask_user_question_schema_defaults_multi_select_to_false() {
        let schema = AskUserQuestionTool::new().input_schema();
        let question_schema = &schema["properties"]["questions"]["items"];

        assert_eq!(
            question_schema["properties"]["multiSelect"]["default"],
            false
        );
        assert!(!question_schema["required"]
            .as_array()
            .expect("required array")
            .iter()
            .any(|value| value == "multiSelect"));
    }

    #[tokio::test]
    async fn pending_question_remains_replayable_until_the_tool_receives_an_answer() {
        let tool = AskUserQuestionTool::new();
        let unique = uuid::Uuid::new_v4().to_string();
        let session_id = format!("session-{unique}");
        let turn_id = format!("turn-{unique}");
        let round_id = format!("round-{unique}");
        let tool_id = format!("tool-{unique}");
        let mut context = context_with_custom_data(HashMap::from([(
            USER_INPUT_MODEL_ROUND_CONTEXT_KEY.to_string(),
            serde_json::json!(round_id),
        )]));
        context.session_id = Some(session_id.clone());
        context.dialog_turn_id = Some(turn_id.clone());
        context.tool_call_id = Some(tool_id.clone());
        let input = serde_json::json!({
            "questions": [{
                "question": "Continue?",
                "header": "Continue",
                "options": [
                    { "label": "Yes", "description": "Continue" },
                    { "label": "No", "description": "Stop" }
                ]
            }]
        });

        let call = tool.call(&input, &context);
        tokio::pin!(call);
        let mailbox_registration = async {
            loop {
                let snapshot = get_user_input_manager().pending_question_snapshot(&session_id);
                if let Some(question) = snapshot.questions.first() {
                    assert_eq!(question.tool_id, tool_id);
                    assert_eq!(question.dialog_turn_id.as_deref(), Some(turn_id.as_str()));
                    assert_eq!(question.model_round_id.as_deref(), Some(round_id.as_str()));
                    assert_eq!(
                        question.questions,
                        serde_json::json!({
                            "questions": [{
                                "question": "Continue?",
                                "header": "Continue",
                                "options": [
                                    { "label": "Yes", "description": "Continue" },
                                    { "label": "No", "description": "Stop" }
                                ],
                                "multiSelect": false
                            }]
                        })
                    );
                    break;
                }
                tokio::task::yield_now().await;
            }
        };
        tokio::pin!(mailbox_registration);
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            tokio::select! {
                _ = &mut call => panic!("question Tool completed before receiving an answer"),
                _ = &mut mailbox_registration => {}
            }
        })
        .await
        .expect("question should enter the Runtime mailbox");

        get_user_input_manager()
            .send_answer(&tool_id, serde_json::json!({ "0": "Yes" }))
            .expect("answer should reach the waiting Tool");
        tokio::time::timeout(std::time::Duration::from_secs(1), &mut call)
            .await
            .expect("answered Tool should resume")
            .expect("answered Tool should succeed");

        assert!(get_user_input_manager()
            .pending_question_snapshot(&session_id)
            .questions
            .is_empty());
    }
    #[tokio::test]
    async fn parent_controller_can_stop_and_cancel_child_question() {
        let unique = uuid::Uuid::new_v4().to_string();
        let child = format!("child-{unique}");
        let parent = format!("parent-{unique}");
        let mut context = context_with_custom_data(HashMap::from([(
            bitfun_agent_runtime::user_questions::USER_INPUT_PARENT_CONTEXT_KEY.to_string(),
            serde_json::json!({ "session_id": parent, "dialog_turn_id": "parent-turn" }),
        )]));
        context.session_id = Some(child.clone());
        context.tool_call_id = Some(unique.clone());
        let input = serde_json::json!({"timeout_seconds": 1, "questions": [{
            "question": "Continue?", "header": "Continue", "options": [
                {"label": "Yes", "description": "Continue"}, {"label": "No", "description": "Stop"}
            ]
        }]});
        let task =
            tokio::spawn(async move { AskUserQuestionTool::new().call(&input, &context).await });
        let manager = get_user_input_manager();
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while !manager.has_pending(&unique) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        manager.start_interaction(&parent, &unique).unwrap();
        assert_eq!(
            manager.pending_question_snapshot(&parent).questions[0]
                .dialog_turn_id
                .as_deref(),
            Some("parent-turn")
        );
        assert!(manager.start_interaction("unrelated", &unique).is_err());
        manager.cancel_for_session(&parent, &unique).unwrap();
        let result = task.await.unwrap().unwrap();
        match &result[0] {
            crate::agentic::tools::framework::ToolResult::Result { data, .. } => {
                assert_eq!(data["status"], "cancelled")
            }
            _ => panic!("expected cancellation result"),
        }
        assert!(manager
            .pending_question_snapshot(&child)
            .questions
            .is_empty());
    }

    #[test]
    fn timeout_schema_is_optional_and_owned_by_the_tool() {
        let tool = AskUserQuestionTool::new();
        let schema = tool.input_schema();
        assert_eq!(schema["properties"]["timeout_seconds"]["default"], 30);
        assert_eq!(schema["properties"]["timeout_seconds"]["minimum"], 1);
        assert_eq!(schema["required"], serde_json::json!(["questions"]));
        assert!(tool.manages_own_execution_timeout());
    }

    #[test]
    fn unattended_timeout_follows_the_template_policy() {
        use bitfun_agent_runtime::user_questions::QuestionPresentation;

        let presentation = |allow_timeout: bool| QuestionPresentation {
            layout: "wizard".to_string(),
            allow_skip: false,
            intro_key: None,
            hint_key: None,
            required_fields: None,
            allow_timeout,
        };

        // No resolved template: the model's bound applies as before.
        assert_eq!(
            super::unattended_question_timeout(None, 30),
            Some(std::time::Duration::from_secs(30))
        );
        // A template that tolerates a skip keeps the model's bound.
        assert_eq!(
            super::unattended_question_timeout(Some(&presentation(true)), 7),
            Some(std::time::Duration::from_secs(7))
        );
        // The Qt intake owns its wait: any caller-supplied bound is ignored.
        assert_eq!(
            super::unattended_question_timeout(Some(&presentation(false)), 30),
            None
        );
    }

    async fn assert_question_times_out(timeout_seconds: Option<u32>) {
        let unique = uuid::Uuid::new_v4().to_string();
        let mut context = context_with_custom_data(HashMap::new());
        context.session_id = Some(unique.clone());
        context.tool_call_id = Some(unique.clone());
        let mut input = serde_json::json!({
            "questions": [{
                "question": "Continue?", "header": "Continue",
                "options": [
                    { "label": "Yes", "description": "Continue" },
                    { "label": "No", "description": "Stop" }
                ]
            }]
        });
        if let Some(seconds) = timeout_seconds {
            input["timeout_seconds"] = serde_json::json!(seconds);
        }
        let expected = std::time::Duration::from_secs(u64::from(timeout_seconds.unwrap_or(30)));
        let started = tokio::time::Instant::now();
        let result = tokio::time::timeout(
            expected + std::time::Duration::from_secs(5),
            AskUserQuestionTool::new().call(&input, &context),
        )
        .await
        .expect("question must finish without a user response")
        .unwrap();
        assert!(started.elapsed() >= expected);
        match &result[0] {
            crate::agentic::tools::framework::ToolResult::Result {
                data,
                result_for_assistant,
                ..
            } => {
                assert_eq!(data["status"], "timeout");
                assert_eq!(
                    result_for_assistant.as_deref(),
                    Some("用户无响应，跳过提问，继续执行")
                );
            }
            _ => panic!("timeout must return a normal tool result"),
        }
        let manager = get_user_input_manager();
        assert!(manager
            .pending_question_snapshot(&unique)
            .questions
            .is_empty());
        assert!(!manager.has_pending(&unique));
        assert!(manager
            .send_answer(&unique, serde_json::json!({ "0": "Yes" }))
            .is_err());
    }

    #[tokio::test]
    async fn unanswered_question_defaults_to_thirty_seconds_and_rejects_late_answers() {
        assert_question_times_out(None).await;
    }

    #[tokio::test]
    async fn unanswered_question_honors_shorter_timeout() {
        assert_question_times_out(Some(1)).await;
    }
    #[tokio::test]
    async fn unanswered_question_honors_longer_timeout() {
        assert_question_times_out(Some(31)).await;
    }
}
