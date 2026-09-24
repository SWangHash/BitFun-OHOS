use crate::agentic::agents::{Agent, AgentToolPolicyOverrides, UserContextPolicy};
use crate::agentic::tools::framework::ToolExposure;
use async_trait::async_trait;
use bitfun_runtime_ports::{PermissionConstraintLayer, PermissionEffect, PermissionRule};

const READ_TOOLS: &[&str] = &["Read", "Glob", "Grep", "LS"];
const IMPLEMENTATION_TOOLS: &[&str] = &[
    "Read",
    "Glob",
    "Grep",
    "LS",
    "Write",
    "Edit",
    "Delete",
    "ExecCommand",
    "WriteStdin",
    "ExecControl",
    "Task",
    "AgentWait",
    "TodoWrite",
    "Skill",
    "AskUserQuestion",
];
const VERIFY_TOOLS: &[&str] = &[
    "Read",
    "Glob",
    "Grep",
    "LS",
    "build_project",
    "start_app",
    "hdc_log",
    "arkts_knowledge_search",
    "arkts_check",
    "check_cpp_files",
    "verify_ui",
    "get_ui_verification_log",
    "save_ui_screenshot",
    "AskUserQuestion",
];

fn deny(action: &str, resource: &str) -> PermissionRule {
    PermissionRule::new(action, resource, PermissionEffect::Deny)
}

fn deny_layer(rules: Vec<PermissionRule>) -> PermissionConstraintLayer {
    PermissionConstraintLayer::new(rules)
}

fn readonly_harmony_constraints() -> PermissionConstraintLayer {
    deny_layer(vec![
        deny("edit", "*"),
        deny("bash", "*"),
        deny("custom_tool", "build_project"),
        deny("custom_tool", "start_app"),
        deny("custom_tool", "hdc_log"),
        deny("custom_tool", "verify_ui"),
    ])
}

fn implementation_constraints() -> PermissionConstraintLayer {
    deny_layer(vec![
        deny("custom_tool", "build_project"),
        deny("custom_tool", "start_app"),
        deny("custom_tool", "hdc_log"),
        deny("custom_tool", "verify_ui"),
        deny("custom_tool", "save_ui_screenshot"),
    ])
}

fn verification_constraints() -> PermissionConstraintLayer {
    deny_layer(vec![deny("edit", "*"), deny("bash", "*")])
}

pub struct HarmonyPlanAgent {
    tools: Vec<String>,
    overrides: AgentToolPolicyOverrides,
    permissions: PermissionConstraintLayer,
}

impl HarmonyPlanAgent {
    pub fn new() -> Self {
        let mut overrides = AgentToolPolicyOverrides::default();
        overrides.insert("CreatePlan".to_string(), ToolExposure::Direct);
        Self {
            tools: [READ_TOOLS, &["CreatePlan"]]
                .concat()
                .iter()
                .map(|tool| (*tool).to_string())
                .collect(),
            overrides,
            permissions: readonly_harmony_constraints(),
        }
    }
}

impl Default for HarmonyPlanAgent {
    fn default() -> Self {
        Self::new()
    }
}

pub struct HarmonyAgent {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    prompt: &'static str,
    tools: Vec<String>,
    readonly: bool,
    permissions: PermissionConstraintLayer,
}

impl HarmonyAgent {
    fn new(
        id: &'static str,
        name: &'static str,
        description: &'static str,
        prompt: &'static str,
        tools: &[&str],
        readonly: bool,
    ) -> Self {
        Self {
            id,
            name,
            description,
            prompt,
            tools: tools.iter().map(|tool| (*tool).to_string()).collect(),
            readonly,
            permissions: PermissionConstraintLayer::default(),
        }
    }
}

#[async_trait]
impl Agent for HarmonyPlanAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
    fn id(&self) -> &str {
        "HarmonyPlan"
    }
    fn name(&self) -> &str {
        "Harmony Plan"
    }
    fn description(&self) -> &str {
        "Read-only HarmonyOS planning and project analysis specialist"
    }
    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "harmony_plan_agent"
    }
    fn default_tools(&self) -> Vec<String> {
        self.tools.clone()
    }
    fn tool_exposure_overrides(&self) -> &AgentToolPolicyOverrides {
        &self.overrides
    }
    fn permission_constraints(&self) -> &PermissionConstraintLayer {
        &self.permissions
    }
    fn user_context_policy(&self) -> UserContextPolicy {
        UserContextPolicy::empty()
            .with_workspace_context()
            .with_workspace_instructions()
            .with_project_layout()
    }
    fn is_readonly(&self) -> bool {
        true
    }
}

#[async_trait]
impl Agent for HarmonyAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
    fn id(&self) -> &str {
        self.id
    }
    fn name(&self) -> &str {
        self.name
    }
    fn description(&self) -> &str {
        self.description
    }
    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        self.prompt
    }
    fn default_tools(&self) -> Vec<String> {
        self.tools.clone()
    }
    fn user_context_policy(&self) -> UserContextPolicy {
        UserContextPolicy::empty()
            .with_workspace_context()
            .with_workspace_instructions()
            .with_project_layout()
    }
    fn permission_constraints(&self) -> &PermissionConstraintLayer {
        &self.permissions
    }
    fn is_readonly(&self) -> bool {
        self.readonly
    }
}

pub fn harmony_goal_agent() -> HarmonyAgent {
    HarmonyAgent::new(
        "HarmonyGoal",
        "Harmony Goal",
        "Goal-driven HarmonyOS orchestration subagent",
        "harmony_goal_agent",
        &[
            "Task",
            "AgentWait",
            "TodoWrite",
            "get_goal",
            "create_goal",
            "update_goal",
            "AskUserQuestion",
            "Read",
            "Glob",
            "Grep",
            "LS",
            "Skill",
            "arkts_knowledge_search",
        ],
        false,
    )
}

pub fn harmony_spec_implementation_agent() -> HarmonyAgent {
    let mut agent = HarmonyAgent::new(
        "HarmonySpecImplementation",
        "Harmony Spec Implementation",
        "Hidden approved-spec implementation subagent",
        "harmony_spec_implementation_agent",
        IMPLEMENTATION_TOOLS,
        false,
    );
    agent.permissions = implementation_constraints();
    agent
}

pub fn harmony_spec_verify_agent() -> HarmonyAgent {
    let mut agent = HarmonyAgent::new(
        "HarmonySpecVerify",
        "Harmony Spec Verify",
        "Hidden HarmonyOS build, deployment, and UI verification subagent",
        "harmony_spec_verify_agent",
        VERIFY_TOOLS,
        true,
    );
    agent.permissions = verification_constraints();
    agent
}

#[cfg(test)]
mod tests {
    use super::{harmony_goal_agent, harmony_spec_implementation_agent, harmony_spec_verify_agent};
    use crate::agentic::agents::Agent;
    use bitfun_runtime_ports::{PermissionEffect, PermissionEvaluator};

    #[test]
    fn harmony_goal_includes_arkts_knowledge_search() {
        assert!(harmony_goal_agent()
            .default_tools()
            .contains(&"arkts_knowledge_search".to_string()));
    }

    #[test]
    fn implementation_constraints_deny_build_but_allow_edit() {
        let agent = harmony_spec_implementation_agent();
        let layer = agent.permission_constraints();
        let evaluator = PermissionEvaluator::for_current_platform();
        assert_eq!(
            evaluator.evaluate_constraint_resource("custom_tool", "build_project", layer),
            PermissionEffect::Deny
        );
        assert_eq!(
            evaluator.evaluate_constraint_resource("edit", "src/main.ets", layer),
            PermissionEffect::Allow
        );
    }

    #[test]
    fn verify_constraints_deny_edit_and_bash() {
        let agent = harmony_spec_verify_agent();
        let layer = agent.permission_constraints();
        let evaluator = PermissionEvaluator::for_current_platform();
        assert_eq!(
            evaluator.evaluate_constraint_resource("edit", "src/main.ets", layer),
            PermissionEffect::Deny
        );
        assert_eq!(
            evaluator.evaluate_constraint_resource("bash", "hvigorw assembleHap", layer),
            PermissionEffect::Deny
        );
    }
}
