//! Current Workspace registry persistence contract and validation.

use crate::storage_error::{StorageError as BitFunError, StorageResult as BitFunResult};
use crate::workspace_identity::{
    canonicalize_local_workspace_root_allowing_missing, local_workspace_stable_storage_id,
    normalize_remote_workspace_path, remote_workspace_stable_id, LOCAL_WORKSPACE_SSH_HOST,
};
use crate::workspace_records::{PrimaryAssistantKey, WorkspaceInfo, WorkspaceKind};
use bitfun_core_types::product_identity::product_id;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

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
    miniapps_root: &Path,
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
        if workspace.root_path.starts_with(miniapps_root) {
            return Err(unsupported_workspace_persistence(format!(
                "recent_workspaces contains MiniApp-owned workspace '{id}'"
            )));
        }
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

/// A local workspace record whose persisted identity was reconciled with the
/// canonical root of its directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepairedLocalWorkspaceIdentity {
    pub previous_id: String,
    pub canonical_id: String,
    pub previous_root: PathBuf,
    pub canonical_root: PathBuf,
    /// The canonical record already existed: the stale duplicate record was
    /// dropped and its references now point at the canonical one.
    pub duplicate_record_removed: bool,
}

/// Reconcile local workspace records with the canonical identity of their root.
///
/// A local workspace record can be persisted before its directory exists (the
/// legacy data migrator installs a relocated assistant tree at commit time),
/// and records written by builds that stored the un-resolved root keep that
/// form. Either way the persisted `rootPath`/id can lag the canonical identity
/// of the same directory, which [`validate_workspace_persistence_data`]
/// rejects. Converge those records in place, remap every reference list, and
/// report what changed: the alternative is failing startup or dropping user
/// data for a record this product wrote itself.
pub fn repair_local_workspace_identities(
    data: &mut WorkspacePersistenceData,
) -> Vec<RepairedLocalWorkspaceIdentity> {
    let mut previous_ids: Vec<String> = data
        .workspaces
        .iter()
        .filter(|(_, workspace)| {
            matches!(
                workspace.workspace_kind,
                WorkspaceKind::Normal | WorkspaceKind::Assistant
            )
        })
        .map(|(id, _)| id.clone())
        .collect();
    // Deterministic order keeps the repair, and the report it produces, reproducible.
    previous_ids.sort();

    let mut repairs = Vec::new();
    let mut remapped_ids: HashMap<String, String> = HashMap::new();
    for previous_id in previous_ids {
        let Some(record) = data.workspaces.get(&previous_id).cloned() else {
            continue;
        };
        let Ok((canonical_root, canonical_id)) =
            canonical_local_workspace_identity(&record.root_path)
        else {
            // A root that cannot be resolved at all keeps its record; validation
            // reports it with its own diagnostic.
            continue;
        };
        if canonical_root == record.root_path && canonical_id == previous_id {
            continue;
        }

        let replaced_by_canonical_record =
            canonical_id != previous_id && data.workspaces.contains_key(&canonical_id);
        data.workspaces.remove(&previous_id);
        if !replaced_by_canonical_record {
            let mut canonical_record = record.clone();
            canonical_record.id = canonical_id.clone();
            canonical_record.root_path = canonical_root.clone();
            data.workspaces
                .insert(canonical_id.clone(), canonical_record);
        }

        repairs.push(RepairedLocalWorkspaceIdentity {
            previous_id: previous_id.clone(),
            canonical_id: canonical_id.clone(),
            previous_root: record.root_path,
            canonical_root,
            duplicate_record_removed: replaced_by_canonical_record,
        });
        remapped_ids.insert(previous_id, canonical_id);
    }

    if !remapped_ids.is_empty() {
        remap_local_workspace_references(data, &remapped_ids);
    }
    repairs
}

fn remap_local_workspace_references(
    data: &mut WorkspacePersistenceData,
    remapped_ids: &HashMap<String, String>,
) {
    for list in [
        &mut data.opened_workspace_ids,
        &mut data.recent_workspaces,
        &mut data.recent_assistant_workspaces,
    ] {
        let mut seen = HashSet::new();
        *list = list
            .drain(..)
            .map(|id| remapped_ids.get(&id).cloned().unwrap_or(id))
            .filter(|id| seen.insert(id.clone()))
            .collect();
    }

    let canonical_current_id = data
        .current_workspace_id
        .as_deref()
        .and_then(|id| remapped_ids.get(id).cloned());
    if let Some(canonical_id) = canonical_current_id {
        data.current_workspace_id = Some(canonical_id);
    }

    // Worktree relationships persist a workspace id, so they still name the
    // previous id after the record itself moved.
    for record in data.workspaces.values_mut() {
        let Some(worktree) = record.worktree.as_mut() else {
            continue;
        };
        let canonical_main_id = worktree
            .main_workspace_id
            .as_deref()
            .and_then(|id| remapped_ids.get(id).cloned());
        if let Some(canonical_main_id) = canonical_main_id {
            worktree.main_workspace_id = Some(canonical_main_id);
        }
    }
}

/// Canonical root and stable id of a local workspace directory.
fn canonical_local_workspace_identity(root_path: &Path) -> Result<(PathBuf, String), String> {
    if !root_path.is_absolute() {
        return Err(format!(
            "local workspace rootPath is not absolute: {}",
            root_path.display()
        ));
    }

    let (canonical_root, normalized_root) =
        canonicalize_local_workspace_root_allowing_missing(root_path)?;
    Ok((
        canonical_root,
        local_workspace_stable_storage_id(&normalized_root),
    ))
}

fn expected_persisted_local_workspace_id(root_path: &Path) -> Result<String, String> {
    let (canonical_root, canonical_id) = canonical_local_workspace_identity(root_path)?;
    if canonical_root != root_path {
        return Err(format!(
            "local workspace rootPath is not canonical: {}",
            root_path.display()
        ));
    }
    Ok(canonical_id)
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
    use crate::workspace_identity::canonicalize_local_workspace_root;
    use crate::workspace_records::WorkspaceWorktreeInfo;
    use std::fs;

    fn local_workspace_record(id: &str, root_path: &Path) -> WorkspaceInfo {
        serde_json::from_value(serde_json::json!({
            "id": id,
            "name": "Local fixture",
            "rootPath": root_path,
            "workspaceType": "Other",
            "workspaceKind": "normal",
            "status": "Inactive",
            "languages": [],
            "openedAt": "2026-01-01T00:00:00Z",
            "lastAccessed": "2026-01-01T00:00:00Z",
            "description": null,
            "tags": [],
            "statistics": null,
            "relatedPaths": [],
            "metadata": { "sshHost": "localhost" }
        }))
        .expect("local workspace fixture")
    }

    fn registry(
        records: &[(&str, WorkspaceInfo)],
        opened_ids: &[&str],
        current_id: Option<&str>,
    ) -> WorkspacePersistenceData {
        WorkspacePersistenceData {
            format_version: WORKSPACE_PERSISTENCE_FORMAT_VERSION,
            product_id: product_id().to_string(),
            workspaces: records
                .iter()
                .map(|(id, record)| ((*id).to_string(), record.clone()))
                .collect(),
            opened_workspace_ids: opened_ids.iter().map(|id| (*id).to_string()).collect(),
            current_workspace_id: current_id.map(str::to_string),
            recent_workspaces: Vec::new(),
            recent_assistant_workspaces: Vec::new(),
            primary_assistant_key: None,
            saved_at: chrono::Utc::now(),
        }
    }

    fn canonical_root_string(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "/")
    }

    fn canonical_root_id(path: &Path) -> String {
        local_workspace_stable_storage_id(&canonical_root_string(path))
    }

    fn canonical_temp_home(home: &tempfile::TempDir) -> PathBuf {
        canonicalize_local_workspace_root(home.path())
            .expect("canonical temp home")
            .0
    }

    #[cfg(unix)]
    fn create_dir_symlink(target: &Path, link: &Path) -> bool {
        std::os::unix::fs::symlink(target, link).is_ok()
    }

    #[cfg(windows)]
    fn create_dir_symlink(target: &Path, link: &Path) -> bool {
        std::os::windows::fs::symlink_dir(target, link).is_ok()
    }

    /// Records are written while their root may not exist yet (the migrator
    /// installs the relocated assistant tree at commit time), so the same record
    /// must keep one identity across that creation.
    #[test]
    fn local_workspace_identity_is_stable_before_and_after_the_root_exists() {
        let home = tempfile::tempdir().expect("temp home");
        let home_root = canonical_temp_home(&home);
        let root = home_root.join(".bitfun/personal_assistant/workspace-assistant");

        let mut record = local_workspace_record("local_placeholder", &root);
        let planned_id = current_workspace_storage_id(&record).expect("planned id");
        record.id = planned_id.clone();
        assert_eq!(record.root_path, root);
        assert_eq!(planned_id, canonical_root_id(&root));

        let data = registry(&[(&planned_id, record)], &[&planned_id], Some(&planned_id));
        validate_workspace_persistence_data(&data, &home_root)
            .expect("a record for a not-yet-created root validates");

        fs::create_dir_all(&root).expect("create the local workspace root");
        validate_workspace_persistence_data(&data, &home_root)
            .expect("the same record still validates once the root exists");
        assert_eq!(
            current_workspace_storage_id(&data.workspaces[&planned_id]).expect("created id"),
            planned_id
        );
    }

    /// A record persisted with an id that is not the canonical one is converged
    /// instead of blocking startup or dropping the workspace.
    #[test]
    fn stale_local_workspace_records_are_repaired_in_place() {
        let home = tempfile::tempdir().expect("temp home");
        let home_root = canonical_temp_home(&home);
        let root = home_root.join("workspace");
        fs::create_dir_all(&root).expect("workspace root");

        let stale_id = "local_stale_identity".to_string();
        let mut record = local_workspace_record(&stale_id, &root);
        record.id = stale_id.clone();
        let mut data = registry(&[(&stale_id, record)], &[&stale_id], Some(&stale_id));

        let error = validate_workspace_persistence_data(&data, &home_root)
            .expect_err("a stale local workspace id is rejected before repair");
        assert!(error.to_string().contains("is not canonical"), "{error}");

        let canonical_id = canonical_root_id(&root);
        let repairs = repair_local_workspace_identities(&mut data);
        assert_eq!(repairs.len(), 1);
        assert_eq!(repairs[0].previous_id, stale_id);
        assert_eq!(repairs[0].canonical_id, canonical_id);
        assert_eq!(repairs[0].previous_root, root);
        assert_eq!(repairs[0].canonical_root, root);
        assert!(!repairs[0].duplicate_record_removed);

        assert!(!data.workspaces.contains_key(&stale_id));
        assert_eq!(data.workspaces[&canonical_id].root_path, root);
        assert_eq!(data.opened_workspace_ids, vec![canonical_id.clone()]);
        assert_eq!(
            data.current_workspace_id.as_deref(),
            Some(canonical_id.as_str())
        );
        validate_workspace_persistence_data(&data, &home_root)
            .expect("repaired registry validates");
    }

    /// Two records for one directory keep the canonical one, and every reference
    /// follows it, so the repair never loses the current or opened selection.
    #[test]
    fn duplicate_local_workspace_records_are_merged_into_the_canonical_one() {
        let home = tempfile::tempdir().expect("temp home");
        let home_root = canonical_temp_home(&home);
        let root = home_root.join("workspace");
        fs::create_dir_all(&root).expect("workspace root");

        let canonical_id = canonical_root_id(&root);
        let stale_id = "local_stale_identity";
        let stale = local_workspace_record(stale_id, &root);
        let canonical = local_workspace_record(&canonical_id, &root);
        let mut data = registry(
            &[(&canonical_id, canonical), (stale_id, stale)],
            &[stale_id, &canonical_id],
            Some(stale_id),
        );

        let repairs = repair_local_workspace_identities(&mut data);
        assert_eq!(repairs.len(), 1);
        assert!(repairs[0].duplicate_record_removed);
        assert_eq!(data.workspaces.len(), 1);
        assert!(data.workspaces.contains_key(&canonical_id));
        assert_eq!(data.opened_workspace_ids, vec![canonical_id.clone()]);
        assert_eq!(
            data.current_workspace_id.as_deref(),
            Some(canonical_id.as_str())
        );
        validate_workspace_persistence_data(&data, &home_root).expect("merged registry validates");
    }

    /// A worktree record names its main workspace by id, so that reference has
    /// to follow the repaired id.
    #[test]
    fn worktree_references_follow_the_repaired_workspace_id() {
        let home = tempfile::tempdir().expect("temp home");
        let home_root = canonical_temp_home(&home);
        let root = home_root.join("workspace");
        let worktree_root = home_root.join("workspace-worktree");
        fs::create_dir_all(&root).expect("workspace root");
        fs::create_dir_all(&worktree_root).expect("worktree root");

        let stale_id = "local_stale_identity".to_string();
        let mut main_record = local_workspace_record(&stale_id, &root);
        main_record.id = stale_id.clone();

        let worktree_id = canonical_root_id(&worktree_root);
        let mut worktree_record = local_workspace_record(&worktree_id, &worktree_root);
        worktree_record.worktree = Some(WorkspaceWorktreeInfo {
            main_workspace_id: Some(stale_id.clone()),
            path: worktree_root.to_string_lossy().into_owned(),
            branch: None,
            main_repo_path: root.to_string_lossy().into_owned(),
            is_main: false,
        });

        let mut data = registry(
            &[(&stale_id, main_record), (&worktree_id, worktree_record)],
            &[&stale_id],
            Some(&stale_id),
        );

        let canonical_id = canonical_root_id(&root);
        let repairs = repair_local_workspace_identities(&mut data);
        assert_eq!(repairs.len(), 1);
        assert_eq!(
            data.workspaces[&worktree_id]
                .worktree
                .as_ref()
                .and_then(|worktree| worktree.main_workspace_id.as_deref()),
            Some(canonical_id.as_str())
        );
        validate_workspace_persistence_data(&data, &home_root)
            .expect("repaired registry validates");
    }

    /// A workspace root recorded through a directory link, plus the canonical
    /// root the same directory resolves to. `None` when the platform refuses
    /// directory links, which is the case for an unprivileged Windows account.
    fn linked_workspace_roots(home: &tempfile::TempDir) -> Option<(PathBuf, PathBuf, PathBuf)> {
        let home_root = canonical_temp_home(home);
        let physical_root = home_root.join("physical");
        fs::create_dir_all(physical_root.join("workspace")).expect("workspace root");
        let linked_root = home_root.join("linked");
        if !create_dir_symlink(&physical_root, &linked_root) {
            return None;
        }
        Some((
            home_root,
            linked_root.join("workspace"),
            physical_root.join("workspace"),
        ))
    }

    /// The persisted root form can resolve elsewhere once the directory exists,
    /// which is what a home directory reached through a link looks like. That
    /// record must be converged to the canonical root.
    #[test]
    fn non_canonical_local_workspace_roots_are_repaired_instead_of_rejected() {
        let home = tempfile::tempdir().expect("temp home");
        let Some((home_root, recorded_root, resolved_root)) = linked_workspace_roots(&home) else {
            return;
        };

        // The id was derived from the recorded root, so both the root and the id
        // have to be reconciled.
        let stale_id = canonical_root_id(&recorded_root);
        let mut record = local_workspace_record(&stale_id, &recorded_root);
        record.id = stale_id.clone();
        let mut data = registry(&[(&stale_id, record)], &[&stale_id], None);

        validate_workspace_persistence_data(&data, &home_root)
            .expect_err("a root reached through a link is not the canonical form");

        let repairs = repair_local_workspace_identities(&mut data);
        assert_eq!(repairs.len(), 1);
        assert_eq!(repairs[0].previous_root, recorded_root);
        assert_eq!(repairs[0].canonical_root, resolved_root);
        assert_eq!(repairs[0].canonical_id, canonical_root_id(&resolved_root));
        assert!(!repairs[0].duplicate_record_removed);
        assert_eq!(
            data.workspaces[&repairs[0].canonical_id].root_path,
            resolved_root
        );
        validate_workspace_persistence_data(&data, &home_root)
            .expect("repaired registry validates");
    }

    /// The id can already be the canonical one while the persisted root is still
    /// the unresolved form. Repairing that updates the root and must keep the
    /// record, never treat it as its own duplicate and drop it.
    #[test]
    fn canonical_local_workspace_id_with_unresolved_root_keeps_the_record() {
        let home = tempfile::tempdir().expect("temp home");
        let Some((home_root, recorded_root, resolved_root)) = linked_workspace_roots(&home) else {
            return;
        };

        let canonical_id = canonical_root_id(&resolved_root);
        let mut record = local_workspace_record(&canonical_id, &recorded_root);
        record.id = canonical_id.clone();
        let mut data = registry(&[(&canonical_id, record)], &[&canonical_id], None);

        let repairs = repair_local_workspace_identities(&mut data);
        assert_eq!(repairs.len(), 1);
        assert_eq!(repairs[0].previous_id, canonical_id);
        assert_eq!(repairs[0].canonical_id, canonical_id);
        assert_eq!(repairs[0].previous_root, recorded_root);
        assert!(!repairs[0].duplicate_record_removed);
        assert_eq!(data.workspaces.len(), 1);
        assert_eq!(data.workspaces[&canonical_id].root_path, resolved_root);
        assert_eq!(data.opened_workspace_ids, vec![canonical_id.clone()]);
        validate_workspace_persistence_data(&data, &home_root)
            .expect("repaired registry validates");
    }
}
