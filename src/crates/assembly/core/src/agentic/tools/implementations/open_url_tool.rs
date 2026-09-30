//! OpenUrl tool - open an http(s) URL for the user.
//!
//! The primary path opens the page in BitFun's built-in browser side panel so
//! the user stays inside the app; the OS browser is the explicit fallback. The
//! motivating case is agent-driven sign-in: `devecocli auth login` cannot
//! launch a browser on every platform, so it prints the authorization URL and
//! the agent hands that URL to this tool.
//!
//! The built-in panel is **display-only** for the agent: it cannot be
//! snapshotted or driven from here. Reading or driving a page stays in
//! ControlHub's `browser` domain.

use crate::agentic::tools::framework::{
    Tool, ToolRenderOptions, ToolResult, ToolUseContext, ValidationResult,
};
use crate::util::errors::{BitFunError, BitFunResult};
use async_trait::async_trait;
use serde_json::{json, Value};

/// Event the Web UI listens on to open a URL in BitFun's built-in browser side
/// panel. Deliberately duplicated from ControlHub's `browser.open_builtin`
/// constant (kept private there to avoid a cross-feature visibility coupling
/// for one string): both tools must drive the same frontend path.
#[cfg(feature = "runtime-services")]
const OPEN_BUILT_IN_BROWSER_EVENT: &str = "agentic://open-built-in-browser";

const DEFAULT_PANEL_TITLE: &str = "Browser";

/// Schemes that must never be forwarded to a browser. They carry no `://`, so
/// the bare-host normalization below would otherwise rewrite them into a bogus
/// `https://` URL instead of rejecting them.
const NON_WEB_SCHEMES: &[&str] = &[
    "javascript",
    "data",
    "vbscript",
    "mailto",
    "tel",
    "about",
    "blob",
    "file",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OpenUrlMode {
    Auto,
    Builtin,
    System,
}

impl OpenUrlMode {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Builtin => "builtin",
            Self::System => "system",
        }
    }

    fn parse(raw: Option<&str>) -> BitFunResult<Self> {
        match raw.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            None | Some("") | Some("auto") => Ok(Self::Auto),
            Some("builtin") | Some("embedded") | Some("panel") => Ok(Self::Builtin),
            Some("system") | Some("external") | Some("browser") => Ok(Self::System),
            Some(other) => Err(BitFunError::tool(format!(
                "Unsupported mode '{other}'. Valid values: auto, builtin, system."
            ))),
        }
    }
}

/// OpenUrl tool - show a URL to the user.
pub struct OpenUrlTool;

impl Default for OpenUrlTool {
    fn default() -> Self {
        Self::new()
    }
}

impl OpenUrlTool {
    pub fn new() -> Self {
        Self
    }

    /// Normalize a user- or model-supplied URL. Bare hosts become `https://`
    /// URLs; only http(s) is accepted, matching the built-in panel contract.
    fn normalize_url(raw_url: &str) -> BitFunResult<String> {
        let trimmed = raw_url.trim();
        if trimmed.is_empty() {
            return Err(BitFunError::tool(
                "OpenUrl requires a non-empty 'url'.".to_string(),
            ));
        }
        if let Some((scheme, _)) = trimmed.split_once(':') {
            let scheme = scheme.to_ascii_lowercase();
            if NON_WEB_SCHEMES.contains(&scheme.as_str()) {
                return Err(BitFunError::tool(format!(
                    "OpenUrl only opens http(s) URLs; refusing to open a '{scheme}:' target. \
                     Use ExecCommand or the OS to open non-web targets."
                )));
            }
        }
        let normalized = if trimmed.contains("://") {
            trimmed.to_string()
        } else {
            format!("https://{trimmed}")
        };
        let lower = normalized.to_ascii_lowercase();
        if !(lower.starts_with("http://") || lower.starts_with("https://")) {
            return Err(BitFunError::tool(format!(
                "OpenUrl only opens http(s) URLs; refusing to open '{trimmed}'. \
                 Use ExecCommand or the OS to open non-web targets."
            )));
        }
        Ok(normalized)
    }

    fn resolve_title(input: &Value, url: &str) -> String {
        input
            .get("title")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                url.split("://")
                    .nth(1)
                    .and_then(|rest| rest.split('/').next())
                    .filter(|host| !host.is_empty())
                    .unwrap_or(DEFAULT_PANEL_TITLE)
                    .to_string()
            })
    }

    #[cfg(feature = "runtime-services")]
    async fn emit_builtin_browser_event(
        &self,
        url: &str,
        title: &str,
        context: &ToolUseContext,
    ) -> BitFunResult<()> {
        use crate::infrastructure::events::{get_global_event_system, BackendEvent};

        get_global_event_system()
            .emit(BackendEvent::Custom {
                event_name: OPEN_BUILT_IN_BROWSER_EVENT.to_string(),
                payload: json!({
                    "url": url,
                    "title": title,
                    "replaceExisting": true,
                    "ownerSessionId": context.session_id,
                    "ownerWorkspaceId": context
                        .workspace
                        .as_ref()
                        .and_then(|workspace| workspace.workspace_id.as_ref()),
                    "ownerWorkspacePath": context
                        .workspace_root()
                        .map(|path| path.to_string_lossy().to_string()),
                }),
            })
            .await
            .map_err(|error| {
                BitFunError::tool(format!("Failed to open the built-in browser: {error}"))
            })
    }

    #[cfg(not(feature = "runtime-services"))]
    async fn emit_builtin_browser_event(
        &self,
        _url: &str,
        _title: &str,
        _context: &ToolUseContext,
    ) -> BitFunResult<()> {
        Err(BitFunError::tool(
            "The built-in browser panel is not available in this build.".to_string(),
        ))
    }

    async fn open_in_builtin_panel(
        &self,
        url: &str,
        title: &str,
        context: &ToolUseContext,
    ) -> BitFunResult<ToolResult> {
        self.emit_builtin_browser_event(url, title, context).await?;
        Ok(ToolResult::ok(
            json!({
                "success": true,
                "url": url,
                "title": title,
                "mode": OpenUrlMode::Builtin.as_str(),
                "opened_with": "bitfun-builtin-browser",
                "observable_by_agent": false,
                "note": "The built-in browser panel is display-only for the user; the agent cannot observe or interact with its content.",
                "hints": [
                    "Do not call snapshot/get_text/click against this panel - it is not a CDP session.",
                    "To read page content or interact with the DOM, use ControlHub domain=\"browser\" (connect, then snapshot).",
                ],
            }),
            Some(format!(
                "Opened {url} in BitFun's built-in browser panel (display-only for the user)."
            )),
        ))
    }

    /// Open the URL in the OS browser. HarmonyOS goes through the ArkTS
    /// `open_browser` bridge (which prefers the system browser and falls back
    /// from an unavailable third-party browser); desktop hosts reuse the same
    /// platform handler as Computer Use's `system.open_url`.
    #[cfg(target_env = "ohos")]
    async fn open_in_system_browser(url: &str) -> BitFunResult<String> {
        let response = crate::util::call_arkts_string_function("open_browser", url.to_string())
            .await
            .map_err(|error| {
                BitFunError::tool(format!("Failed to open the system browser: {error}"))
            })?;
        if response
            .trim_start()
            .to_ascii_lowercase()
            .starts_with("fail")
        {
            return Err(BitFunError::tool(format!(
                "The HarmonyOS system browser refused to open {url}: {}",
                response.trim()
            )));
        }
        Ok("harmonyos-system-browser".to_string())
    }

    #[cfg(not(target_env = "ohos"))]
    async fn open_in_system_browser(url: &str) -> BitFunResult<String> {
        use bitfun_services_core::system::LocalSystemProvider;

        let outcome = LocalSystemProvider::new().open_url(url).map_err(|error| {
            BitFunError::tool(format!(
                "Failed to open {url} in the system browser: {error}"
            ))
        })?;
        Ok(outcome.method)
    }

    async fn open_in_system_browser_result(url: &str) -> BitFunResult<ToolResult> {
        let opened_with = Self::open_in_system_browser(url).await?;
        Ok(ToolResult::ok(
            json!({
                "success": true,
                "url": url,
                "mode": OpenUrlMode::System.as_str(),
                "opened_with": opened_with,
                "observable_by_agent": false,
                "note": "The page is now open in an external browser; BitFun cannot observe or control that window.",
            }),
            Some(format!(
                "Opened {url} in the system browser ({opened_with})."
            )),
        ))
    }
}

#[async_trait]
impl Tool for OpenUrlTool {
    fn name(&self) -> &str {
        "OpenUrl"
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok(r#"Open an http(s) URL for the user, preferring BitFun's built-in browser panel.

Use this tool when the user must see or act on a web page that the agent cannot complete on its own: sign-in and OAuth/authorization pages (for example the login URL printed by `devecocli auth login`), account or console pages, and plain "open this link for me" requests.

Parameters:
- url (required, string): the http(s) URL to open. A bare host such as `example.com` is normalized to `https://example.com`. Non-http(s) targets are rejected.
- mode (optional, string): `auto` (default), `builtin`, or `system`.
  * `auto` - open in BitFun's built-in browser panel, falling back to the OS browser when the panel is unavailable.
  * `builtin` - BitFun's built-in browser side panel only.
  * `system` - the OS browser only (HarmonyOS: the system browser; desktop: the default browser).
- title (optional, string): panel title for `auto`/`builtin`. Defaults to the URL host.

The built-in panel is display-only: the agent cannot snapshot, read, or click the page. To read or drive page content yourself, use ControlHub (domain "browser"). To open local files or non-web targets, use the OS or ExecCommand instead.

Example:
- {"url": "https://developer.huawei.com/consumer/cn/"}
- {"url": "https://example.com/oauth?code=abc", "mode": "system"}"#
            .to_string())
    }

    fn short_description(&self) -> String {
        "Open a URL for the user (built-in browser panel first, OS browser as fallback)."
            .to_string()
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The http(s) URL to open. A bare host such as `example.com` is normalized to https://."
                },
                "mode": {
                    "type": "string",
                    "enum": ["auto", "builtin", "system"],
                    "description": "Where to open the URL. `auto` (default) prefers the built-in browser panel and falls back to the OS browser; `builtin` forces the panel; `system` forces the OS browser."
                },
                "title": {
                    "type": "string",
                    "description": "Optional panel title for the built-in browser. Defaults to the URL host."
                }
            },
            "required": ["url"],
            "additionalProperties": false
        })
    }

    fn is_readonly(&self) -> bool {
        true
    }

    fn is_concurrency_safe(&self, _input: Option<&Value>) -> bool {
        true
    }

    async fn validate_input(
        &self,
        input: &Value,
        _context: Option<&ToolUseContext>,
    ) -> ValidationResult {
        let url = input.get("url").and_then(Value::as_str).unwrap_or("");
        if url.trim().is_empty() {
            return ValidationResult {
                result: false,
                message: Some("url must be a non-empty http(s) URL".to_string()),
                error_code: Some(400),
                meta: None,
            };
        }
        if let Err(error) = OpenUrlMode::parse(input.get("mode").and_then(Value::as_str)) {
            return ValidationResult {
                result: false,
                message: Some(error.to_string()),
                error_code: Some(400),
                meta: None,
            };
        }
        ValidationResult::default()
    }

    fn render_tool_use_message(&self, input: &Value, _options: &ToolRenderOptions) -> String {
        let url = input.get("url").and_then(Value::as_str).unwrap_or("");
        format!("Open URL: {url}")
    }

    fn render_tool_result_message(&self, output: &Value) -> String {
        output
            .get("opened_with")
            .and_then(Value::as_str)
            .map(|opened_with| format!("Opened URL via {opened_with}"))
            .unwrap_or_else(|| "URL opened".to_string())
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let raw_url = input.get("url").and_then(Value::as_str).unwrap_or("");
        let url = Self::normalize_url(raw_url)?;
        let mode = OpenUrlMode::parse(input.get("mode").and_then(Value::as_str))?;
        let title = Self::resolve_title(input, &url);

        let result = match mode {
            OpenUrlMode::Builtin => self.open_in_builtin_panel(&url, &title, context).await?,
            OpenUrlMode::System => Self::open_in_system_browser_result(&url).await?,
            OpenUrlMode::Auto => match self.open_in_builtin_panel(&url, &title, context).await {
                Ok(result) => result,
                Err(builtin_error) => {
                    log::warn!(
                        "OpenUrl built-in browser panel unavailable ({builtin_error}); falling back to the system browser"
                    );
                    Self::open_in_system_browser_result(&url).await?
                }
            },
        };

        Ok(vec![result])
    }
}

#[cfg(test)]
mod tests {
    use super::{OpenUrlMode, OpenUrlTool};
    use crate::agentic::tools::framework::{Tool, ToolUseContext};
    use bitfun_runtime_ports::ToolRuntimeHandles;
    use std::collections::HashMap;

    fn test_context() -> ToolUseContext {
        ToolUseContext {
            tool_call_id: None,
            agent_type: None,
            session_id: None,
            dialog_turn_id: None,
            workspace: None,
            loaded_deferred_tool_specs: Vec::new(),
            primary_model_facts: tool_runtime::context::PrimaryModelFacts::default(),
            custom_data: HashMap::new(),
            computer_use_host: None,
            runtime_tool_restrictions: Default::default(),
            runtime_handles: ToolRuntimeHandles::default(),
        }
    }

    #[test]
    fn normalize_url_adds_https_for_bare_hosts() {
        assert_eq!(
            OpenUrlTool::normalize_url("example.com").unwrap(),
            "https://example.com"
        );
    }

    #[test]
    fn normalize_url_keeps_http_scheme_and_trims() {
        assert_eq!(
            OpenUrlTool::normalize_url("  http://localhost:8080/cb?code=1 ").unwrap(),
            "http://localhost:8080/cb?code=1"
        );
    }

    #[test]
    fn normalize_url_rejects_non_web_schemes() {
        assert!(OpenUrlTool::normalize_url("file:///tmp/demo.html").is_err());
        assert!(OpenUrlTool::normalize_url("javascript:alert(1)").is_err());
        assert!(OpenUrlTool::normalize_url("   ").is_err());
    }

    #[test]
    fn mode_defaults_to_auto_and_rejects_unknown_values() {
        assert_eq!(OpenUrlMode::parse(None).unwrap(), OpenUrlMode::Auto);
        assert_eq!(
            OpenUrlMode::parse(Some(" SYSTEM ")).unwrap(),
            OpenUrlMode::System
        );
        assert!(OpenUrlMode::parse(Some("popup")).is_err());
    }

    #[test]
    fn title_defaults_to_url_host() {
        let input = serde_json::json!({ "url": "https://example.com/path" });
        assert_eq!(
            OpenUrlTool::resolve_title(&input, "https://example.com/path"),
            "example.com"
        );
        let titled = serde_json::json!({ "title": "Sign in" });
        assert_eq!(
            OpenUrlTool::resolve_title(&titled, "https://example.com/path"),
            "Sign in"
        );
    }

    #[cfg(feature = "runtime-services")]
    #[tokio::test]
    async fn builtin_mode_emits_the_builtin_browser_event() {
        let tool = OpenUrlTool::new();
        let results = tool
            .call_impl(
                &serde_json::json!({ "url": "example.com/login", "mode": "builtin" }),
                &test_context(),
            )
            .await
            .expect("built-in panel open should succeed without a frontend emitter");

        let data = results[0].content();
        assert_eq!(data["success"], true);
        assert_eq!(data["url"], "https://example.com/login");
        assert_eq!(data["opened_with"], "bitfun-builtin-browser");
        assert_eq!(data["observable_by_agent"], false);
    }
}
