use crate::util::errors::{BitFunError, BitFunResult};
use bitfun_services_core::workspace_persistence as storage;
pub(crate) use bitfun_services_core::workspace_persistence::{
    RepairedLocalWorkspaceIdentity, WorkspacePersistenceData, WORKSPACE_PERSISTENCE_FORMAT_VERSION,
};
use std::path::Path;

pub(crate) fn validate_workspace_persistence_data(
    data: &WorkspacePersistenceData,
    miniapp_root: &Path,
) -> BitFunResult<()> {
    storage::validate_workspace_persistence_data(data, miniapp_root).map_err(Into::into)
}
/// Converge local workspace records with the canonical identity of their root
/// before the registry is validated. A record can be persisted while its
/// directory does not exist yet, so rejecting that record would fail startup for
/// data this product wrote itself.
pub(crate) fn repair_local_workspace_identities(
    data: &mut WorkspacePersistenceData,
) -> Vec<RepairedLocalWorkspaceIdentity> {
    storage::repair_local_workspace_identities(data)
}
pub(crate) fn unsupported_workspace_persistence(detail: impl AsRef<str>) -> BitFunError {
    storage::unsupported_workspace_persistence(detail).into()
}
