//! Qt migration wire contracts: the persisted intake snapshot shape and the
//! Qt intake card's own question shape. The decision logic that consumes these
//! types lives in the `bitfun-qt-migration` domain crate.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::user_questions::{Question, QuestionOption, QuestionPresentation};

/// Current protocol version of the snapshot shape. Bump when the persisted or
/// transported shape changes so stale snapshots can be rejected.
pub const QT_MIGRATION_INTAKE_SNAPSHOT_SCHEMA_VERSION: u32 = 1;

/// Overall intake status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QtMigrationIntakeStatus {
    /// QtMigration mode not active for the current request.
    NotApplicable,
    /// At least one required field still has no concrete value (Missing /
    /// Referenced only). Side-effect tools are rejected.
    NeedsInput,
    /// Legacy serialized state kept for upgrade compatibility: older persisted
    /// snapshots may carry it and must keep deserializing. Never derived by the
    /// status decision in the `bitfun-qt-migration` domain crate.
    NeedsValidation,
    /// All four required fields are bound (≥ Resolved) AND a valid skill
    /// receipt exists (the state is decided by the receipt, not by any
    /// host-side evidence).
    Ready,
    /// Skill not loaded or loaded snapshot incompatible. Side effects rejected.
    SkillRequired,
    /// All preconditions satisfied; migration workflow may execute.
    Executing,
    Completed,
    Blocked,
    Failed,
}

/// Field-level resolution state for one of the four minimum inputs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QtMigrationFieldResolutionState {
    /// No reference recognized yet; empty value or bare keyword must stay here.
    Missing,
    /// A name/path/ID reference was recognized in the user text (string-layer
    /// recognition only, no existence assumption).
    Referenced,
    /// Bound to a concrete absolute path, product-registered ID, or explicit
    /// configuration that the executing Host can use. A backend-validated
    /// question-card submission binds both first-time and replacement values.
    Resolved,
}

impl QtMigrationFieldResolutionState {
    /// Monotone progression used by the intake status decision.
    pub fn can_bind_value(self) -> bool {
        self >= QtMigrationFieldResolutionState::Resolved
    }
}

/// How the generation mismatch between the bound source project and the bound
/// toolchain was resolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QtMigrationVersionStrategy {
    /// No mismatch was measured for this intake, so there is nothing to decide.
    #[default]
    NotNeeded,
    /// A mismatch was measured and the strategy question is waiting for the user.
    Pending { project: u8, toolchain: u8 },
    /// The project is newer than the toolchain and the user chose to migrate it
    /// with the toolchain's generation (a Qt6 project built as Qt5).
    Downgrade { project: u8, toolchain: u8 },
    /// The project is older than the toolchain and the user chose to continue with
    /// the newer toolchain.
    Continue { project: u8, toolchain: u8 },
    /// The user chose not to migrate.
    Abort { project: u8, toolchain: u8 },
}

impl QtMigrationVersionStrategy {
    /// The generations this state was decided on, when it came from a measurement.

    /// Every measured state carries them — including the decided ones — so the facts
    /// behind "migrate this Qt6 project with Qt5" survive the answer and can be handed
    /// to every later step of the migration without probing the disk again.
    pub fn measured_generations(self) -> Option<(u8, u8)> {
        match self {
            Self::NotNeeded => None,
            Self::Pending { project, toolchain }
            | Self::Downgrade { project, toolchain }
            | Self::Continue { project, toolchain }
            | Self::Abort { project, toolchain } => Some((project, toolchain)),
        }
    }
}

/// One minimum input field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QtMigrationIntakeFieldState {
    pub state: QtMigrationFieldResolutionState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

impl Default for QtMigrationIntakeFieldState {
    fn default() -> Self {
        Self {
            state: QtMigrationFieldResolutionState::Missing,
            value: None,
        }
    }
}

/// The four minimum inputs for Qt migration.
pub const QT_MIGRATION_INTAKE_REQUIRED_FIELDS: [&str; 4] =
    ["source_project", "output_project", "toolchain", "template"];

/// Provider-neutral proof that the managed `ohos-qt-skills` skill was
/// successfully loaded into the current Session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QtMigrationLoadedSkillReceipt {
    /// Stable skill key reported by the registry at load time (diagnostic).
    pub skill_key: String,
    /// Skill source slot; must equal the managed built-in slot.
    pub source_slot: String,
    /// Skill directory name; must equal the managed `ohos-qt-skills` directory.
    pub dir_name: String,
    /// SHA-256 of the loaded skill content; detects upgrades/content changes
    /// so a stale receipt can be invalidated.
    pub content_hash: String,
}

/// Immutable Session-level intake snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QtMigrationIntakeStateSnapshot {
    pub schema_version: u32,
    /// Field id -> field state. Only the four minimum inputs exist in batch 1.
    pub fields: BTreeMap<String, QtMigrationIntakeFieldState>,
    /// Overall status derived from [`QtMigrationIntakeFieldState`]s plus evidence status.
    pub status: QtMigrationIntakeStatus,
    /// Skill load receipt. `None` until the Skill tool atomically records a
    /// successful load of the managed `ohos-qt-skills`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loaded_skill_receipt: Option<QtMigrationLoadedSkillReceipt>,
    /// How a generation mismatch between the bound source project and the bound
    /// toolchain was resolved. Defaulted on deserialization so snapshots written
    /// before this field existed keep loading.
    #[serde(default)]
    pub version_strategy: QtMigrationVersionStrategy,
}

impl QtMigrationIntakeStateSnapshot {
    pub fn empty() -> Self {
        let mut fields = BTreeMap::new();
        for field in QT_MIGRATION_INTAKE_REQUIRED_FIELDS {
            fields.insert(field.to_string(), QtMigrationIntakeFieldState::default());
        }
        Self {
            schema_version: QT_MIGRATION_INTAKE_SNAPSHOT_SCHEMA_VERSION,
            fields,
            status: QtMigrationIntakeStatus::NotApplicable,
            loaded_skill_receipt: None,
            version_strategy: QtMigrationVersionStrategy::default(),
        }
    }
}

/// One Qt migration intake candidate in the template's own shape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QtMigrationOption {
    /// i18n key for the option's role line (`askUser.qtMigration.option.*`).
    pub label: String,
    /// i18n key for the second line of an option that has no path (the managed
    /// download option). Candidate options leave it unset; their path is the
    /// second line.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Concrete candidate path, submitted as-is. Empty for the managed download
    /// option, which submits `value` instead.
    pub path: String,
    /// Explicit submitted value (`__official__`). `None` when the path itself is
    /// the submitted value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    /// Qt major version of a toolchain candidate, when the scan identified it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<u8>,
}

/// One Qt migration intake question in the template's own shape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QtMigrationQuestion {
    /// Field id the answer binds to (`source_project`,...).
    pub field: String,
    /// i18n key for the field label chip (`askUser.qtMigration.field.*`).
    pub header: String,
    /// i18n key for the prompt (`askUser.qtMigration.question.*`).
    pub prompt: String,
    /// i18n key for the free-text input placeholder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    /// Backend-owned requiredness.
    pub required: bool,
    pub options: Vec<QtMigrationOption>,
}

impl QtMigrationQuestion {
    /// Projection onto the shared question contract. Candidate options keep
    /// their role label and carry the clean path in `description`; the managed
    /// download option carries its description key and its explicit value.
    pub fn to_question(&self) -> Question {
        Question {
            question: self.prompt.clone(),
            header: self.header.clone(),
            options: self
                .options
                .iter()
                .map(|option| QuestionOption {
                    label: option.label.clone(),
                    // The generic contract has no path slot, so a candidate path
                    // is projected as the option's second line.
                    description: option
                        .description
                        .clone()
                        .unwrap_or_else(|| option.path.clone()),
                    value: option.value.clone(),
                })
                .collect(),
            multi_select: false,
            input_placeholder: self.placeholder.clone(),
            field: Some(self.field.clone()),
            required: self.required,
        }
    }
}

/// Everything resolved from a template: questions plus backend presentation
/// policy plus version. Templates that render through a dedicated product card
/// additionally ship their own question shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedQuestionTemplate {
    /// Generic projection every question consumer can render.
    pub questions: Vec<Question>,
    pub presentation: QuestionPresentation,
    pub template_version: String,
    /// Qt migration's own question shape, rendered by the Qt intake card.
    /// `None` for templates that render through the generic question card.
    pub qt_migration_questions: Option<Vec<QtMigrationQuestion>>,
}
