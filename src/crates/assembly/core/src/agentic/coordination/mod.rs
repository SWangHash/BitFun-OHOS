//! Coordination layer
//!
//! Top-level component that integrates all subsystems

mod background_outcomes;
mod control_conversation;
mod coordination_store;
// Runtime Qt toolchain provisioning for the `__official__` migration binding.
// It reaches the integration service owner crate, so the whole module is owned
// by the `qt-toolchain` feature: without it the coordinator keeps the previous
// behaviour (the submitted answers are delivered immediately).
#[cfg(feature = "qt-toolchain")]
mod qt_toolchain_provisioning;
mod delegation_context;
pub use control_conversation::{
    ControlConversation, CreateControlConversationRequest, VoiceExchangeRequest,
};
pub mod coordinator;
// The generation-mismatch gate between the bound project and the bound toolchain.
// Feature-independent: it degrades to `Unknown` for facts this build cannot measure
// (the official package without the provisioning capability), it never disables the
// check for the values it can read from disk.
mod qt_migration_version_gate;
pub mod scheduler;
pub mod state_manager;
pub mod turn_outcome;
mod turn_settlement;

pub use coordinator::*;
pub use scheduler::*;
pub use state_manager::*;
pub use turn_outcome::*;

pub(crate) use background_outcomes::{
    BackgroundSubagentOutcome, BackgroundSubagentOutcomeStore, BackgroundSubagentWaitMode,
    BackgroundSubagentWaitResult, BackgroundSubagentWaitStatus,
};
pub(crate) use coordination_store::{validate_agent_id, DirectChildAgentRecord};
pub(crate) use qt_migration_version_gate::{
    apply_version_strategy_answer, official_qt_major, record_version_mismatch_if_any,
};

pub use coordinator::get_global_coordinator;
pub use scheduler::get_global_scheduler;
