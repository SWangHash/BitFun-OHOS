//! QtMigrationIntake tool implementation.
//!
//! The tool is a host interface; its decision logic lives in the Qt migration
//! domain crate (`bitfun_qt_migration::semantic`) and is shared with the
//! engine's turn-gate analyzer.

use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::util::errors::BitFunResult;
use async_trait::async_trait;
use serde_json::Value;

/// QtMigrationIntake tool - routes a Qt migration request.
pub struct QtMigrationIntakeTool;

impl Default for QtMigrationIntakeTool {
    fn default() -> Self {
        Self::new()
    }
}

impl QtMigrationIntakeTool {
    pub fn new() -> Self {
        Self
    }

    /// Full decision: taskType + per-field minimum-input state.
    pub fn analyze_request(request: &str) -> Value {
        bitfun_qt_migration::semantic::analyze_request(request)
    }
}

#[async_trait]
impl Tool for QtMigrationIntakeTool {
    fn name(&self) -> &str {
        "QtMigrationIntake"
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok(r#"Analyze a user request to classify the Qt / HarmonyOS task type (app_migration, api_mapping, module_support, build_troubleshooting, window_issue, lifecycle, third_party_dependency, toolchain_setup, demo_generation, ambiguous, other) and the per-field minimum-input state for the four migration fields (source_project / output_project / toolchain / template). Use during Qt migration intake to decide whether to ask the user for missing path configuration via AskUserQuestion, or to proceed when inputs are present.

app_migration requires Qt context AND a migration action AND a HarmonyOS/OpenHarmony target. Compound requests return a primary task plus a secondaryTaskTypes list; unclear requests return taskType=ambiguous with requiresClarification=true."#
            .to_string())
    }

    fn short_description(&self) -> String {
        "Route a Qt/HarmonyOS request: taskType + per-field input state.".to_string()
    }

    fn input_schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "request": {
                    "type": "string",
                    "description": "The user's raw request text to analyze."
                }
            },
            "required": ["request"],
            "additionalProperties": false
        })
    }

    fn is_readonly(&self) -> bool {
        true
    }

    fn is_concurrency_safe(&self, _input: Option<&Value>) -> bool {
        true
    }

    async fn call_impl(
        &self,
        input: &Value,
        _context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let request = input
            .get("request")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let data = Self::analyze_request(request);
        let result_for_assistant = data["reason"].as_str().unwrap_or_default().to_string();

        Ok(vec![ToolResult::Result {
            data,
            result_for_assistant: Some(result_for_assistant),
            image_attachments: None,
        }])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_delegates_to_the_domain_analyzer() {
        let decision = QtMigrationIntakeTool::analyze_request("请我帮你把 Qt 工程搬到鸿蒙化");
        assert_eq!(decision["taskType"], "app_migration");
        assert!(decision["resolvedPaths"].is_object());
    }

    #[test]
    fn unrelated_request_is_other() {
        let decision = QtMigrationIntakeTool::analyze_request("帮我重构一下这个模块的接口设计");
        assert_eq!(decision["taskType"], "other");
    }
}
