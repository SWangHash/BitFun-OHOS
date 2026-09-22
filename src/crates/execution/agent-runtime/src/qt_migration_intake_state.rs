//! QtMigration intake state (Session-level pure decision layer).
//!
//! Provider-neutral facts owned by `agent-runtime`: the overall intake status
//! is derived from field-level resolution states by a single pure decision
//! function, so no turn loop, tool adapter, or UI may re-derive it with
//! hand-written `if`s.
//!
//! The snapshot is a Session-level fact and is snapshotted per DialogTurn;
//! ModelRound never owns intake state. Writing (atomic transition) is the job
//! of the single owner produced by [`IntakeStateMachine`]; file-system/execute
//! host validation stays in `bitfun-core` execution boundaries.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

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
    /// snapshots may carry it and must keep deserializing. Never derived by
    /// [`qt_migration_derive_intake_status`].
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
    ///
    /// There is deliberately no `Validated` level: the four inputs carry no
    /// host-side validation state — correctness of the `source_project` /
    /// `output_project` paths is judged by the agent (qmake signal, existence)
    /// before the skill loads, and toolchain/template are the skill's
    /// responsibility.
    Resolved,
}

impl QtMigrationFieldResolutionState {
    /// Monotone progression used by [`qt_migration_derive_intake_status`].
    pub fn can_bind_value(self) -> bool {
        self >= QtMigrationFieldResolutionState::Resolved
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

/// Directory name of the managed built-in Qt migration skill (matches the
/// registry spec in `skills::catalog`).
pub const QT_MIGRATION_SKILL_DIR: &str = "ohos-qt-skills";

/// Explicit answer value meaning that the migration skill owns discovery,
/// download, and preparation of the toolchain or template.
pub const QT_MIGRATION_OFFICIAL_VALUE: &str = "__official__";

/// Managed built-in skill source slot (mirrors
/// `skills::roots::BITFUN_SYSTEM_SKILL_SLOT`). Inlined here so the receipt
/// decision stays provider-neutral without a cross-module import.
const MANAGED_SKILL_SOURCE_SLOT: &str = "bitfun-system";

/// A value that explicitly delegates preparation to the loaded skill.
pub fn qt_migration_is_skill_managed_value(value: &str) -> bool {
    value == QT_MIGRATION_OFFICIAL_VALUE
}

/// Provider-neutral proof that the managed `ohos-qt-skills` skill was
/// successfully loaded into the current Session.
///
/// Written atomically by the Skill tool after it resolves and returns the
/// built-in skill. The admission gate treats a missing or mismatched receipt
/// as `qt_migration_skill_required` once the four minimum inputs are bound.
/// `TurnSkillAgentSnapshot` is intentionally NOT consulted — it is an
/// availability list, not a load proof.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QtMigrationLoadedSkillReceipt {
    /// Stable skill key reported by the registry at load time (diagnostic).
    pub skill_key: String,
    /// Skill source slot; must equal the managed built-in slot.
    pub source_slot: String,
    /// Skill directory name; must equal [`QT_MIGRATION_SKILL_DIR`].
    pub dir_name: String,
    /// SHA-256 of the loaded skill content; detects upgrades/content changes
    /// so a stale receipt can be invalidated.
    pub content_hash: String,
}

/// Pure decision: a receipt proves the managed Qt migration skill was loaded
/// from the built-in `.system` source iff its source slot, dir name and stable
/// skill key match the managed baselines and a content fingerprint is present.
///
/// Note: this validates the receipt's own consistency, not freshness against
/// the *current* managed bundle. Comparing `content_hash` to the live
/// bundle/catalog hash requires registry access (IO), so it stays out of this
/// pure function.
pub fn is_valid_qt_migration_receipt(receipt: &QtMigrationLoadedSkillReceipt) -> bool {
    receipt.source_slot == MANAGED_SKILL_SOURCE_SLOT
        && receipt.dir_name == QT_MIGRATION_SKILL_DIR
        && !receipt.skill_key.is_empty()
        && receipt.skill_key.contains(QT_MIGRATION_SKILL_DIR)
        && !receipt.content_hash.is_empty()
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
        }
    }
}

/// Reason a submitted answer group was rejected. The backend must re-validate
/// answers against the waiting request's template id/version; frontend
/// submissions are never trusted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QtMigrationAnswerValidationError {
    /// Answer map did not carry a value for a required field.
    MissingField(String),
    /// Value is empty or whitespace-only.
    EmptyValue(String),
    /// Value is a bare placeholder keyword with no real binding.
    PlaceholderValue(String),
    /// templateId/templateVersion did not match the waiting request.
    BindingMismatch { expected_version: String },
    /// The template is unknown or its policy is unavailable -> fail closed.
    UnknownTemplate(String),
}

impl std::fmt::Display for QtMigrationAnswerValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingField(field) => write!(f, "missing required answer for field: {field}"),
            Self::EmptyValue(field) => write!(f, "empty value for field: {field}"),
            Self::PlaceholderValue(field) => {
                write!(f, "placeholder value not allowed for field: {field}")
            }
            Self::BindingMismatch { expected_version } => write!(
                f,
                "answer does not belong to the waiting request (version mismatch, expected {expected_version})"
            ),
            Self::UnknownTemplate(id) => {
                write!(f, "unknown or unpolicied template: {id}")
            }
        }
    }
}

/// Single pure decision for the overall intake status:
///
/// ```text
/// NeedsInput       = any required field state ∈ { Missing, Referenced }
/// SkillRequired    = all required fields ≥ Resolved, but no valid skill receipt
/// Ready            = all required fields ≥ Resolved AND valid skill receipt
/// ```
///
/// Returns `NotApplicable` when not all required fields exist in the map
/// (defensive; snapshots always seed the full set). `NeedsValidation` is kept
/// as a serialized legacy value only; it is never derived here (older
/// persisted snapshots may still carry it and must keep deserializing).
pub fn qt_migration_derive_intake_status(snapshot: &QtMigrationIntakeStateSnapshot) -> QtMigrationIntakeStatus {
    for required in QT_MIGRATION_INTAKE_REQUIRED_FIELDS {
        let Some(field_state) = snapshot.fields.get(required) else {
            return QtMigrationIntakeStatus::NotApplicable;
        };
        if !field_state.state.can_bind_value() {
            return QtMigrationIntakeStatus::NeedsInput;
        }
    }
    let receipt_valid = snapshot
        .loaded_skill_receipt
        .as_ref()
        .map(is_valid_qt_migration_receipt)
        .unwrap_or(false);
    if receipt_valid {
        QtMigrationIntakeStatus::Ready
    } else {
        QtMigrationIntakeStatus::SkillRequired
    }
}

/// Activate a session-level migration intake from `NotApplicable` into the
/// status derived from the current fields.
///
/// Idempotent: a snapshot already in a non-`NotApplicable` status is returned
/// unchanged so repeated `app_migration` detections do not overwrite fields
/// already collected via answer submission. The first activation on an empty
/// snapshot yields `NeedsInput` (all four fields `Missing`); once fields reach
/// `Resolved` the derived status reflects that. This transition never mutates
/// field values or forges `Resolved` — it only recomputes the overall status.
pub fn qt_migration_activate_intake(snapshot: &QtMigrationIntakeStateSnapshot) -> QtMigrationIntakeStateSnapshot {
    if snapshot.status != QtMigrationIntakeStatus::NotApplicable {
        return snapshot.clone();
    }
    let mut next = snapshot.clone();
    next.status = qt_migration_derive_intake_status(&next);
    next
}

pub fn qt_migration_start_new_active_intake(snapshot: &QtMigrationIntakeStateSnapshot) -> QtMigrationIntakeStateSnapshot {
    if !matches!(
        snapshot.status,
        QtMigrationIntakeStatus::Ready | QtMigrationIntakeStatus::Executing
    ) {
        return snapshot.clone();
    }
    reset_project_bindings(snapshot)
}

fn reset_project_bindings(snapshot: &QtMigrationIntakeStateSnapshot) -> QtMigrationIntakeStateSnapshot {
    let mut next = snapshot.clone();
    for field in QT_MIGRATION_INTAKE_REQUIRED_FIELDS {
        if let Some(entry) = next.fields.get_mut(field) {
            entry.state = QtMigrationFieldResolutionState::Missing;
            entry.value = None;
        }
    }
    next.loaded_skill_receipt = None;
    next.status = qt_migration_derive_intake_status(&next);
    next
}

/// Start a new migration task in an existing QtMigration session.
pub fn qt_migration_start_new_intake(snapshot: &QtMigrationIntakeStateSnapshot) -> QtMigrationIntakeStateSnapshot {
    if !matches!(
        snapshot.status,
        QtMigrationIntakeStatus::Completed | QtMigrationIntakeStatus::Blocked | QtMigrationIntakeStatus::Failed
    ) {
        return snapshot.clone();
    }

    reset_project_bindings(snapshot)
}

/// Backend answer re-validation.
///
/// `answers` is the raw answer group submitted by the frontend (keyed by field
/// id). Returns the normalized values to atomically apply on success.
pub fn qt_migration_validate_answers(
    template_id: &str,
    template_version: &str,
    known_templates_by_version: impl Fn(&str, &str) -> bool,
    required_fields: &[&str],
    answers: &serde_json::Value,
) -> Result<BTreeMap<String, String>, QtMigrationAnswerValidationError> {
    if !known_templates_by_version(template_id, template_version) {
        return Err(QtMigrationAnswerValidationError::BindingMismatch {
            expected_version: template_version.to_string(),
        });
    }

    let Some(answers_obj) = answers.as_object() else {
        return Err(QtMigrationAnswerValidationError::MissingField(
            required_fields
                .first()
                .copied()
                .unwrap_or_default()
                .to_string(),
        ));
    };

    let mut normalized = BTreeMap::new();
    for field in required_fields {
        let raw = answers_obj
            .get(*field)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .ok_or_else(|| QtMigrationAnswerValidationError::MissingField((*field).to_string()))
            .and_then(|v| {
                if is_placeholder_value(v)
                    && !(qt_migration_is_skill_managed_value(v) && matches!(*field, "toolchain" | "template"))
                {
                    Err(QtMigrationAnswerValidationError::PlaceholderValue(
                        (*field).to_string(),
                    ))
                } else {
                    Ok(v.to_string())
                }
            })?;
        normalized.insert((*field).to_string(), raw);
    }
    Ok(normalized)
}

/// Bare keywords that must never be accepted as real values: no "default
/// path" / "official toolchain" style placeholder answers.
/// Matching is loose (contains) and case-insensitive.
fn is_placeholder_value(value: &str) -> bool {
    let lower = value.to_lowercase();
    [
        "默认路径",
        "备选路径",
        "默认",
        "占位",
        "官方工具链",
        "官方模板",
        "空",
        "default path",
        "default",
        "placeholder",
        "official",
        "official toolchain",
        "official template",
        QT_MIGRATION_OFFICIAL_VALUE,
    ]
    .iter()
    .any(|token| lower.contains(token))
}

/// Pure state transition for a submitted (already re-validated) answer group:
/// copies the current snapshot, replaces the field values atomically, marks
/// every submitted value as resolved, recomputes the overall status and returns
/// the new snapshot. Submitting the backend-owned confirmation card is itself
/// the binding step, including when a later migration changes a prior value.
/// Caller (single owner) must swap the Session snapshot only when answer
/// re-validation returned `Ok`.
pub fn qt_migration_apply_validated_answers(
    snapshot: &QtMigrationIntakeStateSnapshot,
    answers: &BTreeMap<String, String>,
) -> QtMigrationIntakeStateSnapshot {
    let mut next = snapshot.clone();
    for (field, value) in answers {
        if let Some(entry) = next.fields.get_mut(field) {
            entry.value = Some(value.clone());
            entry.state = QtMigrationFieldResolutionState::Resolved;
        }
    }
    next.status = qt_migration_derive_intake_status(&next);
    next
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn flat(fields: &[(&str, QtMigrationFieldResolutionState)]) -> BTreeMap<String, QtMigrationIntakeFieldState> {
        let mut map = BTreeMap::new();
        for (id, state) in fields {
            map.insert(
                (*id).to_string(),
                QtMigrationIntakeFieldState {
                    state: *state,
                    value: None,
                },
            );
        }
        map
    }

    fn snapshot_with(
        fields: &[(&str, QtMigrationFieldResolutionState)],
        receipt: Option<QtMigrationLoadedSkillReceipt>,
    ) -> QtMigrationIntakeStateSnapshot {
        QtMigrationIntakeStateSnapshot {
            schema_version: QT_MIGRATION_INTAKE_SNAPSHOT_SCHEMA_VERSION,
            fields: flat(fields),
            status: QtMigrationIntakeStatus::NotApplicable,
            loaded_skill_receipt: receipt,
        }
    }

    fn valid_receipt() -> QtMigrationLoadedSkillReceipt {
        QtMigrationLoadedSkillReceipt {
            skill_key: "system.ohos-qt-skills".to_string(),
            source_slot: MANAGED_SKILL_SOURCE_SLOT.to_string(),
            dir_name: QT_MIGRATION_SKILL_DIR.to_string(),
            content_hash: "abc123".to_string(),
        }
    }

    #[test]
    fn missing_fields_derive_needs_input() {
        let snapshot = snapshot_with(
            &[
                ("source_project", QtMigrationFieldResolutionState::Referenced),
                ("output_project", QtMigrationFieldResolutionState::Missing),
                ("toolchain", QtMigrationFieldResolutionState::Missing),
                ("template", QtMigrationFieldResolutionState::Missing),
            ],
            None,
        );
        assert_eq!(qt_migration_derive_intake_status(&snapshot), QtMigrationIntakeStatus::NeedsInput);
    }

    #[test]
    fn resolved_fields_without_receipt_derive_skill_required() {
        let snapshot = snapshot_with(
            &[
                ("source_project", QtMigrationFieldResolutionState::Resolved),
                ("output_project", QtMigrationFieldResolutionState::Resolved),
                ("toolchain", QtMigrationFieldResolutionState::Resolved),
                ("template", QtMigrationFieldResolutionState::Resolved),
            ],
            None,
        );
        assert_eq!(qt_migration_derive_intake_status(&snapshot), QtMigrationIntakeStatus::SkillRequired);
    }

    #[test]
    fn resolved_fields_with_valid_receipt_derive_ready() {
        let snapshot = snapshot_with(
            &[
                ("source_project", QtMigrationFieldResolutionState::Resolved),
                ("output_project", QtMigrationFieldResolutionState::Resolved),
                ("toolchain", QtMigrationFieldResolutionState::Resolved),
                ("template", QtMigrationFieldResolutionState::Resolved),
            ],
            Some(valid_receipt()),
        );
        assert_eq!(qt_migration_derive_intake_status(&snapshot), QtMigrationIntakeStatus::Ready);
    }

    #[test]
    fn rejects_empty_and_placeholder_answers() {
        let known = |_id: &str, _v: &str| true;
        assert!(matches!(
            qt_migration_validate_answers(
                "qt-migration-paths",
                "1",
                known,
                &QT_MIGRATION_INTAKE_REQUIRED_FIELDS,
                &json!({ "source_project": "   " })
            ),
            Err(QtMigrationAnswerValidationError::MissingField(_)) | Err(QtMigrationAnswerValidationError::EmptyValue(_))
        ));
        assert!(matches!(
            qt_migration_validate_answers(
                "qt-migration-paths",
                "1",
                known,
                &QT_MIGRATION_INTAKE_REQUIRED_FIELDS,
                &json!({ "source_project": "默认路径" })
            ),
            Err(QtMigrationAnswerValidationError::PlaceholderValue(_))
        ));
    }

    #[test]
    fn validates_full_answer_group_and_normalizes() {
        let known = |_id: &str, _v: &str| true;
        let answers = json!({
            "source_project": "D:/work/myqt",
            "output_project": "D:/out/hm",
            "toolchain": "D:/sdk/ohos",
            "template": "qt-hm-template-1"
        });
        let normalized = qt_migration_validate_answers(
            "qt-migration-paths",
            "1",
            known,
            &QT_MIGRATION_INTAKE_REQUIRED_FIELDS,
            &answers,
        )
        .expect("complete group must pass");
        assert_eq!(normalized.len(), 4);
        assert_eq!(normalized["source_project"], "D:/work/myqt");
    }

    #[test]
    fn version_mismatch_fails_closed() {
        let known = |_id: &str, v: &str| v == "1";
        assert!(matches!(
            qt_migration_validate_answers(
                "qt-migration-paths",
                "2",
                known,
                &QT_MIGRATION_INTAKE_REQUIRED_FIELDS,
                &json!({ "source_project": "D:/x" })
            ),
            Err(QtMigrationAnswerValidationError::BindingMismatch { .. })
        ));
    }

    #[test]
    fn applying_new_value_rebinds_field_as_resolved() {
        let mut snapshot = snapshot_with(
            &[
                ("source_project", QtMigrationFieldResolutionState::Resolved),
                ("output_project", QtMigrationFieldResolutionState::Resolved),
                ("toolchain", QtMigrationFieldResolutionState::Resolved),
                ("template", QtMigrationFieldResolutionState::Resolved),
            ],
            None,
        );
        snapshot.fields.get_mut("source_project").unwrap().value = Some("D:/old".to_string());

        let mut answers = BTreeMap::new();
        answers.insert("source_project".to_string(), "D:/new".to_string());
        let next = qt_migration_apply_validated_answers(&snapshot, &answers);

        assert_eq!(
            next.fields["source_project"].state,
            QtMigrationFieldResolutionState::Resolved
        );
        // A re-submitted confirmation binds the new value immediately; the
        // agent has already completed the separate source-project check.
        assert_eq!(next.status, QtMigrationIntakeStatus::SkillRequired);
    }

    #[test]
    fn terminal_task_restart_reuses_resources_and_requires_skill_reload() {
        let mut snapshot = snapshot_with(
            &[
                ("source_project", QtMigrationFieldResolutionState::Resolved),
                ("output_project", QtMigrationFieldResolutionState::Resolved),
                ("toolchain", QtMigrationFieldResolutionState::Resolved),
                ("template", QtMigrationFieldResolutionState::Resolved),
            ],
            Some(valid_receipt()),
        );
        snapshot.status = QtMigrationIntakeStatus::Completed;
        for (field, value) in [
            ("source_project", "D:/old/source"),
            ("output_project", "D:/old/output"),
            ("toolchain", "D:/shared/qt"),
            ("template", "D:/shared/template"),
        ] {
            snapshot.fields.get_mut(field).unwrap().value = Some(value.to_string());
        }

        let next = qt_migration_start_new_intake(&snapshot);
        for field in QT_MIGRATION_INTAKE_REQUIRED_FIELDS {
            assert_eq!(next.fields[field].state, QtMigrationFieldResolutionState::Missing);
            assert_eq!(next.fields[field].value, None);
        }
        assert_eq!(next.loaded_skill_receipt, None);
        assert_eq!(next.status, QtMigrationIntakeStatus::NeedsInput);
    }

    #[test]
    fn active_task_is_not_reset_by_restart_helper() {
        let mut snapshot = QtMigrationIntakeStateSnapshot::empty();
        snapshot.status = QtMigrationIntakeStatus::Ready;
        assert_eq!(qt_migration_start_new_intake(&snapshot), snapshot);
    }

    #[test]
    fn active_task_restart_resets_project_paths_and_requires_skill_reload() {
        let mut snapshot = snapshot_with(
            &[
                ("source_project", QtMigrationFieldResolutionState::Resolved),
                ("output_project", QtMigrationFieldResolutionState::Resolved),
                ("toolchain", QtMigrationFieldResolutionState::Resolved),
                ("template", QtMigrationFieldResolutionState::Resolved),
            ],
            Some(valid_receipt()),
        );
        snapshot.status = QtMigrationIntakeStatus::Ready;
        snapshot.fields.get_mut("source_project").unwrap().value = Some("D:/old".to_string());
        snapshot.fields.get_mut("output_project").unwrap().value = Some("D:/out".to_string());
        let next = qt_migration_start_new_active_intake(&snapshot);
        assert_eq!(next.status, QtMigrationIntakeStatus::NeedsInput);
        for field in QT_MIGRATION_INTAKE_REQUIRED_FIELDS {
            assert!(next.fields[field].value.is_none());
        }
        assert_eq!(next.loaded_skill_receipt, None);
    }

    #[test]
    fn first_ever_answers_bind_fields_to_resolved() {
        // Empty session snapshot receives the first confirmed answer group:
        // fields must bind to Resolved (not collapse back to Referenced) so the
        // intake leaves NeedsInput without re-asking.
        let snapshot = QtMigrationIntakeStateSnapshot::empty();

        let mut answers = BTreeMap::new();
        answers.insert("source_project".to_string(), "D:/work/myqt".to_string());
        answers.insert("output_project".to_string(), "D:/out/hm".to_string());
        answers.insert("toolchain".to_string(), "D:/sdk/ohos".to_string());
        answers.insert("template".to_string(), "qt-hm-template-1".to_string());
        let next = qt_migration_apply_validated_answers(&snapshot, &answers);

        for field in QT_MIGRATION_INTAKE_REQUIRED_FIELDS {
            assert_eq!(
                next.fields[field].state,
                QtMigrationFieldResolutionState::Resolved,
                "field {} must be Resolved after first confirmed answer",
                field
            );
            let expected = answers.get(field).expect("answer exists");
            assert_eq!(
                next.fields[field].value.as_deref(),
                Some(expected.as_str()),
                "field {} must carry the confirmed value",
                field
            );
        }
        // All fields bound but the skill is not loaded yet: SkillRequired — the
        // state after binding is decided by the receipt.
        assert_eq!(next.status, QtMigrationIntakeStatus::SkillRequired);
    }

    #[test]
    fn partial_first_answer_keeps_intake_in_needs_input() {
        let snapshot = QtMigrationIntakeStateSnapshot::empty();

        let mut answers = BTreeMap::new();
        answers.insert("source_project".to_string(), "D:/work/myqt".to_string());
        let next = qt_migration_apply_validated_answers(&snapshot, &answers);

        assert_eq!(
            next.fields["source_project"].state,
            QtMigrationFieldResolutionState::Resolved
        );
        assert_eq!(
            next.fields["output_project"].state,
            QtMigrationFieldResolutionState::Missing
        );
        assert_eq!(next.status, QtMigrationIntakeStatus::NeedsInput);
    }

    #[test]
    fn activate_from_not_applicable_derives_needs_input() {
        let snapshot = QtMigrationIntakeStateSnapshot::empty();
        assert_eq!(snapshot.status, QtMigrationIntakeStatus::NotApplicable);
        let activated = qt_migration_activate_intake(&snapshot);
        assert_eq!(activated.status, QtMigrationIntakeStatus::NeedsInput);
        for field in QT_MIGRATION_INTAKE_REQUIRED_FIELDS {
            assert_eq!(
                activated.fields[field].state,
                QtMigrationFieldResolutionState::Missing,
                "activation must not fabricate field bindings"
            );
        }
    }

    #[test]
    fn activate_is_idempotent_for_non_not_applicable() {
        let mut snapshot = QtMigrationIntakeStateSnapshot::empty();
        snapshot.status = QtMigrationIntakeStatus::NeedsInput;
        let activated = qt_migration_activate_intake(&snapshot);
        assert_eq!(activated, snapshot);
    }

    #[test]
    fn activate_does_not_overwrite_collected_fields() {
        let mut snapshot = QtMigrationIntakeStateSnapshot::empty();
        snapshot.fields.get_mut("source_project").unwrap().state = QtMigrationFieldResolutionState::Resolved;
        snapshot.status = QtMigrationIntakeStatus::NotApplicable;
        let activated = qt_migration_activate_intake(&snapshot);
        assert_eq!(
            activated.fields["source_project"].state,
            QtMigrationFieldResolutionState::Resolved
        );
        assert_eq!(activated.status, QtMigrationIntakeStatus::NeedsInput);
    }
}
