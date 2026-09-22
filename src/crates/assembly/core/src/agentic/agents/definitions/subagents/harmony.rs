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
    "check_arkts_files",
    "check_cpp_files",
    "verify_ui",
    "get_ui_verification_log",
    "save_ui_screenshot",
    "AskUserQuestion",
];

fn deny_tools(tools: &[&str]) -> PermissionConstraintLayer {
    PermissionConstraintLayer::new(
        tools
            .iter()
            .map(|tool| PermissionRule::new(*tool, "*", PermissionEffect::Deny))
            .collect(),
    )
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
            permissions: deny_tools(&[
                "edit",
                "write",
                "delete",
                "bash",
                "build_project",
                "start_app",
                "hdc_log",
                "verify_ui",
            ]),
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
    agent.permissions = deny_tools(&[
        "build_project",
        "start_app",
        "hdc_log",
        "verify_ui",
        "get_ui_verification_log",
        "save_ui_screenshot",
        "plan_enter",
        "plan_exit",
        "spec_write",
    ]);
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
    agent.permissions = deny_tools(&[
        "edit",
        "write",
        "delete",
        "bash",
        "plan_enter",
        "plan_exit",
        "spec_write",
    ]);
    agent
}
