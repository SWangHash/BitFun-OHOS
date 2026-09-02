//! Qt Migration Mode
//!
//! A vertical-domain primary mode that owns the full Qt -> HarmonyOS
//! migration workflow: assess, migrate, build, deploy, verify, and close the
//! issue-fix loop. It uses the shared coding toolset (including Task so it can
//! dispatch helper subagents) with its own dedicated prompt template.

use crate::agentic::agents::{
    shared_coding_mode_tool_exposure_overrides, shared_coding_mode_tools,
    shared_coding_mode_user_context_policy, Agent, AgentToolPolicyOverrides, UserContextPolicy,
};
use async_trait::async_trait;

pub struct QtMigrationMode {
    default_tools: Vec<String>,
    tool_exposure_overrides: AgentToolPolicyOverrides,
}

impl Default for QtMigrationMode {
    fn default() -> Self {
        Self::new()
    }
}

impl QtMigrationMode {
    pub fn new() -> Self {
        let mut default_tools = shared_coding_mode_tools();
        // Intake routing tool: decides whether a request needs the migration
        // path confirmation dialog. QtMigration-specific, not in the shared set.
        default_tools.push("AnalyzeMigrationRequest".to_string());
        Self {
            default_tools,
            tool_exposure_overrides: shared_coding_mode_tool_exposure_overrides(),
        }
    }
}

#[async_trait]
impl Agent for QtMigrationMode {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "QtMigration"
    }

    fn name(&self) -> &str {
        "QT Migration Expert"
    }

    fn description(&self) -> &str {
        r#"Qt 5.12/5.15 to HarmonyOS migration specialist: assess the existing Qt project, migrate source and build scripts to HarmonyOS, build, deploy, verify, and close the issue-fix loop with visualized task progress."#
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "qt_migration_agent"
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
