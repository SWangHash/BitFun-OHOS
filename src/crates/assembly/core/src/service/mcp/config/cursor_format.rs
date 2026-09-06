use crate::service::mcp::server::MCPServerConfig;
use crate::service::mcp::ConfigLocation;
use crate::util::errors::OpenBitFunResult;

pub(super) fn config_to_cursor_format(config: &MCPServerConfig) -> serde_json::Value {
    openbitfun_services_integrations::mcp::config::config_to_cursor_format(config)
}

pub(super) fn parse_cursor_format(
    config: &serde_json::Value,
    default_location: ConfigLocation,
) -> OpenBitFunResult<Vec<MCPServerConfig>> {
    Ok(openbitfun_services_integrations::mcp::config::parse_cursor_format(
        config,
        default_location,
    ))
}
