//! Source preflight and user-selected repair for HarmonyOS phone applications.
use crate::agentic::agents::{shared_coding_mode_user_context_policy, Agent, UserContextPolicy};
use async_trait::async_trait;

pub struct HarmonyReleaseAuditMode;

#[async_trait]
impl Agent for HarmonyReleaseAuditMode {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
    fn id(&self) -> &str {
        "HarmonyReleaseAudit"
    }
    fn name(&self) -> &str {
        "HarmonyOS App Release Preflight Expert"
    }
    fn description(&self) -> &str {
        "Review HarmonyOS apps against pre-release submission rules, identify potential risks, and provide remediation guidance with optional fixes and rechecks."
    }
    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "harmony_release_audit_agent"
    }
    fn user_context_policy(&self) -> UserContextPolicy {
        shared_coding_mode_user_context_policy()
    }
    fn default_tools(&self) -> Vec<String> {
        [
            "Read",
            "Write",
            "Edit",
            "ExecCommand",
            "WriteStdin",
            "ExecControl",
            "Grep",
            "Glob",
            "TodoWrite",
            "Skill",
            "AskUserQuestion",
        ]
        .into_iter()
        .map(str::to_string)
        .collect()
    }
    fn is_readonly(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn release_audit_supports_the_source_review_and_repair_workflow() {
        let agent = HarmonyReleaseAuditMode;
        let tools = agent.default_tools();
        for tool in [
            "Read",
            "Write",
            "Edit",
            "ExecCommand",
            "Skill",
            "AskUserQuestion",
        ] {
            assert!(tools.iter().any(|name| name == tool));
        }
        assert!(!agent.is_readonly());
        assert!(
            crate::agentic::agents::get_embedded_prompt(agent.prompt_template_name(None)).is_some()
        );
        // Source preflight needs neither deployment nor publishing capabilities.
        for tool in ["start_app", "verify_ui", "PagePublish", "ReviewPlatform"] {
            assert!(!tools.iter().any(|name| name == tool));
        }
    }
}
