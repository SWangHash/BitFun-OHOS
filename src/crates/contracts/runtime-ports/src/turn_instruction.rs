//! Turn instruction contribution port.
//!
//! Domain crates contribute per-turn instruction texts and register them here;
//! the engine only splices contributions in registration order and holds no
//! domain instruction constants.

use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Arc;

use super::tool_admission::DomainStateReader;

/// Facts one turn-instruction contribution may inspect.
pub struct TurnInstructionContext<'a> {
    pub session_id: &'a str,
    pub dialog_turn_id: &'a str,
    pub agent_type: &'a str,
    pub original_user_input: &'a str,
    /// The host's per-turn context variables (string stash). Contributions
    /// read only their own namespaced keys.
    pub context_vars: &'a HashMap<String, String>,
    /// Read-only domain state slots; session-bound on the host side.
    pub state: &'a dyn DomainStateReader,
}

/// Instruction texts one contribution produces for one turn.
///
/// `activation` becomes its own user message prepended ahead of the turn;
/// `body` becomes one user message prepended ahead of the activation message
/// (matching the historical single-contributor splice order). Multiple
/// contributions follow registration order; no priority contract exists yet.
#[derive(Debug, Default)]
pub struct TurnInstructionTexts {
    pub activation: Option<Cow<'static, str>>,
    pub body: Option<Cow<'static, str>>,
}

pub trait TurnInstructionContribution: Send + Sync {
    fn namespace(&self) -> &'static str;
    /// Whether this contribution applies to the turn. The current behavior
    /// keeps agent_type-driven activation; unifying it with the admission
    /// gate's intake-driven determination is a separately confirmed behavior
    /// change and stays untouched here.
    fn is_active(&self, context: &TurnInstructionContext<'_>) -> bool;
    fn turn_instructions(&self, context: &TurnInstructionContext<'_>) -> TurnInstructionTexts;
}

/// Registry of turn-instruction contributions. Pure generic pipeline with no
/// behavior: assembly fills it at construction time and it is read-only
/// afterwards.
#[derive(Clone, Default)]
pub struct TurnInstructionRegistry {
    contributions: Vec<Arc<dyn TurnInstructionContribution>>,
}

impl TurnInstructionRegistry {
    pub fn register(&mut self, contribution: Arc<dyn TurnInstructionContribution>) {
        self.contributions.push(contribution);
    }

    /// Registration order; no snapshot or clone of the entries.
    pub fn iter(&self) -> impl Iterator<Item = &Arc<dyn TurnInstructionContribution>> {
        self.contributions.iter()
    }

    pub fn is_empty(&self) -> bool {
        self.contributions.is_empty()
    }
}

impl std::fmt::Debug for TurnInstructionRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TurnInstructionRegistry")
            .field("contribution_count", &self.contributions.len())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TextContribution {
        active: bool,
    }
    impl TurnInstructionContribution for TextContribution {
        fn namespace(&self) -> &'static str {
            "test"
        }
        fn is_active(&self, _context: &TurnInstructionContext<'_>) -> bool {
            self.active
        }
        fn turn_instructions(&self, _context: &TurnInstructionContext<'_>) -> TurnInstructionTexts {
            TurnInstructionTexts {
                activation: Some(Cow::Borrowed("activation")),
                body: Some(Cow::Borrowed("body")),
            }
        }
    }

    fn context<'a>(
        agent_type: &'a str,
        vars: &'a HashMap<String, String>,
        reader: &'a dyn DomainStateReader,
    ) -> TurnInstructionContext<'a> {
        TurnInstructionContext {
            session_id: "session-1",
            dialog_turn_id: "turn-1",
            agent_type,
            original_user_input: "hello",
            context_vars: vars,
            state: reader,
        }
    }

    #[test]
    fn registry_iterates_in_registration_order() {
        let mut registry = TurnInstructionRegistry::default();
        registry.register(Arc::new(TextContribution { active: true }));
        registry.register(Arc::new(TextContribution { active: false }));

        let namespaces: Vec<_> = registry.iter().map(|c| c.namespace()).collect();
        assert_eq!(namespaces, vec!["test", "test"]);
        assert!(!registry.is_empty());
    }

    #[test]
    fn activation_and_body_texts_are_independent() {
        let vars = HashMap::new();
        #[derive(Debug)]
        struct EmptyReader;
        impl DomainStateReader for EmptyReader {
            fn get(
                &self,
                _slot: &super::super::tool_admission::DomainStateSlot,
            ) -> Option<serde_json::Value> {
                None
            }
        }
        let reader = EmptyReader;
        let context = context("Standard", &vars, &reader);
        let contribution = TextContribution { active: false };
        assert!(!contribution.is_active(&context));
        let texts = contribution.turn_instructions(&context);
        assert_eq!(texts.activation.as_deref(), Some("activation"));
        assert_eq!(texts.body.as_deref(), Some("body"));
    }
}
