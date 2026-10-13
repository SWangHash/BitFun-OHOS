//! Skill-receipt contribution port.
//!
//! When the generic Skill tool loads a skill, registered contributions may
//! record a receipt into their own session domain state. The tool itself only
//! calls the registry; it knows nothing about which domains care.

use std::sync::Arc;

use super::tool_admission::DomainStateWriter;

/// Facts of one loaded skill, as observed by the generic Skill tool. The
/// content hash is host-computed so contributions need no hashing dependency.
#[derive(Debug, Clone, Copy)]
pub struct LoadedSkillFact<'a> {
    pub skill_key: &'a str,
    pub source_slot: &'a str,
    pub dir_name: &'a str,
    pub content_hash: &'a str,
}

/// Skill-load receipt contribution. Registered by product assembly; the
/// generic Skill tool only sees the registry.
pub trait SkillReceiptContribution: Send + Sync {
    /// Whether this contribution records a receipt for the loaded skill.
    fn matches(&self, loaded: &LoadedSkillFact<'_>) -> bool;
    /// Record the receipt. Attached to existing domain state only: a session
    /// without the contributor's state is not an active engagement, so there
    /// is nothing to attach the receipt to.
    fn on_skill_loaded(&self, loaded: &LoadedSkillFact<'_>, state: &dyn DomainStateWriter);
}

/// Registry of skill-receipt contributions. Assembly fills it at construction
/// time; dispatch is read-only afterwards.
#[derive(Default)]
pub struct SkillReceiptRegistry {
    contributions: Vec<Arc<dyn SkillReceiptContribution>>,
}

impl SkillReceiptRegistry {
    pub fn register(&mut self, contribution: Arc<dyn SkillReceiptContribution>) {
        self.contributions.push(contribution);
    }

    pub fn is_empty(&self) -> bool {
        self.contributions.is_empty()
    }

    /// Dispatch the load receipt to every matching contribution in
    /// registration order. A missing writer means "nothing to record into".
    pub fn on_skill_loaded(&self, loaded: &LoadedSkillFact<'_>, state: &dyn DomainStateWriter) {
        for contribution in &self.contributions {
            if contribution.matches(loaded) {
                contribution.on_skill_loaded(loaded, state);
            }
        }
    }
}

impl std::fmt::Debug for SkillReceiptRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SkillReceiptRegistry")
            .field("contribution_count", &self.contributions.len())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool_admission::{DomainStateReader, DomainStateSlot};
    use serde_json::Value;
    use std::sync::Mutex;

    #[derive(Debug, Default)]
    struct RecordingWriter {
        writes: Mutex<Vec<(String, String, Value)>>,
    }

    impl DomainStateReader for RecordingWriter {
        fn get(&self, _slot: &DomainStateSlot) -> Option<Value> {
            None
        }
    }

    impl DomainStateWriter for RecordingWriter {
        fn set(&self, slot: &DomainStateSlot, value: Value) {
            self.writes.lock().expect("writer lock").push((
                slot.namespace.to_string(),
                slot.key.to_string(),
                value,
            ));
        }
    }

    struct MatchingReceipt;

    impl SkillReceiptContribution for MatchingReceipt {
        fn matches(&self, loaded: &LoadedSkillFact<'_>) -> bool {
            loaded.dir_name == "managed-skill"
        }

        fn on_skill_loaded(&self, loaded: &LoadedSkillFact<'_>, state: &dyn DomainStateWriter) {
            state.set(
                &DomainStateSlot {
                    namespace: "stub",
                    key: "receipts",
                },
                serde_json::json!({ "key": loaded.skill_key }),
            );
        }
    }

    #[test]
    fn registry_dispatches_only_to_matching_contributions() {
        let mut registry = SkillReceiptRegistry::default();
        assert!(registry.is_empty());
        registry.register(Arc::new(MatchingReceipt));

        let writer = RecordingWriter::default();
        registry.on_skill_loaded(
            &LoadedSkillFact {
                skill_key: "managed-skill::a",
                source_slot: "bitfun-system",
                dir_name: "managed-skill",
                content_hash: "cafe",
            },
            &writer,
        );
        registry.on_skill_loaded(
            &LoadedSkillFact {
                skill_key: "other::b",
                source_slot: "user",
                dir_name: "other-skill",
                content_hash: "beef",
            },
            &writer,
        );

        let writes = writer.writes.lock().expect("writer lock");
        assert_eq!(writes.len(), 1, "only the matching load records a receipt");
        assert_eq!(writes[0].0, "stub");
        assert_eq!(writes[0].1, "receipts");
        assert_eq!(writes[0].2["key"], "managed-skill::a");
    }
}
