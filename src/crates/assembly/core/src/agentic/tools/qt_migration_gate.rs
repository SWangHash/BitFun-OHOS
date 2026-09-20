//! QtMigration admission gate.
//!
//! Dispatch-time check at the unified tool execution boundary
//! (`call_with_tool_runtime_hooks`). When a QtMigration session has an
//! activated intake that is still missing bound inputs, side-effect tools are
//! rejected until the four minimum inputs reach `Resolved` and the migration
//! skill has been loaded. Bootstrap-only capabilities (the tools needed to
//! complete input collection and load the migration skill) are always allowed.

use crate::agentic::coordination::get_global_coordinator;
use crate::agentic::tools::framework::ToolUseContext;
use crate::util::errors::{BitFunError, BitFunResult};
use bitfun_agent_runtime::qt_migration_intake_state::{
    is_valid_qt_migration_receipt, QtMigrationIntakeStateSnapshot, QtMigrationIntakeStatus,
    QT_MIGRATION_INTAKE_REQUIRED_FIELDS,
};
use serde_json::Value;

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
const REJECT_CODE_INPUT_REQUIRED: &str = "qt_migration_input_required";
/// Stable rejection code used when the four inputs are bound but the managed
/// Qt migration skill has not been loaded (or its receipt is stale).
const REJECT_CODE_SKILL_REQUIRED: &str = "qt_migration_skill_required";

/// Structured admission rejection. Carries a stable code, failure kind, the
/// missing input fields (if any) and a recovery action so the Host/UI can
/// project a recovery path without parsing free-form text.
#[derive(Debug, Clone)]
pub(crate) struct QtMigrationAdmissionRejection {
    pub code: &'static str,
    pub kind: &'static str,
    pub missing_fields: Vec<&'static str>,
    pub recovery_action: &'static str,
}

impl QtMigrationAdmissionRejection {
    /// Render into the stable error text consumed by the model and surfaced to
    /// the Host/UI: `code: kind[; missing: ...]; recovery: ...`. The Host
    /// matches `code` and may parse `kind`/`missing` without depending on prose.
    pub(crate) fn to_error(&self) -> BitFunError {
        let missing_part = if self.missing_fields.is_empty() {
            String::new()
        } else {
            format!("; missing: {}", self.missing_fields.join(", "))
        };
        BitFunError::tool(format!(
            "{}: {}{}; recovery: {}",
            self.code, self.kind, missing_part, self.recovery_action
        ))
    }
}

/// Check whether `tool_name` may execute under the current QtMigration
/// admission state. Returns `Ok(())` when allowed, or a structured rejection
/// error otherwise. Sessions without an activated intake are never gated
/// (zero overhead for the rest of the product). `input` is the tool call's
/// arguments, used to recognize the bootstrap qmake resolution command.
pub(crate) fn check_admission(
    tool_name: &str,
    input: Option<&Value>,
    context: &ToolUseContext,
) -> BitFunResult<()> {
    let Some(session_id) = context.session_id.as_deref() else {
        return Ok(());
    };

    let Some(coordinator) = get_global_coordinator() else {
        // Coordinator unavailable (e.g. tool-listing/test context) -> do not
        // gate. Production dispatch paths always have it set.
        return Ok(());
    };
    let session_manager = coordinator.get_session_manager();
    let qt_migration_active = session_manager.qt_migration_active(session_id);
    let intake = session_manager
        .qt_migration_intake_state(session_id)
        .unwrap_or_else(QtMigrationIntakeStateSnapshot::empty);
    // A session marked as an active migration must fail closed when the intake
    // snapshot is missing or non-activated (e.g. an older persisted session
    // whose intake did not restore) instead of treating the absence as a
    // non-migration session and letting side effects through.
    if qt_migration_active && intake.status == QtMigrationIntakeStatus::NotApplicable {
        return Err(QtMigrationAdmissionRejection {
            code: REJECT_CODE_INPUT_REQUIRED,
            kind: "intake_lost",
            missing_fields: Vec::new(),
            recovery_action: "reload the session or re-trigger the migration analyzer",
        }
        .to_error());
    }
    check_admission_for_intake(tool_name, input, &intake)
}

/// Pure decision: given the resolved intake, decide admission. The gate is
/// driven by Session admission state, not agent_type: a non-migration session
/// has no activated intake (None -> empty -> NotApplicable) so it is never
/// gated; a subagent that inherited an activated intake from a QtMigration
/// parent is gated regardless of its own agent_type. `input` is the tool
/// call's arguments, used to recognize the bootstrap qmake resolution command.
pub(crate) fn check_admission_for_intake(
    tool_name: &str,
    input: Option<&Value>,
    intake: &QtMigrationIntakeStateSnapshot,
) -> BitFunResult<()> {
    if intake.status == QtMigrationIntakeStatus::NotApplicable {
        return Ok(());
    }
    // Bootstrap tools are always allowed: they are required to finish input
    // collection and to load the migration skill itself.
    if BOOTSTRAP_ALLOWED_TOOLS.contains(&tool_name) {
        return Ok(());
    }
    // Terminal states: a migration that is Blocked, Failed or Completed must
    // not accept further side effects even with a valid receipt — the
    // workflow has ended.
    match intake.status {
        QtMigrationIntakeStatus::Blocked
        | QtMigrationIntakeStatus::Failed
        | QtMigrationIntakeStatus::Completed => {
            return Err(QtMigrationAdmissionRejection {
                code: REJECT_CODE_INPUT_REQUIRED,
                kind: "terminal",
                missing_fields: Vec::new(),
                recovery_action: "migration session ended; start a new migration",
            }
            .to_error());
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
        return Err(QtMigrationAdmissionRejection {
            code: REJECT_CODE_INPUT_REQUIRED,
            kind: "input_required",
            missing_fields: missing,
            recovery_action: "run ExecCommand with exactly `command -v qmake` to resolve the session toolchain, then answer the qt-migration-paths question template via AskUserQuestion",
        }
        .to_error());
    }
    // Four fields are bound. The managed skill must have been loaded into this
    // Session; a missing or stale receipt keeps side effects blocked until the
    // Agent reloads the built-in `ohos-qt-skills`.
    let Some(receipt) = intake.loaded_skill_receipt.as_ref() else {
        return Err(QtMigrationAdmissionRejection {
            code: REJECT_CODE_SKILL_REQUIRED,
            kind: "skill_required",
            missing_fields: Vec::new(),
            recovery_action: "load the built-in ohos-qt-skills via the Skill tool",
        }
        .to_error());
    };
    if !is_valid_qt_migration_receipt(receipt) {
        return Err(QtMigrationAdmissionRejection {
            code: REJECT_CODE_SKILL_REQUIRED,
            kind: "skill_stale",
            missing_fields: Vec::new(),
            recovery_action: "reload the built-in ohos-qt-skills via the Skill tool",
        }
        .to_error());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitfun_agent_runtime::qt_migration_intake_state::{
        QtMigrationFieldResolutionState, QtMigrationIntakeFieldState,
        QtMigrationLoadedSkillReceipt, QT_MIGRATION_INTAKE_REQUIRED_FIELDS, QT_MIGRATION_SKILL_DIR,
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
        let err = check_admission_for_intake("Write", None, &intake)
            .expect_err("side effect must be rejected while inputs incomplete");
        assert!(err.to_string().contains(REJECT_CODE_INPUT_REQUIRED));
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
            let err = check_admission_for_intake("Write", None, &intake)
                .expect_err("side effects must be rejected until the skill is loaded");
            assert!(err.to_string().contains(REJECT_CODE_SKILL_REQUIRED));
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
        let err = check_admission_for_intake("Write", None, &intake)
            .expect_err("unmanaged source receipt must be rejected");
        assert!(err.to_string().contains(REJECT_CODE_SKILL_REQUIRED));

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
        let err = check_admission_for_intake("Write", None, &intake2)
            .expect_err("wrong dir name receipt must be rejected");
        assert!(err.to_string().contains(REJECT_CODE_SKILL_REQUIRED));
    }

    #[test]
    fn bootstrap_tools_allowed_without_receipt() {
        // Bootstrap tools (including Skill itself) run even before the receipt
        // exists — loading the skill is the bootstrap action that produces it.
        let intake = snapshot(
            QtMigrationIntakeStatus::NeedsValidation,
            QtMigrationFieldResolutionState::Resolved,
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
                "bootstrap tool {tool} must be allowed even without a receipt"
            );
        }
    }

    #[test]
    fn rejection_lists_missing_fields() {
        let mut intake = snapshot(
            QtMigrationIntakeStatus::NeedsInput,
            QtMigrationFieldResolutionState::Missing,
        );
        // One field resolved, the rest still missing.
        intake.fields.get_mut("source_project").unwrap().state =
            QtMigrationFieldResolutionState::Resolved;
        let err = check_admission_for_intake("Edit", None, &intake)
            .expect_err("incomplete inputs must reject Edit");
        let message = err.to_string();
        assert!(
            !message.contains("source_project"),
            "resolved field not listed"
        );
        assert!(message.contains("output_project"));
        assert!(message.contains("toolchain"));
        assert!(message.contains("template"));
    }

    #[test]
    fn terminal_states_reject_side_effects() {
        for status in [
            QtMigrationIntakeStatus::Blocked,
            QtMigrationIntakeStatus::Failed,
            QtMigrationIntakeStatus::Completed,
        ] {
            let intake = snapshot_with_receipt(status, QtMigrationFieldResolutionState::Resolved);
            let err = check_admission_for_intake("Write", None, &intake)
                .expect_err("terminal state must reject side effects");
            assert!(err.to_string().contains(REJECT_CODE_INPUT_REQUIRED));
        }
    }

    #[test]
    fn inconsistent_status_with_unresolved_fields_rejects() {
        // Corrupted/hand-constructed snapshot: status claims Ready but a field
        // is still Missing — the gate must verify fields directly, not trust
        // status.
        let mut intake = snapshot(
            QtMigrationIntakeStatus::Ready,
            QtMigrationFieldResolutionState::Resolved,
        );
        intake.fields.get_mut("toolchain").unwrap().state =
            QtMigrationFieldResolutionState::Missing;
        let err = check_admission_for_intake("Write", None, &intake)
            .expect_err("inconsistent status+fields must reject");
        let message = err.to_string();
        assert!(message.contains(REJECT_CODE_INPUT_REQUIRED));
        assert!(message.contains("toolchain"));
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
        let err = check_admission_for_intake(
            "ExecCommand",
            Some(&serde_json::json!({"cmd": "cat /etc/passwd"})),
            &intake,
        )
        .expect_err("non-probe shell command must stay rejected");
        assert!(err.to_string().contains(REJECT_CODE_INPUT_REQUIRED));
        // Bash is not the bootstrap probe vehicle.
        let err = check_admission_for_intake(
            "Bash",
            Some(&serde_json::json!({"command": "command -v qmake"})),
            &intake,
        )
        .expect_err("Bash must stay rejected while inputs are missing");
        assert!(err.to_string().contains(REJECT_CODE_INPUT_REQUIRED));
    }

    #[test]
    fn bootstrap_qmake_probe_closes_once_inputs_are_bound() {
        // All four bound + valid receipt → normal gate: ExecCommand flows
        // through regardless (the escape hatch only covers the missing window).
        let intake = snapshot_with_receipt(
            QtMigrationIntakeStatus::NeedsValidation,
            QtMigrationFieldResolutionState::Resolved,
        );
        assert!(check_admission_for_intake(
            "ExecCommand",
            Some(&serde_json::json!({"cmd": "command -v qmake"})),
            &intake,
        )
        .is_ok());
        // In terminal states even the probe stays rejected.
        let terminal = snapshot_with_receipt(
            QtMigrationIntakeStatus::Completed,
            QtMigrationFieldResolutionState::Resolved,
        );
        let err = check_admission_for_intake(
            "ExecCommand",
            Some(&serde_json::json!({"cmd": "command -v qmake"})),
            &terminal,
        )
        .expect_err("terminal state must reject even the bootstrap probe");
        assert!(err.to_string().contains("terminal"));
    }
}
