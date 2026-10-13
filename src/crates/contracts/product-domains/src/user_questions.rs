//! Wire contracts shared by user-question tool handlers.

use serde::{Deserialize, Serialize};

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
/// produces this; inline model `presentation` is ignored. Hosts render it
/// without knowing which template produced it; a template rendered through a
/// dedicated product card ships its own shape alongside.
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
    /// Whether the runtime may give up on an unattended card. Template-owned:
    /// a template whose answers are required to start the work sets `false` so
    /// the tool blocks until the user answers. Absent means `true`.
    #[serde(
        rename = "allowTimeout",
        default = "allow_timeout_by_default",
        skip_serializing_if = "is_default_allow_timeout"
    )]
    pub allow_timeout: bool,
}

fn allow_timeout_by_default() -> bool {
    true
}

fn is_default_allow_timeout(value: &bool) -> bool {
    *value
}

fn default_presentation_layout() -> String {
    "list".to_string()
}
