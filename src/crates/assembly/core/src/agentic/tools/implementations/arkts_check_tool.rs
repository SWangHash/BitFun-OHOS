//! arkts_check tool — static ArkTS syntax check on `.ets` files.
//!
//! Invokes DevEco Studio's bundled Node and SDK `ets_checker.js` directly via
//! the embedded `arkts-check.cjs` script. This path does **not** depend on the
//! `deveco-mcp` MCP server, so ArkTS checking stays available even when MCP is
//! unconfigured, stopped, or unreachable. All external failures (missing
//! DevEco, missing Node, missing SDK, timeout, cancellation, malformed output)
//! are returned as recoverable tool errors — never as panics.

use crate::agentic::tools::framework::{
    Tool, ToolRenderOptions, ToolResult, ToolUseContext, ValidationResult,
};
use crate::agentic::tools::implementations::arkts_checker::run_arkts_check;
use crate::util::errors::{BitFunError, BitFunResult};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::Path;

/// arkts_check tool — static ArkTS syntax check on `.ets` files via DevEco SDK.
pub struct ArktsCheckTool;

impl Default for ArktsCheckTool {
    fn default() -> Self {
        Self::new()
    }
}

impl ArktsCheckTool {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for ArktsCheckTool {
    fn name(&self) -> &str {
        "arkts_check"
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok(r#"Run ArkTS strict-mode static syntax/type check on .ets files.

Detects compiler-level violations such as `arkts-no-standalone-this`, `arkts-no-obj-literals-as-types`, and other ArkTS spec issues. Returns structured diagnostics by file, line, column, severity, and rule.

Call this tool:
- After writing or editing any `.ets` file, before running `build_project`. Catches most ArkTS errors faster than a full build.
- When debugging compilation problems isolated to a specific page or component.

Do NOT call this tool:
- For non-`.ets` source files (use `lsp` or read the build output instead).
- When DevEco Studio is not installed locally. The tool auto-discovers DevEco Studio from `DEVECO_HOME` or standard install paths; only set `DEVECO_HOME` manually if the auto-discovery fails.
"#.to_string())
    }

    fn short_description(&self) -> String {
        "Run ArkTS strict-mode static syntax/type check on .ets files.".to_string()
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "files": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "List of .ets file paths (relative to the project root or absolute)."
                }
            },
            "required": ["files"],
            "additionalProperties": false
        })
    }

    fn is_readonly(&self) -> bool {
        true
    }

    fn is_concurrency_safe(&self, _input: Option<&Value>) -> bool {
        false
    }

    async fn validate_input(
        &self,
        input: &Value,
        _context: Option<&ToolUseContext>,
    ) -> ValidationResult {
        match input.get("files").and_then(|v| v.as_array()) {
            Some(files) if !files.is_empty() => ValidationResult {
                result: true,
                message: None,
                error_code: None,
                meta: None,
            },
            _ => ValidationResult {
                result: false,
                message: Some("files must be a non-empty array of .ets file paths".to_string()),
                error_code: Some(400),
                meta: None,
            },
        }
    }

    fn render_tool_use_message(&self, input: &Value, _options: &ToolRenderOptions) -> String {
        let count = input
            .get("files")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        format!("ArkTS check on {} file(s)", count)
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let all_files: Vec<String> = input
            .get("files")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let ets_files: Vec<String> = all_files
            .iter()
            .filter(|f| {
                Path::new(f)
                    .extension()
                    .map(|ext| ext.eq_ignore_ascii_case("ets"))
                    .unwrap_or(false)
            })
            .cloned()
            .collect();

        if ets_files.is_empty() {
            return Err(BitFunError::tool(
                "No .ets files provided. All files were filtered out.".to_string(),
            ));
        }

        let project_root = super::devecocli_run::resolve_harmony_cwd(context);
        let result = run_arkts_check(&ets_files, &project_root).await?;

        let error_count = result
            .output
            .summary
            .as_ref()
            .map(|s| s.error_count)
            .unwrap_or_else(|| {
                result
                    .output
                    .errors
                    .iter()
                    .filter(|d| d.severity == "error")
                    .count() as u32
            });
        let warn_count = result
            .output
            .summary
            .as_ref()
            .map(|s| s.warn_count)
            .unwrap_or_else(|| {
                result
                    .output
                    .errors
                    .iter()
                    .filter(|d| d.severity != "error")
                    .count() as u32
            });

        let assistant_text = if result.output.success || error_count == 0 {
            format!(
                "ArkTS Check Passed: No errors found in {} file(s). ({} warning(s))",
                ets_files.len(),
                warn_count
            )
        } else {
            let lines: Vec<String> = result
                .output
                .errors
                .iter()
                .filter(|d| d.severity == "error")
                .map(|d| {
                    let rule_suffix = if d.rule.is_empty() {
                        String::new()
                    } else {
                        format!(" ({})", d.rule)
                    };
                    format!(
                        "{}:{}:{} - {}: {}{}",
                        d.file, d.line, d.column, d.severity, d.message, rule_suffix
                    )
                })
                .collect();
            format!(
                "ArkTS Check Failed: {} error(s) found:\n{}",
                error_count,
                lines.join("\n")
            )
        };

        Ok(vec![ToolResult::Result {
            data: json!({
                "files": result.files_checked,
                "success": error_count == 0,
                "errorCount": error_count,
                "warnCount": warn_count,
                "diagnostics": result.output.errors,
            }),
            result_for_assistant: Some(assistant_text),
            image_attachments: None,
        }])
    }
}
