//! QtMigrationIntake tool implementation.
//!
//! The tool is a host interface; its decision logic lives in the Qt migration
//! domain crate (`bitfun_qt_migration::semantic`) and is shared with the
//! engine's turn-gate analyzer.

use crate::agentic::coordination::official_qt_major;
use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::util::errors::{BitFunError, BitFunResult};
use async_trait::async_trait;
use bitfun_qt_migration::admission::QT_MIGRATION_SLOT_INTAKE_STATE;
use bitfun_qt_migration::question_card::QtMigrationQuestionCard;
use bitfun_qt_migration::state::{intake_snapshot_from_slot_value, intake_snapshot_to_slot_value};
use bitfun_qt_migration::strategy::{pending_generation_mismatch, rebind_strategy_toolchain};
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

    /// Bind the toolchain the user named in the strategy answer, trusting the path.
    fn rebind_toolchain(
        toolchain: &str,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let (Some(reader), Some(writer)) = (
            context.runtime_handles.domain_state_reader(),
            context.runtime_handles.domain_state_writer(),
        ) else {
            return Err(BitFunError::tool(
                "QtMigrationIntake toolchain rebind requires a migration session".to_string(),
            ));
        };
        let snapshot =
            intake_snapshot_from_slot_value(reader.get(&QT_MIGRATION_SLOT_INTAKE_STATE));
        if pending_generation_mismatch(&snapshot).is_none() {
            return Err(BitFunError::tool(
                "No pending Qt migration strategy question; the toolchain was not replaced"
                    .to_string(),
            ));
        }
        let updated = rebind_strategy_toolchain(&snapshot, toolchain, official_qt_major());
        writer.set(
            &QT_MIGRATION_SLOT_INTAKE_STATE,
            intake_snapshot_to_slot_value(&updated),
        );
        log::info!(
            "Qt migration toolchain replaced from the strategy answer: strategy={:?}",
            updated.version_strategy
        );
        let result_for_assistant =
            QtMigrationQuestionCard::replaced_toolchain_fact(&updated).unwrap_or_default();
        Ok(vec![ToolResult::Result {
            data: serde_json::json!({
                "toolchain": toolchain,
                "versionStrategy": updated.version_strategy,
            }),
            result_for_assistant: Some(result_for_assistant),
            image_attachments: None,
        }])
    }
}

#[async_trait]
impl Tool for QtMigrationIntakeTool {
    fn name(&self) -> &str {
        "QtMigrationIntake"
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok(r#"Analyze a user request to classify the Qt / HarmonyOS task type (app_migration, api_mapping, module_support, build_troubleshooting, window_issue, lifecycle, third_party_dependency, toolchain_setup, demo_generation, ambiguous, other) and the per-field minimum-input state for the four migration fields (source_project / output_project / toolchain / template). Use during Qt migration intake to decide whether to ask the user for missing path configuration via AskUserQuestion, or to proceed when inputs are present.

app_migration requires Qt context AND a migration action AND a HarmonyOS/OpenHarmony target. Compound requests return a primary task plus a secondaryTaskTypes list; unclear requests return taskType=ambiguous with requiresClarification=true.

When the user names a different toolchain while answering the migration strategy question, call this tool with `toolchain` set to that Qt kit bin directory (and no `request`) to replace the bound migration toolchain; do not ask the user to confirm it."#
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
                },
                "toolchain": {
                    "type": "string",
                    "description": "Qt kit bin directory the user named while answering the migration strategy question; replaces the bound migration toolchain."
                }
            },
            "additionalProperties": false
        })
    }

    fn is_readonly(&self) -> bool {
        true
    }

    fn is_concurrency_safe(&self, input: Option<&Value>) -> bool {
        input.and_then(|input| input.get("toolchain")).is_none()
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        if let Some(toolchain) = input
            .get("toolchain")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|toolchain| !toolchain.is_empty())
        {
            return Self::rebind_toolchain(toolchain, context);
        }
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
