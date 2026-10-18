//! Runtime-free DevEco Code source adaptation and its account API boundary.
//!
//! Static discovery preserves the ordinary CLI V1 configuration shape. It does
//! not execute plugins, tools or hooks, connect MCP servers, or read credentials.

mod agent_source;
#[cfg(feature = "auth")]
pub mod auth;
mod command_source;
mod instruction_source;
mod local_source_paths;
mod mcp_source;
mod skill_source;

pub use agent_source::{DevEcoCodeSubagentProvider, DevEcoCodeSubagentProviderOptions};
pub use command_source::{DevEcoCodeCommandProvider, DevEcoCodeCommandProviderOptions};
pub use instruction_source::{load_deveco_user_instructions, DevEcoCodeInstructionSourceOptions};
pub use mcp_source::{DevEcoCodeMcpProvider, DevEcoCodeMcpProviderOptions};
pub use skill_source::{
    DevEcoCodeConfiguredSkillRoot, DevEcoCodeSkillRootDiagnostic, DevEcoCodeSkillRootProvider,
    DevEcoCodeSkillRootProviderOptions, DevEcoCodeSkillRootReport,
};
