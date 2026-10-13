//! Qt migration tool admission: which tools may run while the migration
//! intake is incomplete.
//!
//! Registered as a `ToolAdmissionPolicy`; session state is read only through
//! `DomainStateReader` slots. Sessions without an activated intake stay
//! ungated (zero overhead for the rest of the product).

use bitfun_runtime_ports::{
    DomainStateReader, DomainStateSlot, ToolAdmissionPolicy, ToolAdmissionRejection,
    ToolAdmissionRequest,
};
use serde_json::Value;

use crate::state::{
    is_valid_qt_migration_receipt, QtMigrationIntakeStateSnapshot, QtMigrationIntakeStatus,
    QtMigrationVersionStrategy, QT_MIGRATION_INTAKE_REQUIRED_FIELDS,
};

/// Domain namespace of the session state slots this crate owns.
pub const QT_MIGRATION_STATE_NAMESPACE: &str = "qt_migration";

/// Serialized [`QtMigrationIntakeStateSnapshot`] for the session. The slot key
/// is the persisted session-metadata key verbatim: existing sessions already
/// carry this key in their custom metadata, so a rename would orphan their
/// restored intake state.
pub const QT_MIGRATION_SLOT_INTAKE_STATE: DomainStateSlot = DomainStateSlot {
    namespace: QT_MIGRATION_STATE_NAMESPACE,
    key: "qtMigrationIntakeState",
};
/// Whether the session is an active Qt migration session (JSON bool). The key
/// matches the persisted session-metadata key verbatim (see the intake slot).
pub const QT_MIGRATION_SLOT_ACTIVE: DomainStateSlot = DomainStateSlot {
    namespace: QT_MIGRATION_STATE_NAMESPACE,
    key: "qtMigrationActive",
};
/// Host toolchains directory (JSON string) used by `__official__` guidance.
pub const QT_MIGRATION_SLOT_TOOLCHAINS_DIR: DomainStateSlot = DomainStateSlot {
    namespace: QT_MIGRATION_STATE_NAMESPACE,
    key: "toolchains_dir",
};
/// Host templates directory (JSON string) used by `__official__` guidance.
pub const QT_MIGRATION_SLOT_TEMPLATES_DIR: DomainStateSlot = DomainStateSlot {
    namespace: QT_MIGRATION_STATE_NAMESPACE,
    key: "templates_dir",
};

/// Tools always allowed while the migration intake is incomplete: they are
/// required to finish input collection or load the migration skill, and carry
/// no migration side effects. Tools that mutate persistent state (TodoWrite,
/// goal tools) stay gated.
const BOOTSTRAP_ALLOWED_TOOLS: &[&str] = &[
    "QtMigrationIntake",
    "AskUserQuestion",
    "Skill",
    "Read",
    "Grep",
    "Glob",
];

/// The single shell command allowed through the gate while the intake is
/// incomplete: the model resolves the session qmake (the toolchain the user
/// configured into the environment) so the question card can offer it as the
/// toolchain candidate. Read-only; anything else stays rejected until the
/// four inputs are bound.
const BOOTSTRAP_QMAKE_PROBE_COMMANDS: &[&str] = &["command -v qmake", "which qmake"];

/// Whether `input` is exactly the bootstrap qmake resolution command
/// (whitespace-normalized match on the ExecCommand `cmd` argument).
fn bootstrap_qmake_probe_command(input: Option<&Value>) -> bool {
    let Some(command) = input
        .and_then(|input| input.get("cmd"))
        .and_then(Value::as_str)
    else {
        return false;
    };
    let normalized = command.split_whitespace().collect::<Vec<_>>().join(" ");
    BOOTSTRAP_QMAKE_PROBE_COMMANDS.contains(&normalized.as_str())
}

/// Stable rejection code surfaced to the model so it can recover.
pub const REJECT_CODE_INPUT_REQUIRED: &str = "qt_migration_input_required";
/// Stable rejection code used when the four inputs are bound but the managed
/// Qt migration skill has not been loaded (or its receipt is stale).
pub const REJECT_CODE_SKILL_REQUIRED: &str = "qt_migration_skill_required";

/// Pure decision: given the resolved intake, decide admission. The gate is
/// driven by Session admission state, not agent_type: a non-migration session
/// has no activated intake (None -> empty -> NotApplicable) so it is never
/// gated; a subagent that inherited an activated intake from a QtMigration
/// parent is gated regardless of its own agent_type. `input` is the tool
/// call's arguments, used to recognize the bootstrap qmake resolution command.
pub fn check_admission_for_intake(
    tool_name: &str,
    input: Option<&Value>,
    intake: &QtMigrationIntakeStateSnapshot,
) -> Result<(), ToolAdmissionRejection> {
    if intake.status == QtMigrationIntakeStatus::NotApplicable {
        return Ok(());
    }
    // Bootstrap tools are always allowed: they are required to finish input
    // collection and to load the migration skill itself.
    if BOOTSTRAP_ALLOWED_TOOLS.contains(&tool_name) {
        return Ok(());
    }
    // A measured generation mismatch is `Blocked` only until the user answers the
    // strategy question: that is a waiting state with a defined recovery, not the end
    // of the migration, so it must not be reported as terminal (a model told to "start
    // a new migration" would abandon the intake the user is about to decide). An
    // answered "do not migrate" stays terminal below, together with the other ended
    // states.
    if matches!(
        intake.version_strategy,
        QtMigrationVersionStrategy::Pending { .. }
    ) {
        return Err(ToolAdmissionRejection {
            code: REJECT_CODE_INPUT_REQUIRED,
            kind: "version_strategy_pending",
            missing_fields: Vec::new(),
            recovery_action: "call AskUserQuestion with your own question offering exactly two options and wait for the user's decision: the option that continues the migration must carry \"value\": \"continue_migration\" and the option that refuses it \"value\": \"abort\"",
        });
    }
    // Terminal states: a migration that is Blocked, Failed or Completed must
    // not accept further side effects even with a valid receipt — the
    // workflow has ended.
    match intake.status {
        QtMigrationIntakeStatus::Blocked
        | QtMigrationIntakeStatus::Failed
        | QtMigrationIntakeStatus::Completed => {
            return Err(ToolAdmissionRejection {
                code: REJECT_CODE_INPUT_REQUIRED,
                kind: "terminal",
                missing_fields: Vec::new(),
                recovery_action: "migration session ended; start a new migration",
            });
        }
        _ => {}
    }
    // Directly verify all four fields are at least Resolved, independent of the
    // derived status, so a corrupted snapshot with inconsistent status+fields
    // cannot bypass the gate.
    let missing: Vec<&'static str> = QT_MIGRATION_INTAKE_REQUIRED_FIELDS
        .iter()
        .copied()
        .filter(|field| {
            !intake
                .fields
                .get(*field)
                .map(|f| f.state.can_bind_value())
                .unwrap_or(false)
        })
        .collect();
    if !missing.is_empty() {
        // Bootstrap escape hatch: before the inputs are bound the model may
        // run exactly one read-only shell command — resolving the session
        // qmake the user configured into the environment so the question
        // card can offer it as the toolchain candidate. Everything else
        // stays rejected with the missing-fields recovery.
        if tool_name == "ExecCommand" && bootstrap_qmake_probe_command(input) {
            return Ok(());
        }
        return Err(ToolAdmissionRejection {
            code: REJECT_CODE_INPUT_REQUIRED,
            kind: "input_required",
            missing_fields: missing,
            recovery_action: "run ExecCommand with exactly `command -v qmake` to resolve the session toolchain, then answer the qt-migration-paths question template via AskUserQuestion",
        });
    }
    // Four fields are bound. The managed skill must have been loaded into this
    // Session; a missing or stale receipt keeps side effects blocked until the
    // Agent reloads the built-in `ohos-qt-skills`.
    let Some(receipt) = intake.loaded_skill_receipt.as_ref() else {
        return Err(ToolAdmissionRejection {
            code: REJECT_CODE_SKILL_REQUIRED,
            kind: "skill_required",
            missing_fields: Vec::new(),
            recovery_action: "load the built-in ohos-qt-skills via the Skill tool",
        });
    };
    if !is_valid_qt_migration_receipt(receipt) {
        return Err(ToolAdmissionRejection {
            code: REJECT_CODE_SKILL_REQUIRED,
            kind: "skill_stale",
            missing_fields: Vec::new(),
            recovery_action: "reload the built-in ohos-qt-skills via the Skill tool",
        });
    }
    Ok(())
}

/// `ToolAdmissionPolicy` for the Qt migration intake gate. Registered by
/// product assembly; reads session state only through [`DomainStateReader`].
///
/// A session marked as an active migration must fail closed when the intake
/// snapshot is missing or non-activated (e.g. an older persisted session whose
/// intake did not restore) instead of treating the absence as a non-migration
/// session and letting side effects through.
#[derive(Debug, Default)]
pub struct QtMigrationAdmissionPolicy;

impl ToolAdmissionPolicy for QtMigrationAdmissionPolicy {
    fn id(&self) -> &'static str {
        "qt_migration"
    }

    fn check(
        &self,
        request: &ToolAdmissionRequest<'_>,
        state: &dyn DomainStateReader,
    ) -> Result<(), ToolAdmissionRejection> {
        if request.session_id.is_none() {
            return Ok(());
        }
        let active = matches!(
            state.get(&QT_MIGRATION_SLOT_ACTIVE),
            Some(Value::Bool(true))
        );
        let intake = state
            .get(&QT_MIGRATION_SLOT_INTAKE_STATE)
            .and_then(|value| serde_json::from_value::<QtMigrationIntakeStateSnapshot>(value).ok())
            .unwrap_or_else(QtMigrationIntakeStateSnapshot::empty);
        if active && intake.status == QtMigrationIntakeStatus::NotApplicable {
            return Err(ToolAdmissionRejection {
                code: REJECT_CODE_INPUT_REQUIRED,
                kind: "intake_lost",
                missing_fields: Vec::new(),
                recovery_action: "reload the session or re-trigger the migration analyzer",
            });
        }
        check_admission_for_intake(request.tool_name, request.input, &intake)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{
        QtMigrationFieldResolutionState, QtMigrationIntakeFieldState,
        QtMigrationLoadedSkillReceipt, QT_MIGRATION_SKILL_DIR,
    };
    use std::collections::BTreeMap;

    fn snapshot(
        status: QtMigrationIntakeStatus,
        fields_state: QtMigrationFieldResolutionState,
    ) -> QtMigrationIntakeStateSnapshot {
        let mut fields = BTreeMap::new();
        for field in QT_MIGRATION_INTAKE_REQUIRED_FIELDS {
            fields.insert(
                field.to_string(),
                QtMigrationIntakeFieldState {
                    state: fields_state,
                    value: None,
                },
            );
        }
        QtMigrationIntakeStateSnapshot {
            schema_version: 1,
            fields,
            status,
            loaded_skill_receipt: None,
            version_strategy: QtMigrationVersionStrategy::default(),
        }
    }

    fn snapshot_with_receipt(
        status: QtMigrationIntakeStatus,
        fields_state: QtMigrationFieldResolutionState,
    ) -> QtMigrationIntakeStateSnapshot {
        let mut snap = snapshot(status, fields_state);
        snap.loaded_skill_receipt = Some(QtMigrationLoadedSkillReceipt {
            skill_key: "bitfun-system::harmony::ohos-qt-skills".to_string(),
            source_slot: "bitfun-system".to_string(),
            dir_name: QT_MIGRATION_SKILL_DIR.to_string(),
            content_hash: "deadbeef".to_string(),
        });
        snap
    }

    #[test]
    fn needs_input_rejects_side_effect_tool() {
        let intake = snapshot(
            QtMigrationIntakeStatus::NeedsInput,
            QtMigrationFieldResolutionState::Missing,
        );
        let rejection = check_admission_for_intake("Write", None, &intake)
            .expect_err("side effect must be rejected while inputs incomplete");
        assert_eq!(rejection.code, REJECT_CODE_INPUT_REQUIRED);
    }

    #[test]
    fn needs_input_allows_bootstrap_tools() {
        let intake = snapshot(
            QtMigrationIntakeStatus::NeedsInput,
            QtMigrationFieldResolutionState::Missing,
        );
        for tool in [
            "QtMigrationIntake",
            "AskUserQuestion",
            "Skill",
            "Read",
            "Grep",
            "Glob",
        ] {
            assert!(
                check_admission_for_intake(tool, None, &intake).is_ok(),
                "bootstrap tool {tool} must be allowed while inputs incomplete"
            );
        }
    }

    #[test]
    fn not_applicable_status_is_not_gated() {
        // Not yet an active migration: side effects must not be blocked even
        // without a receipt (activation happens earlier).
        let intake = snapshot(
            QtMigrationIntakeStatus::NotApplicable,
            QtMigrationFieldResolutionState::Resolved,
        );
        assert!(check_admission_for_intake("Write", None, &intake).is_ok());
    }

    #[test]
    fn resolved_inputs_without_receipt_rejects_skill_required() {
        for status in [
            QtMigrationIntakeStatus::NeedsValidation,
            QtMigrationIntakeStatus::Ready,
        ] {
            let intake = snapshot(status, QtMigrationFieldResolutionState::Resolved);
            let rejection = check_admission_for_intake("Write", None, &intake)
                .expect_err("side effects must be rejected until the skill is loaded");
            assert_eq!(rejection.code, REJECT_CODE_SKILL_REQUIRED);
        }
    }

    #[test]
    fn resolved_inputs_with_valid_receipt_allows_side_effects() {
        for status in [
            QtMigrationIntakeStatus::NeedsValidation,
            QtMigrationIntakeStatus::Ready,
        ] {
            let intake = snapshot_with_receipt(status, QtMigrationFieldResolutionState::Resolved);
            assert!(
                check_admission_for_intake("Write", None, &intake).is_ok(),
                "valid receipt must allow side effects for {status:?}"
            );
        }
    }

    #[test]
    fn resolved_inputs_with_stale_receipt_rejects() {
        // A receipt from an unmanaged source slot is stale.
        let mut intake = snapshot(
            QtMigrationIntakeStatus::NeedsValidation,
            QtMigrationFieldResolutionState::Resolved,
        );
        intake.loaded_skill_receipt = Some(QtMigrationLoadedSkillReceipt {
            skill_key: "user::ohos-qt-skills".to_string(),
            source_slot: "user-home".to_string(),
            dir_name: QT_MIGRATION_SKILL_DIR.to_string(),
            content_hash: "deadbeef".to_string(),
        });
        let rejection = check_admission_for_intake("Write", None, &intake)
            .expect_err("unmanaged source receipt must be rejected");
        assert_eq!(rejection.code, REJECT_CODE_SKILL_REQUIRED);

        // A receipt with the wrong dir name is stale too.
        let mut intake2 = snapshot(
            QtMigrationIntakeStatus::NeedsValidation,
            QtMigrationFieldResolutionState::Resolved,
        );
        intake2.loaded_skill_receipt = Some(QtMigrationLoadedSkillReceipt {
            skill_key: "bitfun-system::harmony::other".to_string(),
            source_slot: "bitfun-system".to_string(),
            dir_name: "other-skill".to_string(),
            content_hash: "deadbeef".to_string(),
        });
        let rejection = check_admission_for_intake("Write", None, &intake2)
            .expect_err("wrong dir name receipt must be rejected");
        assert_eq!(rejection.code, REJECT_CODE_SKILL_REQUIRED);
    }

    #[test]
    fn terminal_states_reject_side_effects() {
        for status in [
            QtMigrationIntakeStatus::Blocked,
            QtMigrationIntakeStatus::Failed,
            QtMigrationIntakeStatus::Completed,
        ] {
            let intake = snapshot_with_receipt(status, QtMigrationFieldResolutionState::Resolved);
            let rejection = check_admission_for_intake("Write", None, &intake)
                .expect_err("terminal state must reject side effects");
            assert_eq!(rejection.code, REJECT_CODE_INPUT_REQUIRED);
        }
    }

    #[test]
    fn a_pending_version_strategy_rejects_with_its_own_recovery() {
        // 代不一致且策略问题未答：状态是 Blocked，但这不是"迁移已结束"，恢复动作是去提问，
        // 而不是让模型重新开一次迁移。
        let mut intake = snapshot_with_receipt(
            QtMigrationIntakeStatus::Blocked,
            QtMigrationFieldResolutionState::Resolved,
        );
        intake.version_strategy = QtMigrationVersionStrategy::Pending {
            project: 6,
            toolchain: 5,
        };

        let rejection = check_admission_for_intake("Write", None, &intake)
            .expect_err("side effects must stay blocked while the strategy is pending");
        let message = rejection.to_message();
        assert!(message.contains("version_strategy_pending"));
        assert!(message.contains("AskUserQuestion"));
        assert!(
            message.contains("continue_migration") && message.contains("abort"),
            "恢复动作必须带上模型要写进选项的取值"
        );
        assert!(
            !message.contains("start a new migration"),
            "待答策略问题不是终止态，不该给出重开迁移的恢复动作"
        );
        // 提问本身和读取类工具仍要放行，否则用户无法作答。
        for tool in ["AskUserQuestion", "Skill", "Read"] {
            assert!(check_admission_for_intake(tool, None, &intake).is_ok());
        }
    }

    #[test]
    fn bootstrap_qmake_probe_recognition() {
        assert!(bootstrap_qmake_probe_command(Some(
            &serde_json::json!({"cmd": "command -v qmake"})
        )));
        assert!(bootstrap_qmake_probe_command(Some(
            &serde_json::json!({"cmd": "  command   -v qmake "})
        )));
        assert!(bootstrap_qmake_probe_command(Some(
            &serde_json::json!({"cmd": "which qmake"})
        )));
        assert!(!bootstrap_qmake_probe_command(Some(&serde_json::json!(
            {"cmd": "command -v qmake; rm -rf /"}
        ))));
        assert!(!bootstrap_qmake_probe_command(Some(
            &serde_json::json!({"cmd": "cat /etc/passwd"})
        )));
        assert!(!bootstrap_qmake_probe_command(None));
        assert!(!bootstrap_qmake_probe_command(Some(&serde_json::json!({}))));
    }

    #[test]
    fn bootstrap_qmake_probe_is_allowed_while_inputs_missing() {
        let intake = snapshot(
            QtMigrationIntakeStatus::NeedsInput,
            QtMigrationFieldResolutionState::Missing,
        );
        assert!(check_admission_for_intake(
            "ExecCommand",
            Some(&serde_json::json!({"cmd": "command -v qmake"})),
            &intake,
        )
        .is_ok());
        // Anything other than the exact probe command stays rejected.
        let rejection = check_admission_for_intake(
            "ExecCommand",
            Some(&serde_json::json!({"cmd": "cat /etc/passwd"})),
            &intake,
        )
        .expect_err("non-probe shell command must stay rejected");
        assert_eq!(rejection.code, REJECT_CODE_INPUT_REQUIRED);
        // Bash is not the bootstrap probe vehicle.
        let rejection = check_admission_for_intake(
            "Bash",
            Some(&serde_json::json!({"command": "command -v qmake"})),
            &intake,
        )
        .expect_err("Bash must stay rejected while inputs are missing");
        assert_eq!(rejection.code, REJECT_CODE_INPUT_REQUIRED);
    }

    /// Session-bound reader over the two slots the policy consumes.
    #[derive(Debug)]
    struct SlotReader {
        active: bool,
        intake: Option<QtMigrationIntakeStateSnapshot>,
    }
    impl DomainStateReader for SlotReader {
        fn get(&self, slot: &DomainStateSlot) -> Option<Value> {
            if slot == &QT_MIGRATION_SLOT_ACTIVE {
                return Some(Value::Bool(self.active));
            }
            if slot == &QT_MIGRATION_SLOT_INTAKE_STATE {
                return self
                    .intake
                    .as_ref()
                    .map(|snap| serde_json::to_value(snap).expect("serialize intake snapshot"));
            }
            None
        }
    }

    fn request(tool_name: &'static str) -> ToolAdmissionRequest<'static> {
        ToolAdmissionRequest {
            tool_name,
            input: None,
            session_id: Some("session-1"),
        }
    }

    #[test]
    fn slot_keys_are_the_persisted_metadata_keys_verbatim() {
        // Upgrade compatibility: session metadata on disk already carries these
        // keys, so a slot rename would orphan every restored intake.
        assert_eq!(QT_MIGRATION_SLOT_INTAKE_STATE.key, "qtMigrationIntakeState");
        assert_eq!(QT_MIGRATION_SLOT_ACTIVE.key, "qtMigrationActive");
        assert_eq!(QT_MIGRATION_SLOT_ACTIVE.namespace, "qt_migration");
    }

    #[test]
    fn policy_without_intake_state_stays_ungated() {
        let policy = QtMigrationAdmissionPolicy;
        assert!(policy
            .check(
                &request("Write"),
                &SlotReader {
                    active: false,
                    intake: None
                }
            )
            .is_ok());
    }

    #[test]
    fn policy_fails_closed_when_active_intake_is_lost() {
        let policy = QtMigrationAdmissionPolicy;
        let rejection = policy
            .check(
                &request("Write"),
                &SlotReader {
                    active: true,
                    intake: None,
                },
            )
            .expect_err("active migration without a restored intake must fail closed");
        assert_eq!(rejection.kind, "intake_lost");
        assert_eq!(rejection.code, REJECT_CODE_INPUT_REQUIRED);
    }

    #[test]
    fn policy_gates_side_effects_through_slots() {
        let policy = QtMigrationAdmissionPolicy;
        let intake = snapshot(
            QtMigrationIntakeStatus::NeedsInput,
            QtMigrationFieldResolutionState::Missing,
        );
        let rejection = policy
            .check(
                &request("Write"),
                &SlotReader {
                    active: true,
                    intake: Some(intake),
                },
            )
            .expect_err("active migration with missing inputs must gate side effects");
        assert_eq!(rejection.kind, "input_required");
    }

    #[test]
    fn policy_without_session_id_is_not_gated() {
        let policy = QtMigrationAdmissionPolicy;
        let admission = ToolAdmissionRequest {
            tool_name: "Write",
            input: None,
            session_id: None,
        };
        assert!(policy
            .check(
                &admission,
                &SlotReader {
                    active: true,
                    intake: None
                }
            )
            .is_ok());
    }
}
