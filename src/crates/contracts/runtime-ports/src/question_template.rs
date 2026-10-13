//! Question-template contribution port.
//!
//! Domain crates own versioned `AskUserQuestion` templates: card rendering,
//! backend candidate preparation, submit-time answer validation, and the
//! answer receipt. The generic `AskUserQuestion` tool and the coordinator
//! only call the registry.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use bitfun_product_domains::user_questions::{Question, QuestionPresentation};
use serde_json::Value;

use super::tool_admission::{DomainStateReader, DomainStateSlot};

/// Host-listed workspace directory entry, offered to templates for
/// backend-owned output discovery. The host lists entries without
/// interpreting them; the template decides which are relevant.
#[derive(Debug, Clone)]
pub struct TemplateDirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
}

/// Inputs a question-card render is made against. Host resources are
/// pre-resolved into plain data so the contribution never touches the host.
pub struct TemplateContext<'a> {
    /// The template id this render was requested for.
    pub template_id: &'a str,
    /// Model-provided candidate paths (the `candidates` tool argument),
    /// already seeded with backend-resolved paths by the host.
    pub candidates: &'a HashMap<String, Vec<String>>,
    /// The full tool-call input as received (raw params for the wire payload).
    pub raw_input: &'a Value,
    /// Session context variables (host `custom_data`).
    pub context_vars: &'a HashMap<String, Value>,
    /// Local workspace root, `None` when the session has no workspace.
    pub workspace_root: Option<&'a std::path::Path>,
    /// Whether the session workspace is remote (no local filesystem access).
    pub workspace_is_remote: bool,
    /// Top-level workspace directory entries for local workspaces the host
    /// could list; `None` when the host could not or did not list (remote
    /// workspace, listing failure, no workspace) and output-discovery steps
    /// that depend on the listing must be skipped entirely.
    pub workspace_dir_entries: Option<&'a [TemplateDirEntry]>,
    /// Host-managed backend resource root (the shared directory holding
    /// backend-managed toolchains, templates, and similar assets), when this
    /// host owns one; backends scan it for managed resources.
    pub managed_resources_root: Option<&'a std::path::Path>,
    /// Qt generation of the official managed toolchain when this build can
    /// install it; `None` otherwise.
    pub official_toolchain_qt_major: Option<u8>,
}

/// A template refusing this call. The message is surfaced to the caller as the
/// tool-call validation error, so it may carry a stable machine-parseable code.
#[derive(Debug, Clone)]
pub struct TemplateRejection {
    pub message: String,
}

impl TemplateRejection {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

/// The card a contribution renders for one tool call. `payload` is the
/// template-owned opaque wire data (serialized verbatim by the host under the
/// template's wire field; the host never interprets it).
#[derive(Debug)]
pub struct ResolvedTemplate {
    pub questions: Vec<Question>,
    pub presentation: QuestionPresentation,
    pub template_version: String,
    pub payload: Option<Value>,
}

/// A submitted answer group re-validated against its waiting template.
pub struct SubmissionContext<'a> {
    /// Required field ids recorded on the waiting request, when present.
    pub required_fields: Option<&'a [String]>,
    /// The raw answer group submitted by the frontend.
    pub answers: &'a Value,
    /// Whether the owning session's workspace is remote (skips local
    /// filesystem existence checks).
    pub workspace_is_remote: bool,
}

/// Facts a contribution appends to the resumed tool result so the model acts
/// on them inside the current turn.
#[derive(Debug)]
pub struct ToolResultFact {
    pub text: String,
}

/// Question template + answer receipt contribution. Registered by product
/// assembly; the generic tool and coordinator only see this trait.
pub trait QuestionTemplateContribution: Send + Sync {
    fn template_id(&self) -> &'static str;
    fn template_version(&self) -> &'static str;
    /// The session domain-state slot this template's answers persist into.
    fn state_slot(&self) -> DomainStateSlot;

    /// The wire field this template's payload was serialized under before the
    /// generic `templatePayload` envelope, when one exists. The host populates
    /// both so older surfaces keep rendering; new templates must not declare
    /// a legacy field.
    fn legacy_payload_wire_field(&self) -> Option<&'static str> {
        None
    }

    /// Render the card for one tool call. Candidate preparation (seeding,
    /// probing, merging) and rendering are one backend-owned step so the
    /// probe-derived render context cannot drift from the rendered options.
    fn render(&self, ctx: &TemplateContext<'_>) -> Result<ResolvedTemplate, TemplateRejection>;

    /// Persistence-replay render: rebuild the card from persisted tool-call
    /// arguments with the default presentation context and no probing.
    /// `None` for arguments this template does not accept.
    fn render_replay(&self, arguments: &Value) -> Option<ResolvedTemplate>;

    /// Validate + normalize a submitted answer group, including backend
    /// path checks for local workspaces. The error message is surfaced to
    /// the submitting surface.
    fn validate_submission(
        &self,
        ctx: &SubmissionContext<'_>,
    ) -> Result<BTreeMap<String, String>, String>;

    /// Apply validated answers to the current slot value (pure; the host
    /// persists the returned value into [`QuestionTemplateContribution::state_slot`]).
    fn apply_answers(&self, current: Value, normalized: &BTreeMap<String, String>) -> Value;

    /// Answer receipt at tool resume. `template_id` is `None` for a plain
    /// model-written question; contributions answer only for their own
    /// template or their own session-state preconditions.
    fn on_answers(
        &self,
        template_id: Option<&str>,
        answers: &Value,
        state: &dyn DomainStateReader,
    ) -> Vec<ToolResultFact>;
}

/// Registry of question-template contributions. Assembly fills it at
/// construction time; lookups are read-only afterwards.
#[derive(Default)]
pub struct QuestionTemplateRegistry {
    contributions: Vec<Arc<dyn QuestionTemplateContribution>>,
}

impl QuestionTemplateRegistry {
    pub fn register(&mut self, contribution: Arc<dyn QuestionTemplateContribution>) {
        self.contributions.push(contribution);
    }

    pub fn get(&self, template_id: &str) -> Option<Arc<dyn QuestionTemplateContribution>> {
        self.contributions
            .iter()
            .find(|contribution| contribution.template_id() == template_id)
            .cloned()
    }

    pub fn is_empty(&self) -> bool {
        self.contributions.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = &Arc<dyn QuestionTemplateContribution>> {
        self.contributions.iter()
    }
}

impl std::fmt::Debug for QuestionTemplateRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("QuestionTemplateRegistry")
            .field("contribution_count", &self.contributions.len())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitfun_product_domains::user_questions::QuestionPresentation;
    use serde_json::json;
    use std::collections::BTreeMap;

    struct StubTemplate;

    impl QuestionTemplateContribution for StubTemplate {
        fn template_id(&self) -> &'static str {
            "stub-template"
        }

        fn template_version(&self) -> &'static str {
            "2"
        }

        fn state_slot(&self) -> DomainStateSlot {
            DomainStateSlot {
                namespace: "stub",
                key: "stubState",
            }
        }

        fn render(
            &self,
            _ctx: &TemplateContext<'_>,
        ) -> Result<ResolvedTemplate, TemplateRejection> {
            Ok(ResolvedTemplate {
                questions: Vec::new(),
                presentation: QuestionPresentation {
                    layout: "list".to_string(),
                    allow_skip: false,
                    intro_key: None,
                    hint_key: None,
                    required_fields: None,
                    allow_timeout: true,
                },
                template_version: self.template_version().to_string(),
                payload: None,
            })
        }

        fn render_replay(&self, _arguments: &Value) -> Option<ResolvedTemplate> {
            None
        }

        fn validate_submission(
            &self,
            _ctx: &SubmissionContext<'_>,
        ) -> Result<BTreeMap<String, String>, String> {
            Ok(BTreeMap::new())
        }

        fn apply_answers(&self, current: Value, _normalized: &BTreeMap<String, String>) -> Value {
            current
        }

        fn on_answers(
            &self,
            _template_id: Option<&str>,
            _answers: &Value,
            _state: &dyn DomainStateReader,
        ) -> Vec<ToolResultFact> {
            Vec::new()
        }
    }

    #[test]
    fn registry_looks_up_by_template_id_in_registration_order() {
        let mut registry = QuestionTemplateRegistry::default();
        assert!(registry.is_empty());
        registry.register(Arc::new(StubTemplate));

        assert!(registry.get("stub-template").is_some());
        assert!(registry.get("other-template").is_none());
        assert!(!registry.is_empty());
        assert_eq!(
            registry.get("stub-template").unwrap().template_version(),
            "2"
        );
    }

    #[test]
    fn template_rejection_carries_a_user_facing_message() {
        let rejection = TemplateRejection::new("qt_migration_path_not_found: field=a");
        assert!(rejection.message.contains("path_not_found"));
    }

    #[test]
    fn template_context_reads_raw_input_without_copying() {
        let raw = json!({ "templateId": "stub-template" });
        let candidates: HashMap<String, Vec<String>> = HashMap::new();
        let vars: HashMap<String, Value> = HashMap::new();
        let entries: Vec<TemplateDirEntry> = Vec::new();
        let ctx = TemplateContext {
            template_id: "stub-template",
            candidates: &candidates,
            raw_input: &raw,
            context_vars: &vars,
            workspace_root: None,
            workspace_is_remote: false,
            workspace_dir_entries: Some(&entries),
            managed_resources_root: None,
            official_toolchain_qt_major: None,
        };
        assert_eq!(ctx.raw_input["templateId"], "stub-template");
    }
}
