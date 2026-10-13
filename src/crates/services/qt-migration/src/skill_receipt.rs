//! The Qt migration skill-load receipt as a [`SkillReceiptContribution`].
//!
//! Only the managed built-in `ohos-qt-skills` loaded from the `.system` source
//! qualifies; other skills or name collisions produce no receipt. The receipt
//! is attached to an existing intake only — if no intake exists yet the
//! session is not an active migration, so there is nothing to attach the
//! receipt to.

use bitfun_runtime_ports::{DomainStateWriter, LoadedSkillFact, SkillReceiptContribution};

use crate::admission::QT_MIGRATION_SLOT_INTAKE_STATE;
use crate::state::{
    intake_snapshot_from_slot_value, intake_snapshot_to_slot_value, QtMigrationIntakeStatus,
    QtMigrationLoadedSkillReceipt, MANAGED_SKILL_SOURCE_SLOT, QT_MIGRATION_SKILL_DIR,
};

/// Skill-load receipt contribution for the Qt migration intake.
pub struct QtMigrationSkillReceipt;

impl SkillReceiptContribution for QtMigrationSkillReceipt {
    fn matches(&self, loaded: &LoadedSkillFact<'_>) -> bool {
        let matched = loaded.dir_name == QT_MIGRATION_SKILL_DIR
            && loaded.source_slot == MANAGED_SKILL_SOURCE_SLOT;
        if !matched && loaded.dir_name == QT_MIGRATION_SKILL_DIR {
            // A same-name load from a non-managed source produces no receipt
            // and the intake gate stays closed. Every decline used to be
            // silent, which hid this state behind log archaeology; say why.
            log::warn!(
                "Qt migration skill loaded from a non-managed source; no receipt recorded: source_slot={}, skill_key={}",
                loaded.source_slot,
                loaded.skill_key
            );
        }
        matched
    }

    fn on_skill_loaded(&self, loaded: &LoadedSkillFact<'_>, state: &dyn DomainStateWriter) {
        // Receipt is intake-driven (not agent_type), matching the gate: a
        // subagent that inherited an activated intake may reload the skill and
        // refresh its receipt even when its own agent_type is not QtMigration.
        // A session without an activated intake is not a migration.
        let Some(current) = state.get(&QT_MIGRATION_SLOT_INTAKE_STATE) else {
            return;
        };
        let mut snapshot = intake_snapshot_from_slot_value(Some(current));
        if snapshot.status == QtMigrationIntakeStatus::NotApplicable {
            return;
        }
        snapshot.loaded_skill_receipt = Some(QtMigrationLoadedSkillReceipt {
            skill_key: loaded.skill_key.to_string(),
            source_slot: loaded.source_slot.to_string(),
            dir_name: loaded.dir_name.to_string(),
            content_hash: loaded.content_hash.to_string(),
        });
        state.set(
            &QT_MIGRATION_SLOT_INTAKE_STATE,
            intake_snapshot_to_slot_value(&snapshot),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitfun_runtime_ports::{DomainStateReader, DomainStateSlot};
    use serde_json::{json, Value};
    use std::sync::Mutex;

    /// In-memory slot store recording every write, standing in for the host
    /// session store.
    #[derive(Debug, Default)]
    struct MemoryStore {
        slots: Mutex<Vec<(DomainStateSlot, Option<Value>)>>,
    }

    impl DomainStateReader for MemoryStore {
        fn get(&self, slot: &DomainStateSlot) -> Option<Value> {
            self.slots
                .lock()
                .expect("store lock")
                .iter()
                .find(|(stored, _)| stored == slot)
                .and_then(|(_, value)| value.clone())
        }
    }

    impl DomainStateWriter for MemoryStore {
        fn set(&self, slot: &DomainStateSlot, value: Value) {
            let mut slots = self.slots.lock().expect("store lock");
            match slots.iter_mut().find(|(stored, _)| stored == slot) {
                Some(entry) => entry.1 = Some(value),
                None => slots.push((*slot, Some(value))),
            }
        }
    }

    fn seeded_store(status: QtMigrationIntakeStatus) -> MemoryStore {
        let mut snapshot = crate::state::QtMigrationIntakeStateSnapshot::empty();
        snapshot.status = status;
        let store = MemoryStore::default();
        store.slots.lock().expect("store lock").push((
            QT_MIGRATION_SLOT_INTAKE_STATE,
            Some(intake_snapshot_to_slot_value(&snapshot)),
        ));
        store
    }

    fn loaded(dir_name: &str, source_slot: &str) -> LoadedSkillFact<'static> {
        LoadedSkillFact {
            skill_key: Box::leak(format!("{source_slot}::{dir_name}").into_boxed_str()),
            source_slot: Box::leak(source_slot.to_string().into_boxed_str()),
            dir_name: Box::leak(dir_name.to_string().into_boxed_str()),
            content_hash: "cafe",
        }
    }

    #[test]
    fn only_the_managed_qt_skill_from_the_system_slot_qualifies() {
        let receipt = QtMigrationSkillReceipt;
        assert!(receipt.matches(&loaded(QT_MIGRATION_SKILL_DIR, MANAGED_SKILL_SOURCE_SLOT)));
        assert!(
            !receipt.matches(&loaded("other-skill", MANAGED_SKILL_SOURCE_SLOT)),
            "other skills produce no receipt"
        );
        assert!(
            !receipt.matches(&loaded(QT_MIGRATION_SKILL_DIR, "user")),
            "a name collision from another source slot produces no receipt"
        );
    }

    #[test]
    fn receipt_attaches_to_an_existing_live_intake_only() {
        let receipt = QtMigrationSkillReceipt;

        // No intake slot at all: nothing to attach the receipt to.
        let empty = MemoryStore::default();
        receipt.on_skill_loaded(
            &loaded(QT_MIGRATION_SKILL_DIR, MANAGED_SKILL_SOURCE_SLOT),
            &empty,
        );
        assert!(
            empty.get(&QT_MIGRATION_SLOT_INTAKE_STATE).is_none(),
            "no intake must stay no intake"
        );

        // A session that is not an active migration: no receipt either.
        let not_applicable = seeded_store(QtMigrationIntakeStatus::NotApplicable);
        receipt.on_skill_loaded(
            &loaded(QT_MIGRATION_SKILL_DIR, MANAGED_SKILL_SOURCE_SLOT),
            &not_applicable,
        );
        let snapshot =
            intake_snapshot_from_slot_value(not_applicable.get(&QT_MIGRATION_SLOT_INTAKE_STATE));
        assert!(snapshot.loaded_skill_receipt.is_none());

        // A live intake records the receipt with the host-computed content hash.
        let live = seeded_store(QtMigrationIntakeStatus::NeedsInput);
        receipt.on_skill_loaded(
            &loaded(QT_MIGRATION_SKILL_DIR, MANAGED_SKILL_SOURCE_SLOT),
            &live,
        );
        let snapshot = intake_snapshot_from_slot_value(live.get(&QT_MIGRATION_SLOT_INTAKE_STATE));
        let recorded = snapshot
            .loaded_skill_receipt
            .expect("a live intake records the receipt");
        assert_eq!(recorded.dir_name, QT_MIGRATION_SKILL_DIR);
        assert_eq!(recorded.source_slot, MANAGED_SKILL_SOURCE_SLOT);
        assert_eq!(recorded.content_hash, "cafe");
    }

    #[test]
    fn the_recorded_receipt_round_trips_through_the_wire_shape() {
        let receipt_value = json!({
            "skill_key": "bitfun-system::ohos-qt-skills",
            "source_slot": MANAGED_SKILL_SOURCE_SLOT,
            "dir_name": QT_MIGRATION_SKILL_DIR,
            "content_hash": "cafe",
        });
        let receipt: QtMigrationLoadedSkillReceipt =
            serde_json::from_value(receipt_value).expect("receipt shape is stable");
        assert_eq!(receipt.content_hash, "cafe");
    }
}
