//! Intent-analysis contribution port.
//!
//! A product domain may classify a turn's prompt with an LLM-backed analyzer.
//! The domain owns the schema, the prompts, and the output validation; the
//! host owns the one structured model call and the per-turn cache, and only
//! sees this port.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde_json::Value;

use super::tool_admission::DomainStateReader;

/// Typed projection of one intent analysis. `value` keeps the contribution's
/// full decision JSON (its stable stash contract, e.g. prompt-resolved paths
/// seeded into candidate lists); the remaining fields are the projections the
/// host turn flow reads without navigating domain JSON.
#[derive(Debug, Clone, PartialEq)]
pub struct TurnIntentDecision {
    /// Full decision JSON in the contribution's own shape.
    pub value: Value,
    /// Whether this turn should run the contribution's domain flow.
    pub flow_enabled: bool,
    /// Prompt-resolved paths object (the `resolvedPaths` shape of `value`).
    pub resolved_paths: Value,
    /// Per-field resolution state: field name -> `missing`|`referenced`|`resolved`.
    pub field_states: BTreeMap<String, String>,
    /// Paths that appeared in the prompt but were not auto-classified.
    pub unclassified_paths: Vec<String>,
}

/// Intent-analysis contribution. Registered by product assembly; the host
/// orchestrator looks contributions up by agent type.
pub trait IntentAnalysisContribution: Send + Sync {
    /// The agent type whose turns this contribution analyzes.
    fn agent_type(&self) -> &'static str;
    /// Cheap keyword pre-filter: `false` means the deterministic fallback can
    /// answer without a model call.
    fn has_task_signal(&self, prompt: &str) -> bool;
    /// Domain summary of the session's migration context, read through the
    /// generic domain-state reader. Participates in the host's cache key.
    fn context_summary(&self, state: &dyn DomainStateReader) -> Option<String>;
    /// System prompt for the structured model call.
    fn system_prompt(&self) -> String;
    /// User prompt for the structured model call, assembled from the raw
    /// prompt and the context summary.
    fn user_prompt(&self, prompt: &str, context_summary: Option<&str>) -> String;
    /// JSON Schema for the model call's structured output. `None` keeps the
    /// call plain-text.
    fn output_schema(&self) -> Option<Value>;
    /// Validate one model output into a decision. `None` means the output is
    /// not a usable analysis and the caller falls back.
    fn build_decision(&self, output: &str) -> Option<TurnIntentDecision>;
    /// Deterministic decision used when the pre-filter rejects or the model
    /// call fails.
    fn fallback_decision(&self, prompt: &str) -> TurnIntentDecision;
}

/// Registry of intent-analysis contributions keyed by agent type. Assembly
/// fills it at construction time; lookups are read-only afterwards.
#[derive(Default)]
pub struct IntentAnalysisRegistry {
    contributions: Vec<Arc<dyn IntentAnalysisContribution>>,
}

impl IntentAnalysisRegistry {
    pub fn register(&mut self, contribution: Arc<dyn IntentAnalysisContribution>) {
        self.contributions.push(contribution);
    }

    pub fn is_empty(&self) -> bool {
        self.contributions.is_empty()
    }

    pub fn get(&self, agent_type: &str) -> Option<Arc<dyn IntentAnalysisContribution>> {
        self.contributions
            .iter()
            .find(|contribution| contribution.agent_type() == agent_type)
            .cloned()
    }

    pub fn iter(&self) -> impl Iterator<Item = &Arc<dyn IntentAnalysisContribution>> {
        self.contributions.iter()
    }
}

impl std::fmt::Debug for IntentAnalysisRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IntentAnalysisRegistry")
            .field("contribution_count", &self.contributions.len())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool_admission::{DomainStateSlot, DomainStateWriter};

    struct StubAnalyzer;

    impl IntentAnalysisContribution for StubAnalyzer {
        fn agent_type(&self) -> &'static str {
            "StubAgent"
        }

        fn has_task_signal(&self, prompt: &str) -> bool {
            prompt.contains("go")
        }

        fn context_summary(&self, _state: &dyn DomainStateReader) -> Option<String> {
            None
        }

        fn system_prompt(&self) -> String {
            "analyze".to_string()
        }

        fn user_prompt(&self, prompt: &str, _context_summary: Option<&str>) -> String {
            prompt.to_string()
        }

        fn output_schema(&self) -> Option<Value> {
            None
        }

        fn build_decision(&self, output: &str) -> Option<TurnIntentDecision> {
            Some(TurnIntentDecision {
                value: serde_json::json!({ "taskType": output }),
                flow_enabled: output == "go",
                resolved_paths: serde_json::Value::Null,
                field_states: BTreeMap::new(),
                unclassified_paths: Vec::new(),
            })
        }

        fn fallback_decision(&self, _prompt: &str) -> TurnIntentDecision {
            TurnIntentDecision {
                value: serde_json::json!({ "taskType": "fallback" }),
                flow_enabled: false,
                resolved_paths: serde_json::Value::Null,
                field_states: BTreeMap::new(),
                unclassified_paths: Vec::new(),
            }
        }
    }

    #[derive(Debug, Default)]
    struct NullWriter;

    impl DomainStateReader for NullWriter {
        fn get(&self, _slot: &DomainStateSlot) -> Option<Value> {
            None
        }
    }

    impl DomainStateWriter for NullWriter {
        fn set(&self, _slot: &DomainStateSlot, _value: Value) {}
    }

    #[test]
    fn registry_looks_contributions_up_by_agent_type() {
        let mut registry = IntentAnalysisRegistry::default();
        assert!(registry.is_empty());
        registry.register(Arc::new(StubAnalyzer));

        assert!(registry.get("OtherAgent").is_none());
        let contribution = registry.get("StubAgent").expect("stub registered");
        assert_eq!(contribution.agent_type(), "StubAgent");
        assert_eq!(registry.iter().count(), 1);
    }

    #[test]
    fn decision_projection_carries_value_and_flow_flag() {
        let mut registry = IntentAnalysisRegistry::default();
        registry.register(Arc::new(StubAnalyzer));
        let contribution = registry.get("StubAgent").expect("stub registered");

        let decision = contribution.build_decision("go").expect("usable output");
        assert!(decision.flow_enabled);
        assert_eq!(decision.value["taskType"], "go");

        let fallback = contribution.fallback_decision("anything");
        assert!(!fallback.flow_enabled);
        assert_eq!(fallback.value["taskType"], "fallback");
    }
}
