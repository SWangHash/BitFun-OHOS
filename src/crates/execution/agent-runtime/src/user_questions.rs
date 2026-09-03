//! Portable contracts for user-question tool handlers.

use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, Weak};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::oneshot;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QuestionOption {
    pub label: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Question {
    pub question: String,
    pub header: String,
    pub options: Vec<QuestionOption>,
    #[serde(rename = "multiSelect", default)]
    pub multi_select: bool,
    /// Optional placeholder for a custom text input shown below the options.
    /// When present, the question always shows a text input and the submitted
    /// answer prefers the typed value over the selected option. Omitted when
    /// not provided so the frontend can distinguish "no input" from "empty".
    #[serde(
        rename = "inputPlaceholder",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub input_placeholder: Option<String>,
    /// Field id the answer binds to (template-backed questions only, e.g.
    /// `source_project`). Plain model-authored questions omit it and the
    /// frontend keys answers by question index.
    #[serde(rename = "field", default, skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    /// Whether the question must be answered (backend template declares this;
    /// the model can never widen it via inline `presentation`). Serialized only
    /// when true so plain model questions keep their historical wire shape.
    #[serde(
        rename = "required",
        default,
        skip_serializing_if = "std::ops::Not::not"
    )]
    pub required: bool,
}

/// Template-level presentation policy. Only the backend versioned template
/// produces this; inline model `presentation` is ignored. The frontend renders
/// generically and must NOT branch on `templateId`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QuestionPresentation {
    /// `list` (render all at once) or `wizard` (one question per step).
    #[serde(default = "default_presentation_layout")]
    pub layout: String,
    #[serde(rename = "allowSkip", default)]
    pub allow_skip: bool,
    /// i18n key for explanatory text rendered immediately before the question
    /// card. Template-owned so hosts do not branch on `templateId`.
    #[serde(rename = "introKey", default, skip_serializing_if = "Option::is_none")]
    pub intro_key: Option<String>,
    /// i18n key for the footer hint, rendered only when provided.
    #[serde(rename = "hintKey", default, skip_serializing_if = "Option::is_none")]
    pub hint_key: Option<String>,
    /// Field ids that must be answered (backend re-checks on submit).
    #[serde(
        rename = "requiredFields",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub required_fields: Option<Vec<String>>,
}

fn default_presentation_layout() -> String {
    "list".to_string()
}

/// Single source of truth for the event payload that reaches every host:
/// raw model params stay immutable for replay/audit, while the actually-waited
/// questions, backend policy, and template version travel alongside as
/// separate facts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResolvedQuestionRequest {
    /// Immutable raw tool-call input as emitted by the model.
    #[serde(rename = "params")]
    pub raw_params: Value,
    /// Questions this tool invocation actually waits on (UI renders these).
    #[serde(rename = "resolvedQuestions")]
    pub resolved_questions: Vec<Question>,
    /// Backend-derived presentation policy; `None` for plain questions.
    #[serde(
        rename = "presentation",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub presentation: Option<QuestionPresentation>,
    #[serde(
        rename = "templateId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub template_id: Option<String>,
    #[serde(
        rename = "templateVersion",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub template_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AskUserQuestionInput {
    /// Questions provided directly by the model. May be empty when
    /// `templateId` is set (the tool then loads questions from the backend
    /// template registry).
    #[serde(default)]
    pub questions: Vec<Question>,
    /// Optional reference to a static backend question template. When set, the
    /// tool loads the questions itself and ignores `questions`. Kept opaque to
    /// the model so template content stays accurate.
    #[serde(
        rename = "templateId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub template_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserQuestionToolResult {
    pub data: Value,
    pub result_for_assistant: String,
}

#[derive(Debug, Clone)]
pub struct UserInputResponse {
    pub answers: Value,
}

/// Pending-request metadata captured when a question tool registers its waiting
/// channel. Answer submission re-validates the payload against the exact
/// template this request references, so the answering host does not need to
/// know or trust template details.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PendingQuestionRequestMeta {
    /// Session the waiting question tool call belongs to.
    #[serde(
        rename = "sessionId",
        default,
        skip_serializing_if = "String::is_empty"
    )]
    pub session_id: String,
    /// Backend template id the request resolved from (None for plain questions).
    #[serde(
        rename = "templateId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub template_id: Option<String>,
    /// Template version the waiting request was bound to at emit time.
    #[serde(
        rename = "templateVersion",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub template_version: Option<String>,
    /// Required field ids carried by the waiting template.
    #[serde(
        rename = "requiredFields",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub required_fields: Option<Vec<String>>,
}

impl PendingQuestionRequestMeta {
    /// Build a `PendingUserQuestion` bound to this template metadata.
    pub fn into_pending_question(
        &self,
        tool_id: impl Into<String>,
        dialog_turn_id: Option<String>,
        model_round_id: Option<String>,
        questions: Value,
    ) -> PendingUserQuestion {
        PendingUserQuestion::new_with_meta(
            tool_id,
            self.session_id.clone(),
            dialog_turn_id,
            model_round_id,
            questions,
            Some(self.clone()),
        )
    }
}

/// One blocking user-question interaction owned by the running Agent Runtime.
///
/// This is process-local live state, not persisted Session history. Product
/// surfaces use it to re-attach after an event gap without restarting or
/// cancelling the Dialog Turn that is waiting for the answer.
///
/// Template-bound requests additionally carry the backend template metadata
/// (id/version/required fields) so answer submission can re-validate the
/// payload against the exact template the request referenced.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingUserQuestion {
    pub tool_id: String,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dialog_turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_round_id: Option<String>,
    pub questions: Value,
    pub registered_at_ms: u64,
    /// Backend template id the request resolved from (None for plain questions).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
    /// Template version the waiting request was bound to at emit time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_version: Option<String>,
    /// Required field ids carried by the waiting template.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_fields: Option<Vec<String>>,
}

impl PendingUserQuestion {
    pub fn new(
        tool_id: impl Into<String>,
        session_id: impl Into<String>,
        dialog_turn_id: Option<String>,
        model_round_id: Option<String>,
        questions: Value,
    ) -> Self {
        Self {
            tool_id: tool_id.into(),
            session_id: session_id.into(),
            dialog_turn_id,
            model_round_id,
            questions,
            registered_at_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .min(u64::MAX as u128) as u64,
            template_id: None,
            template_version: None,
            required_fields: None,
        }
    }

    /// Build a pending question bound to a resolved backend template.
    pub fn new_with_meta(
        tool_id: impl Into<String>,
        session_id: impl Into<String>,
        dialog_turn_id: Option<String>,
        model_round_id: Option<String>,
        questions: Value,
        meta: Option<PendingQuestionRequestMeta>,
    ) -> Self {
        let mut question = Self::new(
            tool_id,
            session_id,
            dialog_turn_id,
            model_round_id,
            questions,
        );
        if let Some(meta) = meta {
            question.template_id = meta.template_id;
            question.template_version = meta.template_version;
            question.required_fields = meta.required_fields;
        }
        question
    }

    /// Template metadata of this pending request, when template-bound.
    pub fn meta(&self) -> Option<PendingQuestionRequestMeta> {
        if self.template_id.is_none()
            && self.template_version.is_none()
            && self.required_fields.is_none()
        {
            return None;
        }
        Some(PendingQuestionRequestMeta {
            session_id: self.session_id.clone(),
            template_id: self.template_id.clone(),
            template_version: self.template_version.clone(),
            required_fields: self.required_fields.clone(),
        })
    }
}

/// A coherent, monotonic view of the user-question mailbox for one Session.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingUserQuestionSnapshot {
    pub revision: u64,
    #[serde(default)]
    pub questions: Vec<PendingUserQuestion>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum UserInputSendError {
    #[error("Waiting channel not found: {tool_id}")]
    MissingChannel { tool_id: String },
    #[error("Channel closed, cannot send answer: {tool_id}")]
    ChannelClosed { tool_id: String },
}

struct PendingUserInput {
    sender: oneshot::Sender<UserInputResponse>,
    question: Option<PendingUserQuestion>,
    registration_sequence: u64,
}

#[derive(Default)]
struct UserInputState {
    pending: HashMap<String, PendingUserInput>,
    next_registration_sequence: u64,
    revision: u64,
}

/// Drop guard tying a pending mailbox record to the Tool future that waits on
/// it. Cancelling a Dialog Turn drops the future and therefore removes the
/// request instead of leaving an unanswerable stale interaction behind.
#[must_use = "keep the registration alive while awaiting the user response"]
pub struct UserInputRegistration {
    state: Weak<Mutex<UserInputState>>,
    tool_id: String,
    registration_sequence: u64,
}

impl Drop for UserInputRegistration {
    fn drop(&mut self) {
        let Some(state) = self.state.upgrade() else {
            return;
        };
        let mut state = lock_user_input_state(&state);
        let belongs_to_registration = state
            .pending
            .get(&self.tool_id)
            .is_some_and(|pending| pending.registration_sequence == self.registration_sequence);
        if belongs_to_registration {
            state.pending.remove(&self.tool_id);
            state.revision = state.revision.saturating_add(1);
            debug!(
                "Removed dropped user-input registration: tool_id={}",
                self.tool_id
            );
        }
    }
}

#[derive(Clone)]
pub struct UserInputManager {
    state: Arc<Mutex<UserInputState>>,
}

impl Default for UserInputManager {
    fn default() -> Self {
        Self::new()
    }
}

impl UserInputManager {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(UserInputState::default())),
        }
    }

    pub fn register_channel(&self, tool_id: String, sender: oneshot::Sender<UserInputResponse>) {
        debug!("Registered waiting channel: tool_id={}", tool_id);
        self.insert_pending(tool_id, sender, None);
    }

    /// Register a replayable user question and return the lifetime guard for
    /// the Tool future that owns it.
    pub fn register_question(
        &self,
        question: PendingUserQuestion,
        sender: oneshot::Sender<UserInputResponse>,
    ) -> UserInputRegistration {
        let tool_id = question.tool_id.clone();
        debug!(
            "Registered pending user question: tool_id={}, session_id={}, template={:?}",
            tool_id, question.session_id, question.template_id
        );
        let registration_sequence = self.insert_pending(tool_id.clone(), sender, Some(question));
        UserInputRegistration {
            state: Arc::downgrade(&self.state),
            tool_id,
            registration_sequence,
        }
    }

    fn insert_pending(
        &self,
        tool_id: String,
        sender: oneshot::Sender<UserInputResponse>,
        question: Option<PendingUserQuestion>,
    ) -> u64 {
        let mut state = lock_user_input_state(&self.state);
        let registration_sequence = state.next_registration_sequence;
        state.next_registration_sequence = state.next_registration_sequence.saturating_add(1);
        state.pending.insert(
            tool_id,
            PendingUserInput {
                sender,
                question,
                registration_sequence,
            },
        );
        state.revision = state.revision.saturating_add(1);
        registration_sequence
    }

    pub fn send_answer(&self, tool_id: &str, answers: Value) -> Result<(), UserInputSendError> {
        info!("Sending user answer: tool_id={}", tool_id);

        let pending = {
            let mut state = lock_user_input_state(&self.state);
            let pending = state.pending.remove(tool_id);
            if pending.is_some() {
                state.revision = state.revision.saturating_add(1);
            }
            pending
        };
        if let Some(pending) = pending {
            let response = UserInputResponse { answers };
            pending
                .sender
                .send(response)
                .map_err(|_| UserInputSendError::ChannelClosed {
                    tool_id: tool_id.to_string(),
                })?;
            debug!("Answer sent: tool_id={}", tool_id);
            Ok(())
        } else {
            let error = UserInputSendError::MissingChannel {
                tool_id: tool_id.to_string(),
            };
            warn!("{}", error);
            Err(error)
        }
    }

    pub fn cancel(&self, tool_id: &str) -> bool {
        let removed = {
            let mut state = lock_user_input_state(&self.state);
            let removed = state.pending.remove(tool_id).is_some();
            if removed {
                state.revision = state.revision.saturating_add(1);
            }
            removed
        };
        if removed {
            debug!("Cancelled waiting: tool_id={}", tool_id);
            true
        } else {
            false
        }
    }

    pub fn has_pending(&self, tool_id: &str) -> bool {
        lock_user_input_state(&self.state)
            .pending
            .contains_key(tool_id)
    }

    pub fn pending_tool_ids(&self) -> Vec<String> {
        let state = lock_user_input_state(&self.state);
        let mut pending = state
            .pending
            .iter()
            .map(|(tool_id, entry)| (entry.registration_sequence, tool_id.clone()))
            .collect::<Vec<_>>();
        pending.sort_by_key(|(sequence, _)| *sequence);
        pending.into_iter().map(|(_, tool_id)| tool_id).collect()
    }

    pub fn pending_question_snapshot(&self, session_id: &str) -> PendingUserQuestionSnapshot {
        let state = lock_user_input_state(&self.state);
        let mut questions = state
            .pending
            .values()
            .filter_map(|pending| {
                pending
                    .question
                    .as_ref()
                    .filter(|question| question.session_id == session_id)
                    .cloned()
                    .map(|question| (pending.registration_sequence, question))
            })
            .collect::<Vec<_>>();
        questions.sort_by_key(|(sequence, _)| *sequence);
        PendingUserQuestionSnapshot {
            revision: state.revision,
            questions: questions
                .into_iter()
                .map(|(_, question)| question)
                .collect(),
        }
    }

    /// Metadata of the currently registered waiting request, if the request was
    /// template-bound at registration time.
    pub fn pending_meta(&self, tool_id: &str) -> Option<PendingQuestionRequestMeta> {
        lock_user_input_state(&self.state)
            .pending
            .get(tool_id)
            .and_then(|pending| {
                pending
                    .question
                    .as_ref()
                    .and_then(|question| question.meta())
            })
    }
}

fn lock_user_input_state(state: &Mutex<UserInputState>) -> MutexGuard<'_, UserInputState> {
    state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub static USER_INPUT_MANAGER: LazyLock<UserInputManager> = LazyLock::new(|| {
    debug!("Initializing global user input manager");
    UserInputManager::new()
});

pub fn get_user_input_manager() -> &'static UserInputManager {
    &USER_INPUT_MANAGER
}

pub const USER_INPUT_AVAILABLE_CONTEXT_KEY: &str = "user_input_available";
/// Internal ToolUseContext key carrying the model round that owns a question.
pub const USER_INPUT_MODEL_ROUND_CONTEXT_KEY: &str = "user_input_model_round_id";

pub fn ask_user_question_available_for_acp_transport(acp_transport: Option<&Value>) -> bool {
    !acp_transport.is_some_and(|value| value == "true" || value == &json!(true))
}

pub fn ask_user_question_available_in_context(
    acp_transport: Option<&Value>,
    user_input_available: Option<&Value>,
) -> bool {
    ask_user_question_available_for_acp_transport(acp_transport)
        && !user_input_available.is_some_and(|value| value == "false" || value == &json!(false))
}

/// Validate an `AskUserQuestion` call before it waits for user input.
///
/// `template_backed` relaxes two guards for backend-resolved template
/// questions (e.g. `qt-migration-paths`):
/// - a template field may carry exactly one candidate option (a single probed
///   path) next to its text input;
/// - `header` carries an i18n key (rendered locally by the frontend), so the
///   user-facing 20-character header limit does not apply.
/// Model-written questions must keep the strict rules (`false`).
pub fn validate_ask_user_question_input(
    input: &AskUserQuestionInput,
    template_backed: bool,
) -> Result<(), String> {
    if input.questions.is_empty() {
        return Err("At least one question is required".to_string());
    }
    if input.questions.len() > 4 {
        return Err("Maximum 4 questions allowed".to_string());
    }

    for (q_idx, question) in input.questions.iter().enumerate() {
        let q_num = q_idx + 1;

        if question.question.trim().is_empty() {
            return Err(format!("Question {} text is required", q_num));
        }

        if question.header.trim().is_empty() {
            return Err(format!("Question {} header is required", q_num));
        }
        if !template_backed && question.header.chars().count() > 20 {
            return Err(format!(
                "Question {} header must be less than 20 characters",
                q_num
            ));
        }

        let has_single_option = template_backed && question.options.len() == 1;
        if question.options.is_empty() {
            // Text-only question: valid only when an input placeholder exists
            // (Qt migration questions are real text input with no "default
            // path" style placeholder options).
            if question.input_placeholder.is_none() {
                return Err(format!(
                    "Question {} with no options must provide inputPlaceholder",
                    q_num
                ));
            }
        } else if !has_single_option && (question.options.len() < 2 || question.options.len() > 10)
        {
            return Err(format!("Question {} must have 2-10 options", q_num));
        }

        if let Some(placeholder) = &question.input_placeholder {
            if placeholder.trim().is_empty() {
                return Err(format!(
                    "Question {} inputPlaceholder must not be empty",
                    q_num
                ));
            }
            if placeholder.chars().count() > 200 {
                return Err(format!(
                    "Question {} inputPlaceholder must be less than 200 characters",
                    q_num
                ));
            }
        }

        for (opt_idx, opt) in question.options.iter().enumerate() {
            if opt.label.trim().is_empty() {
                return Err(format!(
                    "Question {} option {} label is required",
                    q_num,
                    opt_idx + 1
                ));
            }
            if opt.description.trim().is_empty() {
                return Err(format!(
                    "Question {} option {} description is required",
                    q_num,
                    opt_idx + 1
                ));
            }
        }
    }

    Ok(())
}

pub fn build_answered_user_question_result(
    input: &AskUserQuestionInput,
    answers: Value,
) -> UserQuestionToolResult {
    let result_for_assistant = format_result_for_assistant(&input.questions, &answers);
    let questions_summary: Vec<Value> = input
        .questions
        .iter()
        .map(|question| {
            json!({
                "question": question.question,
                "header": question.header
            })
        })
        .collect();

    UserQuestionToolResult {
        data: json!({
            "questions": questions_summary,
            "answers": answers,
            "status": "answered"
        }),
        result_for_assistant,
    }
}

pub fn build_cancelled_user_question_result(
    input: &AskUserQuestionInput,
) -> UserQuestionToolResult {
    UserQuestionToolResult {
        data: json!({
            "questions_count": input.questions.len(),
            "status": "cancelled"
        }),
        result_for_assistant: "User input request was cancelled.".to_string(),
    }
}

fn format_result_for_assistant(questions: &[Question], answers: &Value) -> String {
    let answers_obj = answers
        .as_object()
        .or_else(|| answers.get("answers").and_then(|v| v.as_object()));

    if let Some(answers_map) = answers_obj {
        let mut result_lines = vec!["User has answered your questions:".to_string()];

        for (idx, question) in questions.iter().enumerate() {
            // Template-backed questions bind answers by field id; plain
            // questions keep the positional index key.
            let answer_key = question.field.clone().unwrap_or_else(|| idx.to_string());
            let answer_text = if let Some(answer_value) = answers_map.get(&answer_key) {
                if let Some(arr) = answer_value.as_array() {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                } else if let Some(s) = answer_value.as_str() {
                    s.to_string()
                } else {
                    "N/A".to_string()
                }
            } else {
                "N/A".to_string()
            };

            // Template-backed questions carry a stable `field` id (e.g.
            // `source_project`) that the plan/skill flow references; expose it
            // so the assistant can bind the confirmed value to the named
            // migration input instead of guessing from the header text.
            let field_label = question
                .field
                .as_ref()
                .map(|field| format!(" [field={field}]"))
                .unwrap_or_default();
            result_lines.push(format!(
                "- {}{} ({}): \"{}\"",
                question.question, field_label, question.header, answer_text
            ));
        }

        result_lines.push("\nYou can now continue with the user's answers in mind.".to_string());
        result_lines.join("\n")
    } else {
        "User has answered your questions (no valid answers received).".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        PendingQuestionRequestMeta, PendingUserQuestion, UserInputManager, UserInputResponse,
        UserInputSendError,
    };
    use serde_json::json;

    #[tokio::test]
    async fn user_input_manager_delivers_answer_and_clears_channel() {
        let manager = UserInputManager::new();
        let (sender, receiver) = tokio::sync::oneshot::channel::<UserInputResponse>();

        manager.register_channel("tool-1".to_string(), sender);
        assert!(manager.has_pending("tool-1"));
        manager
            .send_answer("tool-1", json!({ "0": "yes" }))
            .expect("answer should be sent");

        let response = receiver.await.expect("receiver should get answer");
        assert_eq!(response.answers, json!({ "0": "yes" }));
        assert!(!manager.has_pending("tool-1"));
    }

    #[tokio::test]
    async fn user_input_manager_cancel_closes_receiver() {
        let manager = UserInputManager::new();
        let (sender, receiver) = tokio::sync::oneshot::channel::<UserInputResponse>();

        manager.register_channel("tool-1".to_string(), sender);

        assert!(manager.cancel("tool-1"));
        assert!(receiver.await.is_err());
        assert!(!manager.cancel("tool-1"));
    }

    #[tokio::test]
    async fn user_input_manager_distinguishes_missing_and_closed_channels() {
        let manager = UserInputManager::new();
        let missing = manager
            .send_answer("missing-tool", json!({ "0": "yes" }))
            .expect_err("missing channel");
        assert_eq!(
            missing,
            UserInputSendError::MissingChannel {
                tool_id: "missing-tool".to_string(),
            }
        );

        let (sender, receiver) = tokio::sync::oneshot::channel::<UserInputResponse>();
        manager.register_channel("closed-tool".to_string(), sender);
        drop(receiver);
        let closed = manager
            .send_answer("closed-tool", json!({ "0": "yes" }))
            .expect_err("closed channel");
        assert_eq!(
            closed,
            UserInputSendError::ChannelClosed {
                tool_id: "closed-tool".to_string(),
            }
        );
    }

    #[test]
    fn user_input_manager_reports_pending_tool_ids() {
        let manager = UserInputManager::new();
        let (sender, _receiver) = tokio::sync::oneshot::channel::<UserInputResponse>();

        manager.register_channel("tool-1".to_string(), sender);

        assert_eq!(manager.pending_tool_ids(), vec!["tool-1".to_string()]);
    }

    #[tokio::test]
    async fn pending_question_snapshot_survives_event_gaps_until_answered() {
        let manager = UserInputManager::new();
        let (sender, receiver) = tokio::sync::oneshot::channel::<UserInputResponse>();
        let question = PendingUserQuestion::new(
            "tool-1",
            "session-1",
            Some("turn-1".to_string()),
            Some("round-1".to_string()),
            json!({"questions": [{"question": "Continue?"}]}),
        );
        let registration = manager.register_question(question.clone(), sender);

        let pending = manager.pending_question_snapshot("session-1");
        assert_eq!(pending.questions, vec![question]);
        assert!(pending.revision > 0);

        manager
            .send_answer("tool-1", json!({"0": "yes"}))
            .expect("answer should be sent");
        assert_eq!(
            receiver.await.expect("receiver should get answer").answers,
            json!({"0": "yes"})
        );
        assert!(manager
            .pending_question_snapshot("session-1")
            .questions
            .is_empty());
        drop(registration);
    }

    #[test]
    fn dropping_question_registration_cleans_up_cancelled_turn_state() {
        let manager = UserInputManager::new();
        let (sender, _receiver) = tokio::sync::oneshot::channel::<UserInputResponse>();
        let registration = manager.register_question(
            PendingUserQuestion::new(
                "tool-1",
                "session-1",
                Some("turn-1".to_string()),
                Some("round-1".to_string()),
                json!({"questions": []}),
            ),
            sender,
        );
        let registered_revision = manager.pending_question_snapshot("session-1").revision;

        drop(registration);

        let after_drop = manager.pending_question_snapshot("session-1");
        assert!(after_drop.questions.is_empty());
        assert!(after_drop.revision > registered_revision);
    }

    #[tokio::test]
    async fn registered_meta_is_queryable_while_pending_and_dropped_after_answer() {
        let manager = UserInputManager::new();
        let (sender, receiver) = tokio::sync::oneshot::channel::<UserInputResponse>();
        let meta = PendingQuestionRequestMeta {
            session_id: "session-1".to_string(),
            template_id: Some("qt-migration-paths".to_string()),
            template_version: Some("1".to_string()),
            required_fields: Some(vec![
                "source_project".to_string(),
                "output_project".to_string(),
                "toolchain".to_string(),
                "template".to_string(),
            ]),
        };
        let question = PendingUserQuestion::new_with_meta(
            "tool-meta",
            "session-1",
            Some("turn-1".to_string()),
            Some("round-1".to_string()),
            json!({ "templateId": "qt-migration-paths" }),
            Some(meta.clone()),
        );
        let registration = manager.register_question(question.clone(), sender);

        assert_eq!(
            manager
                .pending_meta("tool-meta")
                .expect("meta present while pending"),
            meta
        );
        assert!(manager.pending_meta("missing-tool").is_none());

        manager
            .send_answer("tool-meta", json!({ "source_project": "D:/x" }))
            .expect("answer delivered");
        assert_eq!(
            receiver.await.expect("receiver gets answer").answers,
            json!({ "source_project": "D:/x" })
        );
        // The pending record (and its metadata) are removed atomically with the answer.
        assert!(manager.pending_meta("tool-meta").is_none());
        assert!(!manager.has_pending("tool-meta"));
        drop(registration);
    }
}
