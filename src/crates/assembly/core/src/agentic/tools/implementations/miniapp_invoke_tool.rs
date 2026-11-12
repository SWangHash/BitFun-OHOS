//! MiniAppInvoke tool — let the agent invoke an installed MiniApp's host
//! primitives (fs/shell/net/os) under that app's own permission policy.
//!
//! Security model:
//! - The target app must be installed; its meta permissions are resolved by the
//!   same `dispatch_host` used by the MiniApp sandbox, so the app's shell
//!   allowlist, fs path scopes, and net host allowlist fully apply.
//! - The session workspace is forwarded as the MiniApp workspace root, so apps
//!   declaring `{workspace}` fs scopes can operate on the user's files — the
//!   same semantics as opening the app inside that workspace in the UI. The
//!   scope must still be declared in the app meta and approved per call.
//! - Market-strict apps get the same hardening as the desktop Tauri command:
//!   no `command` strings, a non-empty string `args` array, and no shells or
//!   general-purpose interpreters.
//! - Every host-primitive call emits a `custom_tool` permission intent scoped
//!   to `{app_id}:{namespace}`, so the user approves each app capability group
//!   (and can grant it persistently) through the standard approval pipeline.
//! - Remote workspaces are rejected explicitly: dispatch runs against the local
//!   host's MiniApp store and must not silently execute for a remote session.

use crate::agentic::tools::framework::{
    PermissionIntent, Tool, ToolResult, ToolUseContext, ValidationResult,
};
use crate::miniapp::host_dispatch::{dispatch_host, is_host_primitive};
use crate::miniapp::try_get_global_miniapp_manager;
use crate::util::errors::{BitFunError, BitFunResult};
use async_trait::async_trait;
use serde_json::{json, Value};

/// Upper bound for the assistant-visible result text. The full value stays in
/// `data`; oversized stdout is truncated here.
const ASSISTANT_RESULT_CHAR_LIMIT: usize = 12_000;

/// ValidationResult error codes: 1 = malformed input, 2 = remote unsupported.
const INVALID_INPUT_ERROR_CODE: i32 = 1;
const REMOTE_UNSUPPORTED_ERROR_CODE: i32 = 2;

/// Pseudo-method that lists installed MiniApps instead of dispatching a host
/// primitive. The model has no other way to discover valid `app_id` values.
const APPS_LIST_METHOD: &str = "apps.list";

fn is_supported_method(method: &str) -> bool {
    method == APPS_LIST_METHOD || is_host_primitive(method)
}

pub struct MiniAppInvokeTool;

impl MiniAppInvokeTool {
    pub fn new() -> Self {
        Self
    }

    fn parse_method(input: &Value) -> Option<String> {
        input
            .get("method")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|method| !method.is_empty())
            .map(str::to_string)
    }

    fn parse_app_id(input: &Value) -> Option<String> {
        input
            .get("app_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|app_id| !app_id.is_empty())
            .map(str::to_string)
    }
}

impl Default for MiniAppInvokeTool {
    fn default() -> Self {
        Self::new()
    }
}

/// Hardening applied to market-strict apps, mirroring the desktop Tauri
/// command's `validate_market_host_call` so the agent path never becomes a
/// weaker bypass around the marketplace runtime.
fn validate_market_strict_shell_exec(params: &Value) -> BitFunResult<()> {
    if params
        .get("command")
        .and_then(Value::as_str)
        .is_some_and(|command| !command.trim().is_empty())
    {
        return Err(BitFunError::validation(
            "Marketplace MiniApps must use shell.exec args and cannot execute command strings.",
        ));
    }
    let args = params
        .get("args")
        .and_then(Value::as_array)
        .filter(|args| !args.is_empty())
        .ok_or_else(|| {
            BitFunError::validation("Marketplace MiniApps must use a non-empty shell.exec args array.")
        })?;
    if args.iter().any(|value| value.as_str().is_none()) {
        return Err(BitFunError::validation(
            "Marketplace shell.exec args must all be strings.",
        ));
    }
    let program = args[0]
        .as_str()
        .unwrap_or_default()
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .trim_end_matches(".exe")
        .to_ascii_lowercase();
    if matches!(
        program.as_str(),
        "sh" | "bash"
            | "zsh"
            | "fish"
            | "cmd"
            | "powershell"
            | "pwsh"
            | "python"
            | "python3"
            | "node"
            | "bun"
            | "deno"
            | "ruby"
            | "perl"
    ) {
        return Err(BitFunError::validation(
            "Shells and general-purpose interpreters are forbidden for marketplace MiniApps.",
        ));
    }
    Ok(())
}

fn truncate_for_assistant(text: String) -> String {
    if text.chars().count() <= ASSISTANT_RESULT_CHAR_LIMIT {
        return text;
    }
    let truncated: String = text.chars().take(ASSISTANT_RESULT_CHAR_LIMIT).collect();
    format!(
        "{}\n…[truncated {} chars — full value is in the result data]",
        truncated,
        text.chars().count() - ASSISTANT_RESULT_CHAR_LIMIT
    )
}

#[async_trait]
impl Tool for MiniAppInvokeTool {
    fn name(&self) -> &str {
        "MiniAppInvoke"
    }

    async fn description(&self) -> BitFunResult<String> {
        let mut text = r#"Invoke a host primitive (fs/shell/net/os) AS an installed MiniApp, using that app's own permission policy.

Use cases: drive a MiniApp's capabilities on the user's behalf — e.g. format a workspace file through builtin-json-formatter (fs.readFile → format the JSON text → fs.writeFile). When the user asks to do something with a MiniApp, prefer invoking the installed app over doing the task by hand.

Input:
- method (required): "apps.list" to enumerate installed MiniApps, or a host primitive — shell.exec, net.fetch, os.info, or fs.* (readFile/writeFile/readdir/stat/mkdir/rm/access/...).
- app_id (required for host primitives): installed MiniApp id, e.g. "builtin-json-formatter". Ignored by apps.list.
- params (optional object): same shape the app's window.app bridge expects, e.g. fs.readFile takes {"path": "config.json"}.

Constraints:
- The app's declared permissions still apply: shell commands must be in the app's basename allowlist, fs access is scoped to the app's appdata plus the session workspace when the app declares {workspace} scopes (fs.readFile/fs.writeFile on workspace files work for apps like builtin-json-formatter), and net.fetch keeps its host allowlist and private-address denial.
- Marketplace (market-strict) apps additionally forbid command strings and interpreters in shell.exec.
- Host-primitive calls require user approval scoped per app + namespace (shell/net/fs/os); apps.list is free. Local MiniApp host only — unavailable for remote workspaces.
- Returns the primitive's JSON result in `data`."#.to_string();

        // Enumerate installed apps so the model can pick a valid app_id at
        // schema time instead of hallucinating one (e.g. "builtin-miniapp").
        if let Some(manager) = try_get_global_miniapp_manager() {
            if let Ok(metas) = manager.list().await {
                if !metas.is_empty() {
                    text.push_str("\n\nInstalled MiniApps:\n");
                    for meta in metas {
                        text.push_str(&format!(
                            "- {} ({}): {}\n",
                            meta.id, meta.name, meta.description
                        ));
                    }
                }
            }
        }
        Ok(text)
    }

    fn short_description(&self) -> String {
        "Invoke an installed MiniApp's host primitives under that app's own permissions.".to_string()
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["method"],
            "properties": {
                "method": {
                    "type": "string",
                    "description": "\"apps.list\" to enumerate installed MiniApps, or a host primitive: shell.exec | net.fetch | os.info | fs.readFile/fs.writeFile/fs.readdir/fs.stat/fs.mkdir/fs.rm/fs.access/fs.appendFile/fs.copyFile/fs.rename."
                },
                "app_id": {
                    "type": "string",
                    "description": "Installed MiniApp id (discover via method apps.list), e.g. 'builtin-json-formatter'. Required for host primitives; ignored by apps.list."
                },
                "params": {
                    "type": "object",
                    "description": "Bridge-shaped params for the primitive, e.g. {\"path\": \"config.json\"} for fs.readFile or {\"url\": \"https://…\"} for net.fetch. Default {}."
                }
            }
        })
    }

    fn is_readonly(&self) -> bool {
        false
    }

    fn permission_intents(
        &self,
        input: &Value,
        _context: &ToolUseContext,
    ) -> BitFunResult<Vec<PermissionIntent>> {
        let method = Self::parse_method(input).unwrap_or_default();
        if method == APPS_LIST_METHOD {
            // Read-only catalog listing: no side effects, no approval needed.
            return Ok(Vec::new());
        }
        // Scope grants per app + host namespace so "always allow" stays within
        // one MiniApp capability group instead of the whole tool surface.
        let namespace = method
            .split('.')
            .next()
            .filter(|namespace| !namespace.is_empty())
            .unwrap_or("unknown")
            .to_string();
        let app_id = Self::parse_app_id(input).unwrap_or_else(|| "unknown".to_string());
        Ok(vec![PermissionIntent::new(
            "custom_tool",
            vec![format!("miniapp:MiniAppInvoke:{app_id}:{namespace}")],
        )])
    }

    async fn validate_input(
        &self,
        input: &Value,
        context: Option<&ToolUseContext>,
    ) -> ValidationResult {
        if let Some(context) = context {
            if context.is_remote() {
                return ValidationResult {
                    result: false,
                    message: Some(
                        "MiniAppInvoke runs on the local host and is unavailable for remote workspaces."
                            .to_string(),
                    ),
                    error_code: Some(REMOTE_UNSUPPORTED_ERROR_CODE),
                    meta: None,
                };
            }
        }
        let method = match Self::parse_method(input) {
            Some(method) => method,
            None => {
                return ValidationResult {
                    result: false,
                    message: Some("Missing required field: method".to_string()),
                    error_code: Some(INVALID_INPUT_ERROR_CODE),
                    meta: None,
                }
            }
        };
        if !is_supported_method(&method) {
            return ValidationResult {
                result: false,
                message: Some(format!(
                    "method '{method}' is not supported (use apps.list or a host primitive: fs.*/shell.*/os.*/net.*)"
                )),
                error_code: Some(INVALID_INPUT_ERROR_CODE),
                meta: None,
            };
        }
        if method != APPS_LIST_METHOD && Self::parse_app_id(input).is_none() {
            return ValidationResult {
                result: false,
                message: Some(
                    "Missing required field: app_id (discover ids with method apps.list)".to_string(),
                ),
                error_code: Some(INVALID_INPUT_ERROR_CODE),
                meta: None,
            };
        }
        ValidationResult {
            result: true,
            message: None,
            error_code: None,
            meta: None,
        }
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        if context.is_remote() {
            return Err(BitFunError::validation(
                "MiniAppInvoke runs on the local host and is unavailable for remote workspaces.",
            ));
        }
        let method = Self::parse_method(input)
            .ok_or_else(|| BitFunError::validation("Missing required field: method"))?;
        if !is_supported_method(&method) {
            return Err(BitFunError::validation(format!(
                "method '{method}' is not supported (use apps.list or a host primitive: fs.*/shell.*/os.*/net.*)"
            )));
        }

        let manager = try_get_global_miniapp_manager()
            .ok_or_else(|| BitFunError::tool("MiniAppManager not initialized".to_string()))?;

        if method == APPS_LIST_METHOD {
            let metas = manager
                .list()
                .await
                .map_err(|e| BitFunError::tool(format!("Failed to list MiniApps: {}", e)))?;
            let apps: Vec<Value> = metas
                .iter()
                .map(|meta| {
                    json!({
                        "id": meta.id,
                        "name": meta.name,
                        "description": meta.description,
                        "category": meta.category,
                        "icon": meta.icon,
                    })
                })
                .collect();
            return Ok(vec![ToolResult::Result {
                data: json!({ "apps": apps }),
                result_for_assistant: Some(
                    serde_json::to_string_pretty(&json!({ "apps": apps }))
                        .unwrap_or_else(|_| "[]".to_string()),
                ),
                image_attachments: None,
            }]);
        }

        let app_id = Self::parse_app_id(input)
            .ok_or_else(|| BitFunError::validation("Missing required field: app_id"))?;
        let params = input.get("params").cloned().unwrap_or_else(|| json!({}));
        if !params.is_object() {
            return Err(BitFunError::validation("params must be a JSON object"));
        }

        let app = manager.get(&app_id).await.map_err(|_| {
            BitFunError::validation(format!(
                "MiniApp '{app_id}' is not installed (discover ids with method apps.list)"
            ))
        })?;

        if manager.uses_market_strict_runtime(&app_id).await && method == "shell.exec" {
            validate_market_strict_shell_exec(&params)?;
        }

        let app_data_dir = manager.path_manager().miniapp_dir(&app_id);
        let granted_paths = manager.granted_paths_for_app(&app_id).await;
        // Forward the session workspace so apps that declare {workspace} fs
        // scopes can operate on the user's files (same semantics as opening
        // the app inside that workspace in the UI). The app's meta must still
        // declare the scope, and every call goes through the approval panel.
        let workspace_dir = context.workspace_root();
        let value = dispatch_host(
            &app.permissions,
            &app_id,
            &app_data_dir,
            workspace_dir,
            &granted_paths,
            &method,
            params,
        )
        .await?;

        let result_for_assistant = truncate_for_assistant(match &value {
            Value::String(text) => text.clone(),
            other => serde_json::to_string_pretty(other)
                .unwrap_or_else(|_| format!("{other:?}")),
        });

        Ok(vec![ToolResult::Result {
            data: json!({
                "app_id": app_id,
                "method": method,
                "result": value,
            }),
            result_for_assistant: Some(result_for_assistant),
            image_attachments: None,
        }])
    }
}

#[cfg(test)]
mod tests {
    use super::MiniAppInvokeTool;
    use crate::agentic::tools::framework::{Tool, ToolExposure, ToolUseContext};
    use serde_json::json;

    #[test]
    fn miniapp_invoke_stays_direct_and_non_readonly() {
        let tool = MiniAppInvokeTool::new();
        assert_eq!(tool.default_exposure(), ToolExposure::Direct);
        assert!(!tool.is_readonly());
    }

    #[test]
    fn miniapp_invoke_emits_stable_permission_identity() {
        let tool = MiniAppInvokeTool::new();
        let context = ToolUseContext::for_tool_listing(None, None);
        let intents = tool
            .permission_intents(
                &json!({ "app_id": "builtin-json-formatter", "method": "fs.readFile" }),
                &context,
            )
            .expect("permission intent");

        assert_eq!(intents.len(), 1);
        assert_eq!(intents[0].action, "custom_tool");
        assert_eq!(
            intents[0].resources,
            ["miniapp:MiniAppInvoke:builtin-json-formatter:fs".to_string()]
        );
    }

    #[tokio::test]
    async fn miniapp_invoke_rejects_non_host_primitives_before_approval() {
        let tool = MiniAppInvokeTool::new();
        let context = ToolUseContext::for_tool_listing(None, None);
        let validation = tool
            .validate_input(
                &json!({ "app_id": "builtin-json-formatter", "method": "storage.get" }),
                Some(&context),
            )
            .await;
        assert!(!validation.result);
    }

    #[tokio::test]
    async fn miniapp_invoke_allows_apps_list_without_app_id() {
        let tool = MiniAppInvokeTool::new();
        let context = ToolUseContext::for_tool_listing(None, None);
        let validation = tool
            .validate_input(&json!({ "method": "apps.list" }), Some(&context))
            .await;
        assert!(validation.result);
        // Catalog listing is read-only: no approval intent.
        let intents = tool
            .permission_intents(&json!({ "method": "apps.list" }), &context)
            .expect("permission intents");
        assert!(intents.is_empty());
    }

    #[tokio::test]
    async fn miniapp_invoke_lists_catalog_in_description() {
        let tool = MiniAppInvokeTool::new();
        let description = tool.description().await.expect("description");
        assert!(description.contains("apps.list"));
    }

    #[tokio::test]
    async fn miniapp_invoke_validates_host_primitives() {
        let tool = MiniAppInvokeTool::new();
        let context = ToolUseContext::for_tool_listing(None, None);
        let validation = tool
            .validate_input(
                &json!({ "app_id": "builtin-json-formatter", "method": "fs.readFile", "params": {} }),
                Some(&context),
            )
            .await;
        assert!(validation.result);
    }

    #[test]
    fn market_strict_hardening_forbids_command_strings_and_interpreters() {
        use super::validate_market_strict_shell_exec;

        assert!(validate_market_strict_shell_exec(&json!({ "command": "git status" })).is_err());
        assert!(validate_market_strict_shell_exec(&json!({ "args": [] })).is_err());
        assert!(validate_market_strict_shell_exec(&json!({ "args": ["sh", "-c", "ls"] })).is_err());
        assert!(validate_market_strict_shell_exec(&json!({ "args": ["/usr/bin/python3"] })).is_err());
        assert!(validate_market_strict_shell_exec(&json!({ "args": ["curl", "-s", "http://127.0.0.1:9090/version"] })).is_ok());
    }
}
