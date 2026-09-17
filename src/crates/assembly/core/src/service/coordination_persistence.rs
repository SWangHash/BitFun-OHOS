use crate::util::errors::BitFunResult;
use bitfun_services_core::coordination_persistence as storage;
use rusqlite::Connection;

pub(crate) fn initialize_coordination_schema(connection: &Connection) -> BitFunResult<()> {
    storage::initialize_coordination_schema(connection).map_err(Into::into)
}
pub(crate) fn validate_coordination_agent_id(agent_id: &str) -> BitFunResult<()> {
    storage::validate_coordination_agent_id(agent_id).map_err(Into::into)
}
