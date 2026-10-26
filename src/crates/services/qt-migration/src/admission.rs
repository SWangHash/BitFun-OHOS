//! Qt migration tool admission: which tools may run while the migration
//! intake is incomplete.
//!
//! Registered as a `ToolAdmissionPolicy`; session state is read only through
//! `DomainStateReader` slots. Sessions without an activated intake stay
//! ungated (zero overhead for the rest of the product).

use std::path::{Path, PathBuf};

use bitfun_runtime_ports::{
    DomainStateReader, DomainStateSlot, ToolAdmissionPolicy, ToolAdmissionRejection,
    ToolAdmissionRequest,
};
use serde_json::Value;

use crate::scan::path_key;
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
/// Host directory of the managed built-in Qt migration skill (JSON string). The
/// BitFun acquisition scripts that own the resource-root policy live in that
/// skill's own `scripts/`, so the `__official__` guidance must name them by an
/// absolute path: the vendored upstream copies under
/// `upstream-kb/knowledge/skills/kb-init/scripts/` need an explicit `--dest` and
/// install outside the scanned root.
pub const QT_MIGRATION_SLOT_SKILL_DIR: DomainStateSlot = DomainStateSlot {
    namespace: QT_MIGRATION_STATE_NAMESPACE,
    key: "skill_dir",
};
/// Session workspace root (JSON string), resolved live by the host. It is what
/// the write-scope check measures a migration artifact against, so it describes
/// the session's workspace rather than the intake and is never persisted.
pub const QT_MIGRATION_SLOT_WORKSPACE_ROOT: DomainStateSlot = DomainStateSlot {
    namespace: QT_MIGRATION_STATE_NAMESPACE,
    key: "workspaceRoot",
};

/// Tools always allowed while the migration intake is incomplete: they are
/// required to finish input collection, load the migration skill, or read the
/// workspace to find the project — and carry no migration side effects. The
/// read-only workspace tools are what the intake reconnaissance reads the disk
/// with; the project is named by the model, not discovered by the backend. Tools
/// that mutate persistent state (TodoWrite, goal tools) stay gated.
const BOOTSTRAP_ALLOWED_TOOLS: &[&str] = &[
    "QtMigrationIntake",
    "AskUserQuestion",
    "Skill",
    "Read",
    "Grep",
    "Glob",
    "LS",
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
/// Stable rejection code used when a file-writing tool aims outside the
/// migration's own project directory (#352, #364).
pub const REJECT_CODE_WRITE_SCOPE: &str = "qt_migration_write_outside_project";

/// Write tools whose target path is readable before the call runs. The shell
/// tool is deliberately absent: its targets are only known once the command has
/// already run, so a scope check there would be guesswork.
const SCOPED_WRITE_TOOLS: &[&str] = &["Write", "Edit", "Delete"];

/// Path marker of the `Write` tool's payload, whose first line names the target.
const WRITE_PAYLOAD_PATH_PREFIX: &str = "+++ ";

/// Roots a migration may write into, resolved from host and intake state.
#[derive(Debug, Default, Clone, Copy)]
pub struct QtMigrationWriteScope<'a> {
    /// Session workspace root. `None` (unknown workspace) leaves writes
    /// ungated rather than guessing where the workspace is.
    pub workspace_root: Option<&'a Path>,
    /// The migration's own project directory, `<container>/<app-name>-ohos`.
    pub project_dir: Option<&'a Path>,
    /// Managed roots the `__official__` scripts install into.
    pub managed_roots: &'a [&'a Path],
}

/// The path a scoped write tool targets, when the call carries one.
fn scoped_write_target(tool_name: &str, input: Option<&Value>) -> Option<String> {
    let input = input?;
    let raw = match tool_name {
        "Write" => input
            .get("payload")
            .and_then(Value::as_str)?
            .lines()
            .next()?
            .strip_prefix(WRITE_PAYLOAD_PATH_PREFIX)?
            .trim(),
        "Edit" => input.get("file_path").and_then(Value::as_str)?.trim(),
        "Delete" => input.get("path").and_then(Value::as_str)?.trim(),
        _ => return None,
    };
    (!raw.is_empty()).then(|| raw.to_string())
}

/// Whether the normalized `target` is `root` itself or sits below it.
fn path_key_is_inside(root: &Path, target_key: &str) -> bool {
    let root_key = path_key(root);
    !root_key.is_empty()
        && (target_key == root_key || target_key.starts_with(&format!("{root_key}/")))
}

/// Keep every migration artifact inside the project directory or a managed
/// root. Reports from the intake round were artifacts left in the workspace
/// root, a pilot project built beside the workspace, and intermediate files
/// unpacked next to a custom output container (#352, #364), so once the
/// project directory is known nothing else is in scope. A session without one
/// falls back to rejecting the workspace itself and the workspace's parent.
pub fn check_migration_write_scope(
    tool_name: &str,
    input: Option<&Value>,
    scope: &QtMigrationWriteScope<'_>,
) -> Result<(), ToolAdmissionRejection> {
    if !SCOPED_WRITE_TOOLS.contains(&tool_name) {
        return Ok(());
    }
    let Some(workspace_root) = scope.workspace_root else {
        return Ok(());
    };
    let Some(raw) = scoped_write_target(tool_name, input) else {
        return Ok(());
    };
    // A `bitfun://` URI does not name a filesystem path yet.
    if raw.starts_with("bitfun://") {
        return Ok(());
    }
    let target = if Path::new(&raw).is_absolute() {
        PathBuf::from(&raw)
    } else {
        workspace_root.join(&raw)
    };
    let target_key = path_key(&target);
    if scope
        .managed_roots
        .iter()
        .any(|root| path_key_is_inside(root, &target_key))
        || scope
            .project_dir
            .is_some_and(|project| path_key_is_inside(project, &target_key))
    {
        return Ok(());
    }
    let kind = if path_key_is_inside(workspace_root, &target_key) {
        "outside_project"
    } else if scope.project_dir.is_none() {
        // Without a project directory to measure against, only the shape the
        // reports named is rejected.
        let Some(parent) = workspace_root
            .parent()
            .filter(|parent| parent.parent().is_some())
        else {
            return Ok(());
        };
        if path_key_is_inside(parent, &target_key) {
            "workspace_parent"
        } else {
            return Ok(());
        }
    } else if let Some(parent) = workspace_root
        .parent()
        .filter(|parent| parent.parent().is_some())
    {
        // A running migration with a known project directory writes nowhere
        // else: a pilot project beside a custom output container, or a scratch
        // file next to the workspace, is the same defect (#364).
        if path_key_is_inside(parent, &target_key) {
            "workspace_parent"
        } else {
            "outside_project"
        }
    } else {
        "outside_project"
    };
    Err(ToolAdmissionRejection {
        code: REJECT_CODE_WRITE_SCOPE,
        kind,
        missing_fields: Vec::new(),
        recovery_action: "write inside the migration project directory the bound-inputs instruction names, or a path the migration ledger records",
    })
}

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
        check_admission_for_intake(request.tool_name, request.input, &intake)?;
        // Past this point the migration is running, so where its artifacts land
        // is checked against the roots the host reports.
        if intake.status == QtMigrationIntakeStatus::NotApplicable {
            return Ok(());
        }
        let workspace_root = slot_path(state, &QT_MIGRATION_SLOT_WORKSPACE_ROOT);
        let toolchains_dir = slot_path(state, &QT_MIGRATION_SLOT_TOOLCHAINS_DIR);
        let templates_dir = slot_path(state, &QT_MIGRATION_SLOT_TEMPLATES_DIR);
        let managed_roots: Vec<&Path> = [&toolchains_dir, &templates_dir]
            .iter()
            .filter_map(|path| path.as_deref())
            .collect();
        let project_dir = intake
            .output_project_dir
            .clone()
            // The latch is authoritative; a session whose intake predates it
            // still derives the same directory the bound-inputs instruction
            // names, so the gate cannot lock the migration out of its own
            // project directory.
            .or_else(|| {
                let container = intake.fields.get("output_project")?.value.clone()?;
                let source = intake.fields.get("source_project")?.value.clone()?;
                Some(crate::instructions::output_project_dir(&container, &source))
            })
            .map(PathBuf::from);
        check_migration_write_scope(
            request.tool_name,
            request.input,
            &QtMigrationWriteScope {
                workspace_root: workspace_root.as_deref(),
                project_dir: project_dir.as_deref(),
                managed_roots: &managed_roots,
            },
        )
    }
}

/// Path carried by a host-resolved state slot, or `None` when the host does not
/// report one for this session.
fn slot_path(state: &dyn DomainStateReader, slot: &DomainStateSlot) -> Option<PathBuf> {
    state.get(slot)?.as_str().map(PathBuf::from)
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
            output_project_dir: None,
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
            "LS",
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
        workspace_root: Option<String>,
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
            if slot == &QT_MIGRATION_SLOT_WORKSPACE_ROOT {
                return self.workspace_root.clone().map(Value::String);
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
                    intake: None,
                    workspace_root: None
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
                    workspace_root: None,
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
                    workspace_root: None,
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
                    intake: None,
                    workspace_root: None
                }
            )
            .is_ok());
    }

    /// Intake whose four paths are bound and whose project directory is latched.
    fn bound_intake(project_dir: &str) -> QtMigrationIntakeStateSnapshot {
        let mut intake = snapshot_with_receipt(
            QtMigrationIntakeStatus::NeedsValidation,
            QtMigrationFieldResolutionState::Resolved,
        );
        intake.output_project_dir = Some(project_dir.to_string());
        intake
    }

    /// Bound intake that predates the latched project directory.
    fn intake_with_paths(container: &str, source: &str) -> QtMigrationIntakeStateSnapshot {
        let mut intake = snapshot_with_receipt(
            QtMigrationIntakeStatus::NeedsValidation,
            QtMigrationFieldResolutionState::Resolved,
        );
        for (field, value) in [("output_project", container), ("source_project", source)] {
            intake.fields.insert(
                field.to_string(),
                QtMigrationIntakeFieldState {
                    state: QtMigrationFieldResolutionState::Resolved,
                    value: Some(value.to_string()),
                },
            );
        }
        intake
    }

    fn scope_error(tool: &str, input: Value) -> ToolAdmissionRejection {
        let owned = PathBuf::from("/work/qt6/app");
        let project = PathBuf::from("/work/qt6/app/app-ohos");
        let managed = PathBuf::from("/home/u/.bitfun/qt-migration/toolchains");
        let roots: Vec<&Path> = vec![&managed];
        check_migration_write_scope(
            tool,
            Some(&input),
            &QtMigrationWriteScope {
                workspace_root: Some(&owned),
                project_dir: Some(&project),
                managed_roots: &roots,
            },
        )
        .expect_err("the artifact must be rejected")
    }

    fn scope_allows(tool: &str, input: Value) -> bool {
        let owned = PathBuf::from("/work/qt6/app");
        let project = PathBuf::from("/work/qt6/app/app-ohos");
        let managed = PathBuf::from("/home/u/.bitfun/qt-migration/toolchains");
        let roots: Vec<&Path> = vec![&managed];
        check_migration_write_scope(
            tool,
            Some(&input),
            &QtMigrationWriteScope {
                workspace_root: Some(&owned),
                project_dir: Some(&project),
                managed_roots: &roots,
            },
        )
        .is_ok()
    }

    #[test]
    fn writes_inside_the_project_and_the_managed_roots_pass() {
        // 工程目录内（工程目录本身就是容器下的 <app-name>-ohos）与托管根都要放行，
        // 否则正常迁移会被自己的门禁挡住。
        assert!(scope_allows(
            "Write",
            serde_json::json!({"payload": "+++ /work/qt6/app/app-ohos/entry/src/main.ets\nx"})
        ));
        assert!(scope_allows(
            "Edit",
            serde_json::json!({"file_path": "app-ohos/build/profile/default/CMakeLists.txt"})
        ));
        assert!(scope_allows(
            "Delete",
            serde_json::json!({"path": "/home/u/.bitfun/qt-migration/toolchains/qt6.13.0/bin/qmake"})
        ));
    }

    #[test]
    fn an_artifact_left_in_the_workspace_is_rejected() {
        // #352：迁移中间产物不许落在工作区里（容器就是工作区根时，工作区根下只应多出
        // 那一个工程目录）。
        for input in [
            serde_json::json!({"payload": "+++ /work/qt6/app/build.log\nx"}),
            serde_json::json!({"payload": "+++ /work/qt6/app/entry/src/main.ets\nx"}),
        ] {
            let rejection = scope_error("Write", input);
            assert_eq!(rejection.code, REJECT_CODE_WRITE_SCOPE);
            assert_eq!(rejection.kind, "outside_project");
            assert!(
                rejection.to_message().contains("project directory"),
                "恢复动作要指向工程目录"
            );
        }
        // 相对路径按工作区解析，同样拦住。
        assert_eq!(
            scope_error("Delete", serde_json::json!({"path": "entry/src/main.ets"})).kind,
            "outside_project"
        );
    }

    #[test]
    fn an_artifact_beside_the_workspace_is_rejected() {
        // #364：工作区的父目录下也不许出现中间文件/试点工程目录。
        let rejection = scope_error(
            "Write",
            serde_json::json!({"payload": "+++ /work/qt6/pilot-project/ohos/entry/src/main.ets\nx"}),
        );
        assert_eq!(rejection.kind, "workspace_parent");
        // 自定义输出容器（工作区之外）里，工程目录及其之下照常放行。
        let custom_container = PathBuf::from("/out/myapp-ohos");
        let owned = PathBuf::from("/work/qt6/app");
        let roots: Vec<&Path> = Vec::new();
        assert!(check_migration_write_scope(
            "Write",
            Some(&serde_json::json!({"payload": "+++ /out/myapp-ohos/entry/src/main.ets\nx"})),
            &QtMigrationWriteScope {
                workspace_root: Some(&owned),
                project_dir: Some(&custom_container),
                managed_roots: &roots,
            },
        )
        .is_ok());
        // 同一个自定义容器里另建的试点工程目录仍然不合格：迁移只有工程目录这一个落点。
        let rejection = check_migration_write_scope(
            "Write",
            Some(&serde_json::json!({"payload": "+++ /out/pilot/entry/src/main.ets\nx"})),
            &QtMigrationWriteScope {
                workspace_root: Some(&owned),
                project_dir: Some(&custom_container),
                managed_roots: &roots,
            },
        )
        .expect_err("a pilot directory beside the output container must be rejected");
        assert_eq!(rejection.kind, "outside_project");
        // 更远处（例如系统临时目录）同样不是迁移的落点。
        let rejection = scope_error(
            "Write",
            serde_json::json!({"payload": "+++ /tmp/build/notes.txt\nx"}),
        );
        assert_eq!(rejection.kind, "outside_project");
    }

    #[test]
    fn an_unknown_workspace_leaves_writes_ungated() {
        // 宿主没给出工作区时不猜位置：宁可不管，也不误拦。
        let project = PathBuf::from("/work/qt6/app/app-ohos");
        let roots: Vec<&Path> = Vec::new();
        assert!(check_migration_write_scope(
            "Write",
            Some(&serde_json::json!({"payload": "+++ /anywhere/file.txt\nx"})),
            &QtMigrationWriteScope {
                workspace_root: None,
                project_dir: Some(&project),
                managed_roots: &roots,
            },
        )
        .is_ok());
        // 没有工程目录可量、工作区又直接挂在卷根时，工作区外不判（没有可用的"父目录"）。
        let volume_root = PathBuf::from("/proj");
        assert!(check_migration_write_scope(
            "Write",
            Some(&serde_json::json!({"payload": "+++ /elsewhere/file.txt\nx"})),
            &QtMigrationWriteScope {
                workspace_root: Some(&volume_root),
                project_dir: None,
                managed_roots: &roots,
            },
        )
        .is_ok());
        // 但工作区里照样只认工程目录。
        assert_eq!(
            check_migration_write_scope(
                "Write",
                Some(&serde_json::json!({"payload": "+++ /proj/build.log\nx"})),
                &QtMigrationWriteScope {
                    workspace_root: Some(&volume_root),
                    project_dir: None,
                    managed_roots: &roots,
                },
            )
            .expect_err("a workspace artifact must be rejected")
            .kind,
            "outside_project"
        );
        // 读类工具与 shell 命令不在这条规则里（shell 的目标路径运行时才知道）。
        let owned = PathBuf::from("/work/qt6/app");
        for (tool, input) in [
            ("Read", serde_json::json!({"file_path": "/work/qt6/app/build.log"})),
            ("ExecCommand", serde_json::json!({"cmd": "touch /work/qt6/app/build.log"})),
        ] {
            assert!(check_migration_write_scope(
                tool,
                Some(&input),
                &QtMigrationWriteScope {
                    workspace_root: Some(&owned),
                    project_dir: Some(&project),
                    managed_roots: &roots,
                },
            )
            .is_ok());
        }
    }

    #[test]
    fn a_session_without_the_latched_directory_still_owns_its_project_directory() {
        // 老会话的 intake 里没有固化目录：门禁必须按同一套推导认出工程目录，
        // 否则会把迁移挡在自己的工程目录之外。
        let policy = QtMigrationAdmissionPolicy;
        let reader = |intake: QtMigrationIntakeStateSnapshot| SlotReader {
            active: true,
            intake: Some(intake),
            workspace_root: Some("/work/qt6/app".to_string()),
        };
        let inside = ToolAdmissionRequest {
            tool_name: "Write",
            input: Some(
                &serde_json::json!({"payload": "+++ /work/qt6/app/myapp-ohos/entry/src/main.ets\nx"}),
            ),
            session_id: Some("session-1"),
        };
        assert!(policy
            .check(
                &inside,
                &reader(intake_with_paths("/work/qt6/app", "/work/qt6/app/myapp")),
            )
            .is_ok());
        let outside = ToolAdmissionRequest {
            tool_name: "Write",
            input: Some(&serde_json::json!({"payload": "+++ /work/qt6/app/build.log\nx"})),
            session_id: Some("session-1"),
        };
        assert_eq!(
            policy
                .check(
                    &outside,
                    &reader(intake_with_paths("/work/qt6/app", "/work/qt6/app/myapp")),
                )
                .expect_err("a workspace-root artifact must be rejected")
                .kind,
            "outside_project"
        );
    }

    #[test]
    fn policy_rejects_a_write_at_the_workspace_root_through_slots() {
        let policy = QtMigrationAdmissionPolicy;
        let admission = ToolAdmissionRequest {
            tool_name: "Write",
            input: Some(&serde_json::json!({"payload": "+++ /work/qt6/app/build.log\nx"})),
            session_id: Some("session-1"),
        };
        let rejection = policy
            .check(
                &admission,
                &SlotReader {
                    active: true,
                    intake: Some(bound_intake("/work/qt6/app/app-ohos")),
                    workspace_root: Some("/work/qt6/app".to_string()),
                },
            )
            .expect_err("a workspace-root artifact must be rejected while the migration runs");
        assert_eq!(rejection.code, REJECT_CODE_WRITE_SCOPE);
        assert_eq!(rejection.kind, "outside_project");

        // 同一会话里写在工程目录内则照常放行。
        let allowed = ToolAdmissionRequest {
            tool_name: "Write",
            input: Some(
                &serde_json::json!({"payload": "+++ /work/qt6/app/app-ohos/entry/src/main.ets\nx"}),
            ),
            session_id: Some("session-1"),
        };
        assert!(policy
            .check(
                &allowed,
                &SlotReader {
                    active: true,
                    intake: Some(bound_intake("/work/qt6/app/app-ohos")),
                    workspace_root: Some("/work/qt6/app".to_string()),
                },
            )
            .is_ok());
    }
}
