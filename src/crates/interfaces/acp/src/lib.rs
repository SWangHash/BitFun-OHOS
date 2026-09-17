//! BitFun Agent Client Protocol integration.
//!
//! This crate owns the ACP client and server surfaces over BitFun's assembled
//! runtime. Product hosts select the additive `client` and `server` features
//! explicitly; the compatibility default enables both roles.

// Server prompt futures include the assembled runtime and instruction discovery.
#![cfg_attr(feature = "server", recursion_limit = "256")]

#[cfg(feature = "client")]
pub mod client;
#[cfg(feature = "server")]
mod runtime;
#[cfg(feature = "server")]
mod server;

pub use agent_client_protocol as protocol;
#[cfg(feature = "client")]
pub use client::AcpClientService;
#[cfg(feature = "server")]
pub use runtime::BitFunAcpRuntime;
#[cfg(feature = "server")]
pub use server::AcpServer;
