//! Tools HostInvoke handlers for CLI Peer Host.

use serde_json::Value;

use openbitfun_core::agentic::tools::product_runtime::build_all_tools_info;

pub(crate) async fn get_chat_mcp_catalog(args: &Value) -> Result<Value, String> {
    let request = serde_json::from_value(crate::peer_host::args::request_value(args).clone())
        .map_err(|error| format!("Invalid MCP catalog request: {error}"))?;
    let catalog =
        openbitfun_core::agentic::tools::product_runtime::build_chat_mcp_catalog(request).await?;
    serde_json::to_value(catalog)
        .map_err(|error| format!("Failed to serialize MCP catalog: {error}"))
}

/// Read-only tool catalog for the Agents / Assistant Defaults UI.
///
/// CLI Host assembles the same Core tool registry as Desktop; this returns the
/// identical DTO shape so a controller cannot tell "CLI Host doesn't support
/// catalog query" from "the runtime really has no tools". Without this, the
/// controller's `get_all_tools_info` call would fall into the unsupported
/// dispatch branch and the UI would silently render an empty tool list.
pub(crate) async fn get_all_tools_info() -> Result<Value, String> {
    let tools = build_all_tools_info().await;
    serde_json::to_value(tools).map_err(|error| format!("Failed to serialize tool info: {error}"))
}

/// Query the host registry using the same visibility and remote-source rules as Desktop.
pub(crate) async fn list_subagents(command: &str, args: &Value) -> Result<Value, String> {
    use crate::peer_host::args::{get_string, optional_string, request_value};
    use openbitfun_core::agentic::agents::{SubagentListScope, SubagentQueryContext};
    let request = request_value(args);
    let parent = if command == "list_subagents" {
        None
    } else {
        Some(get_string(request, "parentAgentType")?)
    };
    let source: Option<openbitfun_core::agentic::agents::SubAgentSource> = request
        .get("source")
        .filter(|value| !value.is_null())
        .map(|value| serde_json::from_value(value.clone()))
        .transpose()
        .map_err(|error| format!("Invalid subagent source: {error}"))?;
    let visible = command == "list_visible_subagents";
    let workspace = optional_string(request, "workspacePath");
    let external_sources_supported = match workspace.as_deref() {
        Some(path) => {
            !openbitfun_core::service::remote_ssh::workspace_state::is_remote_path(path).await
        }
        None => true,
    };
    let workspace = workspace.map(std::path::PathBuf::from);
    let mut agents = openbitfun_core::agentic::get_agent_registry()
        .get_subagents_for_query(&SubagentQueryContext {
            parent_agent_type: parent.as_deref(),
            workspace_root: external_sources_supported
                .then_some(workspace.as_deref())
                .flatten(),
            list_scope: if visible {
                SubagentListScope::TaskVisible
            } else {
                SubagentListScope::RegistryManagement
            },
            include_disabled: !visible,
            external_sources_supported,
        })
        .await;
    if let Some(source) = source {
        agents.retain(|agent| agent.subagent_source.as_ref() == Some(&source));
    }
    serde_json::to_value(agents).map_err(|error| error.to_string())
}
