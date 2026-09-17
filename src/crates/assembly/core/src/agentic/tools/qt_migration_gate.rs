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
use bitfun_agent_runtime::intake_state::{
    is_valid_qt_migration_receipt, IntakeStateSnapshot, IntakeStatus, INTAKE_REQUIRED_FIELDS,
};

/// Tools always allowed while the migration intake is incomplete: they are
/// required to finish input collection or load the migration skill, and carry
/// no migration side effects. Tools that mutate persistent state (TodoWrite,
/// goal tools) stay gated.
const BOOTSTRAP_ALLOWED_TOOLS: &[&str] = &[
    "AnalyzeMigrationRequest",
    "AskUserQuestion",
    "Skill",
    "Read",
    "Grep",
    "Glob",
];

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
/// (zero overhead for the rest of the product).
pub(crate) fn check_admission(tool_name: &str, context: &ToolUseContext) -> BitFunResult<()> {
    let Some(session_id) = context.session_id.as_deref() else {
        return Ok(());
    };

    let Some(coordinator) = get_global_coordinator() else {
        // Coordinator unavailable (e.g. tool-listing/test context) -> do not
        // gate. Production dispatch paths always have it set.
        return Ok(());
    };
    let session_manager = coordinator.get_session_manager();
    let migration_active = session_manager.migration_active(session_id);
    let intake = session_manager
        .intake_state(session_id)
        .unwrap_or_else(IntakeStateSnapshot::empty);
    // A session marked as an active migration must fail closed when the intake
    // snapshot is missing or non-activated (e.g. an older persisted session
    // whose intake did not restore) instead of treating the absence as a
    // non-migration session and letting side effects through.
    if migration_active && intake.status == IntakeStatus::NotApplicable {
        return Err(QtMigrationAdmissionRejection {
            code: REJECT_CODE_INPUT_REQUIRED,
            kind: "intake_lost",
            missing_fields: Vec::new(),
            recovery_action: "reload the session or re-trigger the migration analyzer",
        }
        .to_error());
    }
    check_admission_for_intake(tool_name, &intake)
}

/// Pure decision: given the resolved intake, decide admission. The gate is
/// driven by Session admission state, not agent_type: a non-migration session
/// has no activated intake (None -> empty -> NotApplicable) so it is never
/// gated; a subagent that inherited an activated intake from a QtMigration
/// parent is gated regardless of its own agent_type.
pub(crate) fn check_admission_for_intake(
    tool_name: &str,
    intake: &IntakeStateSnapshot,
) -> BitFunResult<()> {
    if intake.status == IntakeStatus::NotApplicable {
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
        IntakeStatus::Blocked | IntakeStatus::Failed | IntakeStatus::Completed => {
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
    let missing: Vec<&'static str> = INTAKE_REQUIRED_FIELDS
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
        return Err(QtMigrationAdmissionRejection {
            code: REJECT_CODE_INPUT_REQUIRED,
            kind: "input_required",
            missing_fields: missing,
            recovery_action: "answer the qt-migration-paths question template via AskUserQuestion",
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
    use bitfun_agent_runtime::intake_state::{
        FieldResolutionState, IntakeFieldState, LoadedSkillReceipt, INTAKE_REQUIRED_FIELDS,
        OHOS_QT_SKILLS_DIR,
    };
    use std::collections::BTreeMap;

    fn snapshot(status: IntakeStatus, fields_state: FieldResolutionState) -> IntakeStateSnapshot {
        let mut fields = BTreeMap::new();
        for field in INTAKE_REQUIRED_FIELDS {
            fields.insert(
                field.to_string(),
                IntakeFieldState {
                    state: fields_state,
                    value: None,
                },
            );
        }
        IntakeStateSnapshot {
            schema_version: 1,
            fields,
            status,
            loaded_skill_receipt: None,
        }
    }

    fn snapshot_with_receipt(
        status: IntakeStatus,
        fields_state: FieldResolutionState,
    ) -> IntakeStateSnapshot {
        let mut snap = snapshot(status, fields_state);
        snap.loaded_skill_receipt = Some(LoadedSkillReceipt {
            skill_key: "bitfun-system::harmony::ohos-qt-skills".to_string(),
            source_slot: "bitfun-system".to_string(),
            dir_name: OHOS_QT_SKILLS_DIR.to_string(),
            content_hash: "deadbeef".to_string(),
        });
        snap
    }

    #[test]
    fn needs_input_rejects_side_effect_tool() {
        let intake = snapshot(IntakeStatus::NeedsInput, FieldResolutionState::Missing);
        let err = check_admission_for_intake("Write", &intake)
            .expect_err("side effect must be rejected while inputs incomplete");
        assert!(err.to_string().contains(REJECT_CODE_INPUT_REQUIRED));
    }

    #[test]
    fn needs_input_allows_bootstrap_tools() {
        let intake = snapshot(IntakeStatus::NeedsInput, FieldResolutionState::Missing);
        for tool in [
            "AnalyzeMigrationRequest",
            "AskUserQuestion",
            "Skill",
            "Read",
            "Grep",
            "Glob",
        ] {
            assert!(
                check_admission_for_intake(tool, &intake).is_ok(),
                "bootstrap tool {tool} must be allowed while inputs incomplete"
            );
        }
    }

    #[test]
    fn not_applicable_status_is_not_gated() {
        // Not yet an active migration: side effects must not be blocked even
        // without a receipt (activation happens earlier).
        let intake = snapshot(IntakeStatus::NotApplicable, FieldResolutionState::Resolved);
        assert!(check_admission_for_intake("Write", &intake).is_ok());
    }

    #[test]
    fn resolved_inputs_without_receipt_rejects_skill_required() {
        for status in [IntakeStatus::NeedsValidation, IntakeStatus::Ready] {
            let intake = snapshot(status, FieldResolutionState::Resolved);
            let err = check_admission_for_intake("Write", &intake)
                .expect_err("side effects must be rejected until the skill is loaded");
            assert!(err.to_string().contains(REJECT_CODE_SKILL_REQUIRED));
        }
    }

    #[test]
    fn resolved_inputs_with_valid_receipt_allows_side_effects() {
        for status in [IntakeStatus::NeedsValidation, IntakeStatus::Ready] {
            let intake = snapshot_with_receipt(status, FieldResolutionState::Resolved);
            assert!(
                check_admission_for_intake("Write", &intake).is_ok(),
                "valid receipt must allow side effects for {status:?}"
            );
        }
    }

    #[test]
    fn resolved_inputs_with_stale_receipt_rejects() {
        // A receipt from an unmanaged source slot is stale.
        let mut intake = snapshot(
            IntakeStatus::NeedsValidation,
            FieldResolutionState::Resolved,
        );
        intake.loaded_skill_receipt = Some(LoadedSkillReceipt {
            skill_key: "user::ohos-qt-skills".to_string(),
            source_slot: "user-home".to_string(),
            dir_name: OHOS_QT_SKILLS_DIR.to_string(),
            content_hash: "deadbeef".to_string(),
        });
        let err = check_admission_for_intake("Write", &intake)
            .expect_err("unmanaged source receipt must be rejected");
        assert!(err.to_string().contains(REJECT_CODE_SKILL_REQUIRED));

        // A receipt with the wrong dir name is stale too.
        let mut intake2 = snapshot(
            IntakeStatus::NeedsValidation,
            FieldResolutionState::Resolved,
        );
        intake2.loaded_skill_receipt = Some(LoadedSkillReceipt {
            skill_key: "bitfun-system::harmony::other".to_string(),
            source_slot: "bitfun-system".to_string(),
            dir_name: "other-skill".to_string(),
            content_hash: "deadbeef".to_string(),
        });
        let err = check_admission_for_intake("Write", &intake2)
            .expect_err("wrong dir name receipt must be rejected");
        assert!(err.to_string().contains(REJECT_CODE_SKILL_REQUIRED));
    }

    #[test]
    fn bootstrap_tools_allowed_without_receipt() {
        // Bootstrap tools (including Skill itself) run even before the receipt
        // exists — loading the skill is the bootstrap action that produces it.
        let intake = snapshot(
            IntakeStatus::NeedsValidation,
            FieldResolutionState::Resolved,
        );
        for tool in [
            "AnalyzeMigrationRequest",
            "AskUserQuestion",
            "Skill",
            "Read",
            "Grep",
            "Glob",
        ] {
            assert!(
                check_admission_for_intake(tool, &intake).is_ok(),
                "bootstrap tool {tool} must be allowed even without a receipt"
            );
        }
    }

    #[test]
    fn rejection_lists_missing_fields() {
        let mut intake = snapshot(IntakeStatus::NeedsInput, FieldResolutionState::Missing);
        // One field resolved, the rest still missing.
        intake.fields.get_mut("source_project").unwrap().state = FieldResolutionState::Resolved;
        let err = check_admission_for_intake("Edit", &intake)
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
            IntakeStatus::Blocked,
            IntakeStatus::Failed,
            IntakeStatus::Completed,
        ] {
            let intake = snapshot_with_receipt(status, FieldResolutionState::Resolved);
            let err = check_admission_for_intake("Write", &intake)
                .expect_err("terminal state must reject side effects");
            assert!(err.to_string().contains(REJECT_CODE_INPUT_REQUIRED));
        }
    }

    #[test]
    fn inconsistent_status_with_unresolved_fields_rejects() {
        // Corrupted/hand-constructed snapshot: status claims Ready but a field
        // is still Missing — the gate must verify fields directly, not trust
        // status.
        let mut intake = snapshot(IntakeStatus::Ready, FieldResolutionState::Resolved);
        intake.fields.get_mut("toolchain").unwrap().state = FieldResolutionState::Missing;
        let err = check_admission_for_intake("Write", &intake)
            .expect_err("inconsistent status+fields must reject");
        let message = err.to_string();
        assert!(message.contains(REJECT_CODE_INPUT_REQUIRED));
        assert!(message.contains("toolchain"));
    }
}
