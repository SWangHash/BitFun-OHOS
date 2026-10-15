//! Generic tool-admission dispatch and the session-bound domain state store.
//!
//! Domain crates own admission policies and their registries; this module
//! wires them into the runtime. Registries and the state store travel through
//! `ToolUseContext.runtime_handles`; a missing one means "do not gate".

use std::sync::Arc;

use bitfun_qt_migration::admission::{
    QtMigrationAdmissionPolicy, QT_MIGRATION_SLOT_ACTIVE, QT_MIGRATION_SLOT_INTAKE_STATE,
    QT_MIGRATION_SLOT_SKILL_DIR, QT_MIGRATION_SLOT_TEMPLATES_DIR, QT_MIGRATION_SLOT_TOOLCHAINS_DIR,
};
use bitfun_qt_migration::instructions::QtMigrationTurnInstructions;
use bitfun_qt_migration::question_card::QtMigrationQuestionCard;
use bitfun_qt_migration::semantic::QtMigrationIntentAnalyzer;
use bitfun_qt_migration::skill_receipt::QtMigrationSkillReceipt;
use bitfun_runtime_ports::{
    DomainStateReader, DomainStateSlot, DomainStateWriter, IntentAnalysisRegistry,
    QuestionTemplateRegistry, SkillReceiptRegistry, ToolAdmissionRegistry, ToolAdmissionRequest,
    TurnInstructionRegistry,
};
use serde_json::Value;

use super::framework::ToolUseContext;
use crate::agentic::session::SessionManager;
use crate::util::errors::{BitFunError, BitFunResult};

/// Slots that persist into session metadata and participate in restore and
/// fork replication; the order fixes the restore and fork-copy order.
pub(crate) fn session_persisted_domain_state_slots() -> &'static [DomainStateSlot] {
    &[QT_MIGRATION_SLOT_INTAKE_STATE, QT_MIGRATION_SLOT_ACTIVE]
}

/// Generic admission check consulted by every dispatch path. Sessions without
/// a registry or state store are never gated; otherwise every registered
/// policy decides in registration order and the first rejection wins.
pub fn check_admission(
    tool_name: &str,
    input: Option<&Value>,
    context: &ToolUseContext,
) -> BitFunResult<()> {
    let Some(session_id) = context.session_id.as_deref() else {
        return Ok(());
    };
    let Some(registry) = context
        .runtime_handles
        .admission_registry()
        .filter(|registry| !registry.is_empty())
    else {
        return Ok(());
    };
    let Some(reader) = context.runtime_handles.domain_state_reader() else {
        return Ok(());
    };
    let request = ToolAdmissionRequest {
        tool_name,
        input,
        session_id: Some(session_id),
    };
    registry
        .check_all(&request, reader.as_ref())
        .map_err(|rejection| BitFunError::tool(rejection.to_message()))
}

/// Session-bound store over the domain state slots, riding in
/// `ToolRuntimeHandles` so domain policies never touch the session manager or
/// the path manager directly. Persisted slots read/write through session
/// metadata; host-resource slots resolve live and are read-only.
pub struct SessionDomainStateStore {
    session_manager: Arc<SessionManager>,
    session_id: String,
}

impl SessionDomainStateStore {
    pub fn new(session_manager: Arc<SessionManager>, session_id: String) -> Self {
        Self {
            session_manager,
            session_id,
        }
    }
}

impl std::fmt::Debug for SessionDomainStateStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SessionDomainStateStore")
            .field("session_id", &self.session_id)
            .finish_non_exhaustive()
    }
}

impl DomainStateReader for SessionDomainStateStore {
    fn get(&self, slot: &DomainStateSlot) -> Option<Value> {
        if slot == &QT_MIGRATION_SLOT_TOOLCHAINS_DIR {
            return Some(Value::String(
                crate::infrastructure::get_path_manager_arc()
                    .qt_migration_toolchains_dir()
                    .to_string_lossy()
                    .into_owned(),
            ));
        }
        if slot == &QT_MIGRATION_SLOT_TEMPLATES_DIR {
            return Some(Value::String(
                crate::infrastructure::get_path_manager_arc()
                    .qt_migration_templates_dir()
                    .to_string_lossy()
                    .into_owned(),
            ));
        }
        if slot == &QT_MIGRATION_SLOT_SKILL_DIR {
            // The installed managed skill bundle: it owns the BitFun acquisition
            // scripts the `__official__` guidance hands to the model.
            return Some(Value::String(
                crate::infrastructure::get_path_manager_arc()
                    .builtin_skills_dir()
                    .join(bitfun_qt_migration::state::QT_MIGRATION_SKILL_DIR)
                    .to_string_lossy()
                    .into_owned(),
            ));
        }
        self.session_manager
            .domain_state_get(&self.session_id, slot)
    }
}

impl DomainStateWriter for SessionDomainStateStore {
    fn set(&self, slot: &DomainStateSlot, value: Value) {
        if !session_persisted_domain_state_slots().contains(slot) {
            log::warn!(
                "Rejected a write to a non-persisted domain state slot: session_id={}, slot={}",
                self.session_id,
                slot.key
            );
            return;
        }
        self.session_manager
            .domain_state_set_deferred(&self.session_id, slot, value);
    }
}

/// Assemble the tool admission registry consulted by every dispatch path.
/// Called once per runtime owner at construction time; the registry is
/// read-only afterwards.
pub(crate) fn assemble_admission_registry() -> ToolAdmissionRegistry {
    let mut registry = ToolAdmissionRegistry::default();
    registry.register(Arc::new(QtMigrationAdmissionPolicy));
    registry
}

/// Assemble the turn-instruction registry spliced by the execution engine at
/// turn start. Called once per engine construction; the registry is read-only
/// afterwards.
pub(crate) fn assemble_turn_instruction_registry() -> TurnInstructionRegistry {
    let mut registry = TurnInstructionRegistry::default();
    registry.register(Arc::new(QtMigrationTurnInstructions));
    registry
}

/// Assemble the question-template registry the `AskUserQuestion` tool and the
/// coordinator dispatch through. Static product content with no per-session
/// state, so construction is cheap even on per-call restore paths.
pub(crate) fn assemble_question_template_registry() -> QuestionTemplateRegistry {
    let mut registry = QuestionTemplateRegistry::default();
    registry.register(Arc::new(QtMigrationQuestionCard));
    registry
}

/// Assemble the skill-receipt registry the Skill tool dispatches through on
/// every loaded skill. Contributions decide qualification themselves; the
/// dispatch order is registration order.
pub(crate) fn assemble_skill_receipt_registry() -> SkillReceiptRegistry {
    let mut registry = SkillReceiptRegistry::default();
    registry.register(Arc::new(QtMigrationSkillReceipt));
    registry
}

/// Assemble the intent-analysis registry the turn-intent orchestrator looks
/// contributions up in by agent type. Static product content with no
/// per-session state, so construction is cheap even on per-call turn paths.
pub(crate) fn assemble_intent_analysis_registry() -> IntentAnalysisRegistry {
    let mut registry = IntentAnalysisRegistry::default();
    registry.register(Arc::new(QtMigrationIntentAnalyzer));
    registry
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitfun_qt_migration::admission::QT_MIGRATION_STATE_NAMESPACE;

    #[test]
    fn assembled_admission_registry_carries_the_qt_migration_policy() {
        let registry = assemble_admission_registry();
        assert!(!registry.is_empty());
    }

    #[test]
    fn assembled_turn_instruction_registry_carries_the_qt_migration_contribution() {
        let registry = assemble_turn_instruction_registry();
        assert!(!registry.is_empty());
        let namespaces: Vec<_> = registry.iter().map(|c| c.namespace()).collect();
        assert_eq!(namespaces, vec!["qt_migration"]);
    }

    #[test]
    fn assembled_question_template_registry_carries_the_qt_migration_card() {
        let registry = assemble_question_template_registry();
        assert!(!registry.is_empty());
        let card = registry
            .get("qt-migration-paths")
            .expect("the qt-migration-paths template is registered");
        assert_eq!(card.template_version(), "1");
        assert_eq!(
            card.state_slot(),
            QT_MIGRATION_SLOT_INTAKE_STATE,
            "the card persists into the intake state slot"
        );
        assert!(registry.get("unknown-template").is_none());
    }

    #[test]
    fn assembled_skill_receipt_registry_carries_the_qt_migration_receipt() {
        let registry = assemble_skill_receipt_registry();
        assert!(!registry.is_empty());
    }

    #[test]
    fn assembled_intent_analysis_registry_looks_up_by_qt_migration_agent_type() {
        let registry = assemble_intent_analysis_registry();
        assert!(!registry.is_empty());
        assert!(registry.get("QtMigration").is_some());
        assert!(registry.get("Standard").is_none());
    }

    #[test]
    fn persisted_slot_list_names_both_qt_migration_slots() {
        let slots = session_persisted_domain_state_slots();
        assert!(slots.contains(&QT_MIGRATION_SLOT_INTAKE_STATE));
        assert!(slots.contains(&QT_MIGRATION_SLOT_ACTIVE));
        assert!(slots
            .iter()
            .all(|slot| slot.namespace == QT_MIGRATION_STATE_NAMESPACE));
    }
}
