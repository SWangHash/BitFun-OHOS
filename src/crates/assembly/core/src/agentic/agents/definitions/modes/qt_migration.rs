//! Qt Migration Mode
//!
//! A vertical-domain primary mode that owns the full Qt -> HarmonyOS
//! migration workflow: assess, migrate, build, deploy, verify, and close the
//! issue-fix loop. It uses the shared coding toolset (including Task so it can
//! dispatch helper subagents) with its own dedicated prompt template.

use crate::agentic::agents::{
    standard_harness_tools, standard_harness_user_context_policy, Agent, UserContextPolicy,
};
use async_trait::async_trait;

pub struct QtMigrationMode {
    default_tools: Vec<String>,
}

impl Default for QtMigrationMode {
    fn default() -> Self {
        Self::new()
    }
}

impl QtMigrationMode {
    pub fn new() -> Self {
        let mut default_tools = standard_harness_tools();
        // Intake routing tool: decides whether a request needs the migration
        // path confirmation dialog. QtMigration-specific, not in the shared set.
        default_tools.push("QtMigrationIntake".to_string());
        Self { default_tools }
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
        standard_harness_user_context_policy()
    }

    fn default_tools(&self) -> Vec<String> {
        self.default_tools.clone()
    }

    fn is_readonly(&self) -> bool {
        false
    }
}
