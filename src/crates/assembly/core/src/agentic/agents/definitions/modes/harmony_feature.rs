//! HarmonyOS Feature Enhancement Mode
//!
//! A vertical-domain primary mode for matching, planning, and implementing
//! HarmonyOS platform feature enhancements with the bundled feature guide skill.

use crate::agentic::agents::{
    shared_coding_mode_tool_exposure_overrides, shared_coding_mode_tools,
    shared_coding_mode_user_context_policy, Agent, AgentToolPolicyOverrides, UserContextPolicy,
};
use async_trait::async_trait;

pub struct HarmonyFeatureMode {
    default_tools: Vec<String>,
    tool_exposure_overrides: AgentToolPolicyOverrides,
}

impl Default for HarmonyFeatureMode {
    fn default() -> Self {
        Self::new()
    }
}

impl HarmonyFeatureMode {
    pub fn new() -> Self {
        Self {
            default_tools: shared_coding_mode_tools(),
            tool_exposure_overrides: shared_coding_mode_tool_exposure_overrides(),
        }
    }
}

#[async_trait]
impl Agent for HarmonyFeatureMode {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "HarmonyFeature"
    }

    fn name(&self) -> &str {
        "HarmonyOS Feature Enhancement Expert"
    }

    fn description(&self) -> &str {
        r#"HarmonyOS feature enhancement specialist: match user goals to HarmonyOS innovative features, Kits, and 2C categories, then plan and implement the selected platform capability with official-guide-first evidence."#
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "harmony_feature_agent"
    }

    fn user_context_policy(&self) -> UserContextPolicy {
        shared_coding_mode_user_context_policy()
    }

    fn tool_exposure_overrides(&self) -> &AgentToolPolicyOverrides {
        &self.tool_exposure_overrides
    }

    fn default_tools(&self) -> Vec<String> {
        self.default_tools.clone()
    }

    fn is_readonly(&self) -> bool {
        false
    }
}
