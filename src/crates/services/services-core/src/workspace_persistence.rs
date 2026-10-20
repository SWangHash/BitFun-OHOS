//! Current Workspace registry persistence contract and validation.

use crate::storage_error::{StorageError as BitFunError, StorageResult as BitFunResult};
use crate::workspace_identity::{
    canonicalize_local_workspace_root, local_workspace_stable_storage_id,
    normalize_remote_workspace_path, remote_workspace_stable_id, LOCAL_WORKSPACE_SSH_HOST,
};
use crate::workspace_records::{PrimaryAssistantKey, WorkspaceInfo, WorkspaceKind};
use bitfun_core_types::product_identity::product_id;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;

pub const WORKSPACE_PERSISTENCE_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspacePersistenceData {
    #[serde(default)]
    pub format_version: u32,
    #[serde(default)]
    pub product_id: String,
    pub workspaces: HashMap<String, WorkspaceInfo>,
    #[serde(default)]
    pub opened_workspace_ids: Vec<String>,
    pub current_workspace_id: Option<String>,
    #[serde(default)]
    pub recent_workspaces: Vec<String>,
    #[serde(default)]
    pub recent_assistant_workspaces: Vec<String>,
    #[serde(default)]
    pub primary_assistant_key: Option<PrimaryAssistantKey>,
    /// High-water mark: deleting an assistant must not recycle its name number.
    #[serde(default)]
    pub assistant_name_sequence: u64,
    pub saved_at: chrono::DateTime<chrono::Utc>,
}

pub fn current_workspace_storage_id(workspace: &WorkspaceInfo) -> BitFunResult<String> {
    match workspace.workspace_kind {
        WorkspaceKind::Remote => {
            let ssh_host = workspace
                .metadata
                .get("sshHost")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    unsupported_workspace_persistence(format!(
                        "remote workspace '{}' is missing sshHost",
                        workspace.id
                    ))
                })?;
            workspace.remote_ssh_connection_id().ok_or_else(|| {
                unsupported_workspace_persistence(format!(
                    "remote workspace '{}' is missing connectionId",
                    workspace.id
                ))
            })?;

            let stored_root = workspace.root_path.to_string_lossy().replace('\\', "/");
            let normalized_root = normalize_remote_workspace_path(&stored_root);
            if !normalized_root.starts_with('/') {
                return Err(unsupported_workspace_persistence(format!(
                    "remote workspace '{}' does not use an absolute POSIX root",
                    workspace.id
                )));
            }
            if stored_root != normalized_root {
                return Err(unsupported_workspace_persistence(format!(
                    "remote workspace '{}' rootPath is not normalized",
                    workspace.id
                )));
            }
            Ok(remote_workspace_stable_id(ssh_host, &normalized_root))
        }
        WorkspaceKind::Normal | WorkspaceKind::Assistant => {
            let ssh_host = workspace
                .metadata
                .get("sshHost")
                .and_then(|value| value.as_str())
                .map(str::trim);
            if ssh_host != Some(LOCAL_WORKSPACE_SSH_HOST) {
                return Err(unsupported_workspace_persistence(format!(
                    "local workspace '{}' does not declare sshHost=localhost",
                    workspace.id
                )));
            }
            expected_persisted_local_workspace_id(&workspace.root_path).map_err(|error| {
                unsupported_workspace_persistence(format!(
                    "local workspace '{}' is not canonical: {error}",
                    workspace.id
                ))
            })
        }
    }
}

pub fn validate_workspace_persistence_data(
    data: &WorkspacePersistenceData,
    _miniapps_root: &Path,
) -> BitFunResult<()> {
    if data.format_version != WORKSPACE_PERSISTENCE_FORMAT_VERSION {
        return Err(unsupported_workspace_persistence(format!(
            "format_version {} is not supported; expected {}",
            data.format_version, WORKSPACE_PERSISTENCE_FORMAT_VERSION
        )));
    }
    if data.product_id != product_id() {
        return Err(unsupported_workspace_persistence(format!(
            "product_id '{}' does not match '{}'",
            data.product_id,
            product_id()
        )));
    }

    for (storage_id, workspace) in &data.workspaces {
        if storage_id != &workspace.id {
            return Err(unsupported_workspace_persistence(format!(
                "workspace map key '{storage_id}' does not match record id '{}'",
                workspace.id
            )));
        }
        let expected_id = current_workspace_storage_id(workspace)?;
        if storage_id != &expected_id {
            return Err(unsupported_workspace_persistence(format!(
                "workspace id '{storage_id}' is not canonical; expected '{expected_id}'"
            )));
        }
    }
    validate_workspace_reference_list(
        &data.workspaces,
        &data.opened_workspace_ids,
        "opened_workspace_ids",
    )?;
    validate_workspace_reference_list(
        &data.workspaces,
        &data.recent_workspaces,
        "recent_workspaces",
    )?;
    validate_workspace_reference_list(
        &data.workspaces,
        &data.recent_assistant_workspaces,
        "recent_assistant_workspaces",
    )?;

    for id in &data.recent_workspaces {
        let workspace = &data.workspaces[id];
        if workspace.workspace_kind == WorkspaceKind::Assistant {
            return Err(unsupported_workspace_persistence(format!(
                "recent_workspaces contains assistant workspace '{id}'"
            )));
        }
        // Older current-format catalogs included MiniApp directories in recent
        // history. This is a presentation concern, not an invalid record: the
        // runtime filters that history while preserving the workspace identity.
    }
    for id in &data.recent_assistant_workspaces {
        if data.workspaces[id].workspace_kind != WorkspaceKind::Assistant {
            return Err(unsupported_workspace_persistence(format!(
                "recent_assistant_workspaces contains non-assistant workspace '{id}'"
            )));
        }
    }

    if let Some(current_id) = data.current_workspace_id.as_deref() {
        if !data.workspaces.contains_key(current_id) {
            return Err(unsupported_workspace_persistence(format!(
                "current_workspace_id references unknown workspace id '{current_id}'"
            )));
        }
        if !data.opened_workspace_ids.iter().any(|id| id == current_id) {
            return Err(unsupported_workspace_persistence(format!(
                "current workspace '{current_id}' is not present in opened_workspace_ids"
            )));
        }
    }

    Ok(())
}

fn expected_persisted_local_workspace_id(root_path: &Path) -> Result<String, String> {
    if !root_path.is_absolute() {
        return Err(format!(
            "local workspace rootPath is not absolute: {}",
            root_path.display()
        ));
    }

    let normalized_root = if root_path.exists() {
        let (canonical_root, normalized_root) = canonicalize_local_workspace_root(root_path)?;
        if canonical_root != root_path {
            return Err(format!(
                "local workspace rootPath is not canonical: {}",
                root_path.display()
            ));
        }
        normalized_root
    } else {
        root_path.to_string_lossy().replace('\\', "/")
    };

    Ok(local_workspace_stable_storage_id(&normalized_root))
}

fn validate_workspace_reference_list(
    workspaces: &HashMap<String, WorkspaceInfo>,
    ids: &[String],
    field: &str,
) -> BitFunResult<()> {
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id.as_str()) {
            return Err(unsupported_workspace_persistence(format!(
                "{field} contains duplicate workspace id '{id}'"
            )));
        }
        if !workspaces.contains_key(id) {
            return Err(unsupported_workspace_persistence(format!(
                "{field} references unknown workspace id '{id}'"
            )));
        }
    }
    Ok(())
}

pub fn unsupported_workspace_persistence(detail: impl AsRef<str>) -> BitFunError {
    BitFunError::config(format!(
        "Unsupported workspace persistence format: {}. The persisted file was left unchanged; explicit data migration is required",
        detail.as_ref()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legacy_catalog() -> WorkspacePersistenceData {
        // Existing 1.0.0 record shape: no new identity or availability fields.
        serde_json::from_value(serde_json::json!({
            "format_version": 1, "product_id": product_id(),
            "workspaces": {
                "saved-id": {
                    "id": "saved-id", "name": "Offline workspace", "rootPath": "/offline/repo",
                    "workspaceType": "Other", "workspaceKind": "remote", "status": "Inactive",
                    "languages": [], "openedAt": "2026-09-16T00:00:00Z", "lastAccessed": "2026-09-16T00:00:00Z",
                    "description": null, "tags": [], "statistics": null, "metadata": {}
                }
            },
            "opened_workspace_ids": [], "current_workspace_id": null,
            "recent_workspaces": ["saved-id"], "saved_at": "2026-09-16T00:00:00Z"
        })).unwrap()
    }

    #[test]
    fn old_remote_record_without_credentials_survives_registry_round_trip() {
        let data = legacy_catalog();
        assert_eq!(data.assistant_name_sequence, 0);
        validate_workspace_persistence_data(&data, Path::new("/miniapps")).unwrap();
        let round_trip: WorkspacePersistenceData =
            serde_json::from_value(serde_json::to_value(&data).unwrap()).unwrap();
        let record = &round_trip.workspaces["saved-id"];
        assert_eq!(record.workspace_kind, WorkspaceKind::Remote);
        assert!(
            record.filesystem_connection_id().is_err(),
            "activation must remain unavailable, never local"
        );
        assert_eq!(record.id, "saved-id");
        assert_eq!(round_trip.recent_workspaces, vec!["saved-id"]);
        assert_eq!(round_trip.assistant_name_sequence, 0);
    }

    #[test]
    fn persisted_id_does_not_depend_on_path_or_stale_ssh_metadata() {
        let mut data = legacy_catalog();
        let record = data.workspaces.get_mut("saved-id").unwrap();
        record.workspace_kind = WorkspaceKind::Normal;
        record.root_path = "/moved/repo".into();
        record
            .metadata
            .insert("connectionId".into(), serde_json::json!("stale-ssh"));
        validate_workspace_persistence_data(&data, Path::new("/miniapps")).unwrap();
        assert_eq!(
            data.workspaces["saved-id"]
                .filesystem_connection_id()
                .unwrap(),
            None
        );
        assert_eq!(data.workspaces["saved-id"].id, "saved-id");
    }

    #[test]
    fn legacy_miniapp_recent_record_survives_round_trip() {
        let mut payload = serde_json::to_value(legacy_catalog()).unwrap();
        payload["workspaces"]["saved-id"]["workspaceKind"] = "normal".into();
        payload["workspaces"]["saved-id"]["rootPath"] = "/miniapps/deck/appdata".into();
        let data: WorkspacePersistenceData = serde_json::from_value(payload).unwrap();
        validate_workspace_persistence_data(&data, Path::new("/miniapps")).unwrap();
        let round_trip: WorkspacePersistenceData =
            serde_json::from_value(serde_json::to_value(&data).unwrap()).unwrap();
        assert_eq!(
            serde_json::to_value(&round_trip).unwrap(),
            serde_json::to_value(&data).unwrap()
        );
        assert_eq!(round_trip.recent_workspaces, vec!["saved-id"]);
    }

    #[test]
    fn mismatched_record_id_is_rejected_without_modifying_input() {
        let mut data = legacy_catalog();
        data.workspaces.get_mut("saved-id").unwrap().id = "another-id".into();
        let before = serde_json::to_value(&data).unwrap();
        assert!(validate_workspace_persistence_data(&data, Path::new("/miniapps")).is_err());
        assert_eq!(serde_json::to_value(&data).unwrap(), before);
    }
}
