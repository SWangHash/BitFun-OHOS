//! Qt migration intake state (Session-level pure decision layer).
//!
//! The wire serde DTOs live in `bitfun_product_domains::qt_migration`; this
//! module re-exports them so core keeps a single import path for the state
//! surface.

pub use bitfun_product_domains::qt_migration::{
    QtMigrationFieldResolutionState, QtMigrationIntakeFieldState, QtMigrationIntakeStateSnapshot,
    QtMigrationIntakeStatus, QtMigrationLoadedSkillReceipt, QtMigrationVersionStrategy,
    QT_MIGRATION_INTAKE_REQUIRED_FIELDS, QT_MIGRATION_INTAKE_SNAPSHOT_SCHEMA_VERSION,
};

use std::collections::BTreeMap;

/// Directory name of the managed built-in Qt migration skill (matches the
/// registry spec in `skills::catalog`).
pub const QT_MIGRATION_SKILL_DIR: &str = "ohos-qt-skills";

/// Explicit answer value meaning that the migration skill owns discovery,
/// download, and preparation of the toolchain or template.
pub const QT_MIGRATION_OFFICIAL_VALUE: &str = "__official__";

/// Managed built-in skill source slot (mirrors
/// `skills::roots::BITFUN_SYSTEM_SKILL_SLOT`). Inlined here so the receipt
/// decision stays provider-neutral without a cross-module import.
pub const MANAGED_SKILL_SOURCE_SLOT: &str = "bitfun-system";

/// A value that explicitly delegates preparation to the loaded skill.
pub fn qt_migration_is_skill_managed_value(value: &str) -> bool {
    value == QT_MIGRATION_OFFICIAL_VALUE
}

/// Pure decision: a receipt proves the managed Qt migration skill was loaded
/// from the built-in `.system` source iff its source slot, dir name and stable
/// skill key match the managed baselines and a content fingerprint is present.
pub fn is_valid_qt_migration_receipt(receipt: &QtMigrationLoadedSkillReceipt) -> bool {
    receipt.source_slot == MANAGED_SKILL_SOURCE_SLOT
        && receipt.dir_name == QT_MIGRATION_SKILL_DIR
        && !receipt.skill_key.is_empty()
        && receipt.skill_key.contains(QT_MIGRATION_SKILL_DIR)
        && !receipt.content_hash.is_empty()
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
pub fn qt_migration_derive_intake_status(
    snapshot: &QtMigrationIntakeStateSnapshot,
) -> QtMigrationIntakeStatus {
    for required in QT_MIGRATION_INTAKE_REQUIRED_FIELDS {
        let Some(field_state) = snapshot.fields.get(required) else {
            return QtMigrationIntakeStatus::NotApplicable;
        };
        if !field_state.state.can_bind_value() {
            return QtMigrationIntakeStatus::NeedsInput;
        }
    }
    // A measured generation mismatch blocks the migration until the user answers the
    // strategy question, and an explicit "do not migrate" keeps it blocked: all four
    // fields being bound says nothing about whether the migration may run at all.
    if matches!(
        snapshot.version_strategy,
        QtMigrationVersionStrategy::Pending { .. } | QtMigrationVersionStrategy::Abort { .. }
    ) {
        return QtMigrationIntakeStatus::Blocked;
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

/// Record how the generation mismatch between the bound project and the bound
/// toolchain was resolved, and recompute the derived status so the admission gate
/// (`qt_migration_gate`) sees the effect immediately: `Pending` and `Abort` derive
/// `Blocked`, which the gate treats as terminal.
pub fn qt_migration_set_version_strategy(
    snapshot: &QtMigrationIntakeStateSnapshot,
    strategy: QtMigrationVersionStrategy,
) -> QtMigrationIntakeStateSnapshot {
    let mut next = snapshot.clone();
    next.version_strategy = strategy;
    next.status = qt_migration_derive_intake_status(&next);
    next
}

/// Activate a session-level migration intake from `NotApplicable` into the
/// status derived from the current fields.
pub fn qt_migration_activate_intake(
    snapshot: &QtMigrationIntakeStateSnapshot,
) -> QtMigrationIntakeStateSnapshot {
    if snapshot.status != QtMigrationIntakeStatus::NotApplicable {
        return snapshot.clone();
    }
    let mut next = snapshot.clone();
    next.status = qt_migration_derive_intake_status(&next);
    next
}

pub fn qt_migration_start_new_active_intake(
    snapshot: &QtMigrationIntakeStateSnapshot,
) -> QtMigrationIntakeStateSnapshot {
    if !matches!(
        snapshot.status,
        QtMigrationIntakeStatus::Ready | QtMigrationIntakeStatus::Executing
    ) {
        return snapshot.clone();
    }
    reset_project_bindings(snapshot)
}

fn reset_project_bindings(
    snapshot: &QtMigrationIntakeStateSnapshot,
) -> QtMigrationIntakeStateSnapshot {
    let mut next = snapshot.clone();
    for field in QT_MIGRATION_INTAKE_REQUIRED_FIELDS {
        if let Some(entry) = next.fields.get_mut(field) {
            entry.state = QtMigrationFieldResolutionState::Missing;
            entry.value = None;
        }
    }
    next.loaded_skill_receipt = None;
    // A new migration task decides its own version strategy: keeping a previous
    // `Abort` (or a `Pending` that was never answered) would leave the fresh intake
    // permanently blocked.
    next.version_strategy = QtMigrationVersionStrategy::default();
    next.status = qt_migration_derive_intake_status(&next);
    next
}

/// Start a new migration task in an existing QtMigration session.
pub fn qt_migration_start_new_intake(
    snapshot: &QtMigrationIntakeStateSnapshot,
) -> QtMigrationIntakeStateSnapshot {
    if !matches!(
        snapshot.status,
        QtMigrationIntakeStatus::Completed
            | QtMigrationIntakeStatus::Blocked
            | QtMigrationIntakeStatus::Failed
    ) {
        return snapshot.clone();
    }

    reset_project_bindings(snapshot)
}

/// Backend answer re-validation.

/// Field-level answer validation without the template binding check: the
/// binding (template id/version) is verified by the caller against the waiting
/// request, then the raw answer group is normalized here. `answers` is keyed by
/// field id; the returned map carries the trimmed values to apply atomically.
pub fn qt_migration_validate_answer_fields(
    required_fields: &[&str],
    answers: &serde_json::Value,
) -> Result<BTreeMap<String, String>, QtMigrationAnswerValidationError> {
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
                    && !(qt_migration_is_skill_managed_value(v)
                        && matches!(*field, "toolchain" | "template"))
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
    qt_migration_validate_answer_fields(required_fields, answers)
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

/// Slot-value (de)serialization helpers.
///
/// Session domain-state slots travel as JSON values through the generic
/// `DomainStateReader`/`DomainStateWriter` ports; these helpers are the single
/// typed boundary between the slot value and the snapshot.

/// Parse a session domain-state slot value into the intake snapshot. A missing
/// or corrupt value degrades to the empty snapshot (missing input, gate stays
/// closed) instead of failing the caller; a corrupt value is a logged
/// deviation, an absent one is the normal non-migration session shape.
pub fn intake_snapshot_from_slot_value(
    value: Option<serde_json::Value>,
) -> QtMigrationIntakeStateSnapshot {
    match value {
        None => QtMigrationIntakeStateSnapshot::empty(),
        Some(value) => match serde_json::from_value(value) {
            Ok(snapshot) => snapshot,
            Err(error) => {
                log::warn!(
                    "Failed to parse the Qt migration intake state slot; treating the intake as empty: {}",
                    error
                );
                QtMigrationIntakeStateSnapshot::empty()
            }
        },
    }
}

/// Serialize the intake snapshot into its session domain-state slot value.
pub fn intake_snapshot_to_slot_value(
    snapshot: &QtMigrationIntakeStateSnapshot,
) -> serde_json::Value {
    serde_json::to_value(snapshot).unwrap_or(serde_json::Value::Null)
}

/// Read the migration-active slot value. Only an explicit `true` is active, so
/// an absent (or corrupt) slot reads as inactive.
pub fn migration_active_from_slot_value(value: Option<&serde_json::Value>) -> bool {
    matches!(value, Some(serde_json::Value::Bool(true)))
}

/// Build the migration-active slot value.
pub fn migration_active_slot_value(active: bool) -> serde_json::Value {
    serde_json::Value::Bool(active)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn flat(
        fields: &[(&str, QtMigrationFieldResolutionState)],
    ) -> BTreeMap<String, QtMigrationIntakeFieldState> {
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
            version_strategy: QtMigrationVersionStrategy::default(),
        }
    }

    fn all_resolved() -> Vec<(&'static str, QtMigrationFieldResolutionState)> {
        QT_MIGRATION_INTAKE_REQUIRED_FIELDS
            .iter()
            .map(|field| (*field, QtMigrationFieldResolutionState::Resolved))
            .collect()
    }

    #[test]
    fn a_pending_version_mismatch_blocks_the_migration() {
        // 绑定齐全 ≠ 可以迁移：工程与工具链代不一致时，策略问题未答之前必须挡住副作用
        // （gate 把 Blocked 当终态）。
        let bound = snapshot_with(&all_resolved(), Some(valid_receipt()));
        assert_eq!(
            qt_migration_derive_intake_status(&bound),
            QtMigrationIntakeStatus::Ready,
            "前提：绑定齐全 + 有技能回执时本来是 Ready"
        );

        let pending = qt_migration_set_version_strategy(
            &bound,
            QtMigrationVersionStrategy::Pending {
                project: 6,
                toolchain: 5,
            },
        );

        assert_eq!(pending.status, QtMigrationIntakeStatus::Blocked);
        assert_eq!(
            qt_migration_derive_intake_status(&pending),
            QtMigrationIntakeStatus::Blocked
        );
        // 方向随决策一起落库：后续校验/指令读这两个数，不再重新探测磁盘。
        assert_eq!(
            pending.version_strategy,
            QtMigrationVersionStrategy::Pending {
                project: 6,
                toolchain: 5
            }
        );
    }

    #[test]
    fn an_aborted_version_strategy_keeps_the_migration_blocked() {
        let bound = snapshot_with(&all_resolved(), Some(valid_receipt()));

        let aborted = qt_migration_set_version_strategy(
            &bound,
            QtMigrationVersionStrategy::Abort {
                project: 6,
                toolchain: 5,
            },
        );

        assert_eq!(aborted.status, QtMigrationIntakeStatus::Blocked);
        assert_eq!(
            aborted.version_strategy.measured_generations(),
            Some((6, 5)),
            "不迁移也要留住本次实测的两侧代，供后续说明与审计"
        );
    }
    #[test]
    fn a_new_migration_task_clears_the_previous_version_strategy() {
        // 上一轮选了"不迁移"（Blocked）后，用户换一个工程重新发请求：新任务必须能重来，
        // 否则 intake 会永久卡在 Blocked。
        let bound = snapshot_with(&all_resolved(), Some(valid_receipt()));
        let aborted = qt_migration_set_version_strategy(
            &bound,
            QtMigrationVersionStrategy::Abort {
                project: 6,
                toolchain: 5,
            },
        );
        assert_eq!(aborted.status, QtMigrationIntakeStatus::Blocked);

        let restarted = qt_migration_start_new_intake(&aborted);

        assert_eq!(
            restarted.version_strategy,
            QtMigrationVersionStrategy::NotNeeded
        );
        assert_eq!(restarted.status, QtMigrationIntakeStatus::NeedsInput);
    }

    #[test]
    fn a_snapshot_without_the_version_strategy_field_still_loads() {
        // 升级兼容：本字段之前落盘的快照没有 version_strategy，必须仍能反序列化并取默认值。
        let legacy = json!({
            "schema_version": QT_MIGRATION_INTAKE_SNAPSHOT_SCHEMA_VERSION,
            "fields": {
                "source_project": {"state": "resolved", "value": "/ws/app"},
                "output_project": {"state": "resolved", "value": "/ws/out"},
                "toolchain": {"state": "resolved", "value": "__official__"},
                "template": {"state": "resolved", "value": "__official__"}
            },
            "status": "ready"
        });

        let snapshot: QtMigrationIntakeStateSnapshot =
            serde_json::from_value(legacy).expect("legacy snapshot must deserialize");

        assert_eq!(
            snapshot.version_strategy,
            QtMigrationVersionStrategy::NotNeeded
        );
        assert_eq!(snapshot.status, QtMigrationIntakeStatus::Ready);
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
                (
                    "source_project",
                    QtMigrationFieldResolutionState::Referenced,
                ),
                ("output_project", QtMigrationFieldResolutionState::Missing),
                ("toolchain", QtMigrationFieldResolutionState::Missing),
                ("template", QtMigrationFieldResolutionState::Missing),
            ],
            None,
        );
        assert_eq!(
            qt_migration_derive_intake_status(&snapshot),
            QtMigrationIntakeStatus::NeedsInput
        );
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
        assert_eq!(
            qt_migration_derive_intake_status(&snapshot),
            QtMigrationIntakeStatus::SkillRequired
        );
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
        assert_eq!(
            qt_migration_derive_intake_status(&snapshot),
            QtMigrationIntakeStatus::Ready
        );
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
            Err(QtMigrationAnswerValidationError::MissingField(_))
                | Err(QtMigrationAnswerValidationError::EmptyValue(_))
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
            assert_eq!(
                next.fields[field].state,
                QtMigrationFieldResolutionState::Missing
            );
            assert_eq!(next.fields[field].value, None);
        }
        assert_eq!(next.loaded_skill_receipt, None);
        assert_eq!(next.status, QtMigrationIntakeStatus::NeedsInput);
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
}
