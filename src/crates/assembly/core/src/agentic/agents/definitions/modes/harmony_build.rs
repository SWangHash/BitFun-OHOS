use crate::agentic::agents::{
    shared_coding_mode_user_context_policy, Agent, AgentToolPolicyOverrides, UserContextPolicy,
};
use crate::agentic::tools::framework::ToolExposure;
use async_trait::async_trait;

pub struct HarmonyBuildMode {
    default_tools: Vec<String>,
    tool_exposure_overrides: AgentToolPolicyOverrides,
}

impl Default for HarmonyBuildMode {
    fn default() -> Self {
        Self::new()
    }
}

impl HarmonyBuildMode {
    pub fn new() -> Self {
        let mut tool_exposure_overrides = AgentToolPolicyOverrides::default();
        tool_exposure_overrides.insert("plan_enter".to_string(), ToolExposure::Deferred);
        tool_exposure_overrides.insert("verify_ui".to_string(), ToolExposure::Deferred);
        tool_exposure_overrides.insert(
            "get_ui_verification_log".to_string(),
            ToolExposure::Deferred,
        );
        tool_exposure_overrides.insert("save_ui_screenshot".to_string(), ToolExposure::Deferred);
        Self {
            default_tools: vec![
                "Task".to_string(),
                "AgentWait".to_string(),
                "Read".to_string(),
                "view_image".to_string(),
                "analyze_image".to_string(),
                "Write".to_string(),
                "Edit".to_string(),
                "Delete".to_string(),
                "ExecCommand".to_string(),
                "WriteStdin".to_string(),
                "ExecControl".to_string(),
                "Grep".to_string(),
                "Glob".to_string(),
                "TodoWrite".to_string(),
                "get_goal".to_string(),
                "create_goal".to_string(),
                "update_goal".to_string(),
                "Skill".to_string(),
                "AskUserQuestion".to_string(),
                "Git".to_string(),
                "ReviewPlatform".to_string(),
                "CreatePlan".to_string(),
                "build_project".to_string(),
                "start_app".to_string(),
                "hdc_log".to_string(),
                "arkts_knowledge_search".to_string(),
                "check_arkts_files".to_string(),
                "check_cpp_files".to_string(),
                "switch_cwd".to_string(),
                "verify_ui".to_string(),
                "get_ui_verification_log".to_string(),
                "save_ui_screenshot".to_string(),
            ],
            tool_exposure_overrides,
        }
    }
}

#[async_trait]
impl Agent for HarmonyBuildMode {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
    fn id(&self) -> &str {
        "HarmonyBuild"
    }
    fn name(&self) -> &str {
        "Harmony Build"
    }
    fn description(&self) -> &str {
        "HarmonyOS build, deployment, diagnosis, and verification specialist"
    }
    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "harmony_build_agent"
    }
    fn default_tools(&self) -> Vec<String> {
        self.default_tools.clone()
    }
    fn tool_exposure_overrides(&self) -> &AgentToolPolicyOverrides {
        &self.tool_exposure_overrides
    }
    fn user_context_policy(&self) -> UserContextPolicy {
        shared_coding_mode_user_context_policy()
    }
    fn is_readonly(&self) -> bool {
        false
    }
}
