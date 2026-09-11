//! One-time migration of the legacy HarmonyOS BitFun home directory.
//!
//! HarmonyOS builds before `oh_1.0.6` stored the `.bitfun` runtime home
//! (sessions, projects, assistant workspaces) inside the app sandbox at
//! `/data/storage/el2/base/files/home_dir/.bitfun`. Later builds resolve the
//! home via `dirs::home_dir()`, which yields `/storage/Users/currentUser/.bitfun`
//! on HarmonyOS. This module copies the legacy home into the new home the
//! first time the new layout is used, so existing users keep their
//! conversations without any visible action.
//!
//! Design constraints:
//! - Merge, never overwrite: files that already exist under the new home win.
//! - Best effort: any failure is logged in English and skipped; the app must
//!   still start. User data stays intact under the legacy directory.
//! - Run once per entry: a per-entry marker records completed top-level
//!   entries; the legacy home is renamed to `<name>.migrated-<timestamp>`
//!   only after every required entry migrated, so recovery stays possible.
//! - Cross-process safe: a lock file makes concurrent app instances retry
//!   later instead of racing on the same copy.

use crate::infrastructure::PathManager;
use crate::util::errors::{BitFunError, BitFunResult};
use log::{debug, error, info, warn};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Top-level legacy entries that must be fully migrated before the legacy
/// home may be renamed. Anything else (logs, temp) is best-effort.
const REQUIRED_SOURCE_ENTRIES: [&str; 2] = ["projects", "personal_assistant"];

const COPY_MARKER_SUFFIX: &str = ".migrated-entry";
const COMPLETION_MARKER: &str = ".migrated-to-user-home";
const LOCK_FILE: &str = ".migration-in-progress";

/// Return the legacy HarmonyOS sandbox home, if this process runs on a
/// HarmonyOS build that previously used the hardcoded sandbox layout.
///
/// Returns `None` on non-HarmonyOS targets, on fresh installs, and on
/// devices whose legacy home was already renamed after a successful
/// migration.
#[cfg(target_env = "ohos")]
pub fn legacy_ohos_home() -> Option<PathBuf> {
    let candidate = PathBuf::from("/data/storage/el2/base/files/home_dir/.bitfun");
    if candidate.is_dir() {
        Some(candidate)
    } else {
        None
    }
}

#[cfg(not(target_env = "ohos"))]
pub fn legacy_ohos_home() -> Option<PathBuf> {
    None
}

/// Migrate the legacy home into the current home when needed.
///
/// Called during global path manager initialization. Failures are logged and
/// swallowed: startup must never block on migration.
pub fn migrate_legacy_home_if_needed(path_manager: &PathManager) {
    let Some(legacy_home) = legacy_ohos_home() else {
        return;
    };

    let new_home = path_manager.bitfun_home_dir();
    if legacy_home == new_home {
        return;
    }

    match run_migration(&legacy_home, &new_home, &REQUIRED_SOURCE_ENTRIES) {
        Ok(summary) => {
            if summary.copied_files > 0 || summary.renamed {
                info!(
                    "Legacy home migration finished: source={}, target={}, copied_files={}, skipped_existing_files={}, renamed={}",
                    summary.source.display(),
                    summary.target.display(),
                    summary.copied_files,
                    summary.skipped_existing_files,
                    summary.renamed
                );
            }
        }
        Err(err) => {
            error!(
                "Legacy home migration failed; legacy data is untouched at {}: {}",
                legacy_home.display(),
                err
            );
        }
    }
}

struct MigrationSummary {
    source: PathBuf,
    target: PathBuf,
    copied_files: u64,
    skipped_existing_files: u64,
    renamed: bool,
}

fn timestamp_suffix() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("{millis}")
}

fn copy_marker_path(source_entry: &Path) -> PathBuf {
    let mut name = source_entry
        .file_name()
        .map(|name| name.to_os_string())
        .unwrap_or_default();
    name.push(COPY_MARKER_SUFFIX);
    source_entry.with_file_name(name)
}

fn completion_marker_path(legacy_home: &Path) -> PathBuf {
    legacy_home.join(COMPLETION_MARKER)
}

fn lock_path(legacy_home: &Path) -> PathBuf {
    legacy_home.join(LOCK_FILE)
}

/// Merge-copy `legacy_home` into `new_home`.
///
/// `required_entries` must migrate completely; a failure on any of them
/// propagates so no source rename happens and the next launch retries.
/// Failures on other entries are logged and skipped.
fn run_migration(
    legacy_home: &Path,
    new_home: &Path,
    required_entries: &[&str],
) -> BitFunResult<MigrationSummary> {
    let completion_marker = completion_marker_path(legacy_home);
    if completion_marker.exists() && all_required_entries_migrated(legacy_home, required_entries) {
        debug!(
            "Legacy home migration already completed: {}",
            legacy_home.display()
        );
        return Ok(MigrationSummary {
            source: legacy_home.to_path_buf(),
            target: new_home.to_path_buf(),
            copied_files: 0,
            skipped_existing_files: 0,
            renamed: false,
        });
    }

    std::fs::create_dir_all(new_home).map_err(|err| {
        BitFunError::service(format!(
            "Failed to create new home {}: {}",
            new_home.display(),
            err
        ))
    })?;

    let lock = lock_path(legacy_home);
    if lock.exists() {
        warn!(
            "Legacy home migration appears to be in progress by another process; retrying on next launch: {}",
            legacy_home.display()
        );
        return Ok(MigrationSummary {
            source: legacy_home.to_path_buf(),
            target: new_home.to_path_buf(),
            copied_files: 0,
            skipped_existing_files: 0,
            renamed: false,
        });
    }
    std::fs::write(&lock, b"").map_err(|err| {
        BitFunError::service(format!(
            "Failed to create migration lock {}: {}",
            lock.display(),
            err
        ))
    })?;

    let result = copy_tree_merge(legacy_home, new_home, required_entries);

    // Best-effort lock cleanup; removing it unconditionally is safe because a
    // failed run simply retries from scratch next launch (existing target
    // files are never overwritten).
    let _ = std::fs::remove_file(&lock);

    let summary = result?;
    std::fs::write(&completion_marker, b"").map_err(|err| {
        BitFunError::service(format!(
            "Failed to write migration marker {}: {}",
            completion_marker.display(),
            err
        ))
    })?;

    let renamed = rename_source_after_success(legacy_home, required_entries);
    Ok(MigrationSummary { renamed, ..summary })
}

fn all_required_entries_migrated(legacy_home: &Path, required_entries: &[&str]) -> bool {
    required_entries.iter().all(|entry| {
        copy_marker_path(&legacy_home.join(entry)).exists() || !legacy_home.join(entry).exists()
    })
}

fn rename_source_after_success(legacy_home: &Path, required_entries: &[&str]) -> bool {
    if !all_required_entries_migrated(legacy_home, required_entries) {
        warn!(
            "Required legacy home entries were not fully migrated; keeping source in place: {}",
            legacy_home.display()
        );
        return false;
    }

    let backup = legacy_home.with_file_name(format!(
        "{}.migrated-{}",
        legacy_home
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("bitfun"),
        timestamp_suffix()
    ));
    match std::fs::rename(legacy_home, &backup) {
        Ok(()) => {
            info!(
                "Renamed migrated legacy home to preserve recoverable data: {} -> {}",
                legacy_home.display(),
                backup.display()
            );
            true
        }
        Err(err) => {
            warn!(
                "Could not rename migrated legacy home {} to {}: {}; legacy data stays in place",
                legacy_home.display(),
                backup.display(),
                err
            );
            false
        }
    }
}

fn copy_tree_merge(
    source: &Path,
    target: &Path,
    required_entries: &[&str],
) -> BitFunResult<MigrationSummary> {
    let mut summary = MigrationSummary {
        source: source.to_path_buf(),
        target: target.to_path_buf(),
        copied_files: 0,
        skipped_existing_files: 0,
        renamed: false,
    };

    let entries = std::fs::read_dir(source).map_err(|err| {
        BitFunError::service(format!(
            "Failed to read legacy home {}: {}",
            source.display(),
            err
        ))
    })?;

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                warn!("Failed to enumerate legacy home entry: {}", err);
                continue;
            }
        };
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == COMPLETION_MARKER || name == LOCK_FILE || name.ends_with(COPY_MARKER_SUFFIX) {
            continue;
        }

        let destination = target.join(entry.file_name());
        match copy_entry(&entry_path, &destination, &mut summary) {
            Ok(()) => {
                if required_entries.contains(&name.as_str()) {
                    let marker = copy_marker_path(&entry_path);
                    if let Err(err) = std::fs::write(&marker, b"") {
                        warn!(
                            "Failed to write per-entry migration marker {}: {}",
                            marker.display(),
                            err
                        );
                    }
                }
            }
            Err(err) if required_entries.contains(&name.as_str()) => return Err(err),
            Err(err) => {
                warn!(
                    "Skipped legacy home entry {} during migration: {}",
                    entry_path.display(),
                    err
                );
            }
        }
    }

    Ok(summary)
}

fn copy_entry(source: &Path, target: &Path, summary: &mut MigrationSummary) -> BitFunResult<()> {
    let metadata = std::fs::symlink_metadata(source).map_err(|err| {
        BitFunError::service(format!("Failed to stat {}: {}", source.display(), err))
    })?;

    if metadata.is_dir() {
        std::fs::create_dir_all(target).map_err(|err| {
            BitFunError::service(format!(
                "Failed to create directory {}: {}",
                target.display(),
                err
            ))
        })?;
        copy_dir_contents(source, target, summary)
    } else if metadata.is_file() {
        if target.exists() {
            summary.skipped_existing_files += 1;
            return Ok(());
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|err| {
                BitFunError::service(format!(
                    "Failed to create directory {}: {}",
                    parent.display(),
                    err
                ))
            })?;
        }
        std::fs::copy(source, target).map_err(|err| {
            BitFunError::service(format!(
                "Failed to copy {} to {}: {}",
                source.display(),
                target.display(),
                err
            ))
        })?;
        summary.copied_files += 1;
        Ok(())
    } else {
        // Symlinks and special files are not migrated: legacy layouts should
        // not contain them, and copying links could point outside the home.
        debug!(
            "Skipping non-regular legacy file during migration: {}",
            source.display()
        );
        Ok(())
    }
}

fn copy_dir_contents(
    source: &Path,
    target: &Path,
    summary: &mut MigrationSummary,
) -> BitFunResult<()> {
    let entries = std::fs::read_dir(source).map_err(|err| {
        BitFunError::service(format!("Failed to read {}: {}", source.display(), err))
    })?;

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                warn!("Failed to enumerate {}: {}", source.display(), err);
                continue;
            }
        };
        let child_target = target.join(entry.file_name());
        if let Err(err) = copy_entry(&entry.path(), &child_target, summary) {
            // Individual nested failures stay non-fatal so one bad file cannot
            // block the whole migration; required-entry failures only surface
            // at the top level and trigger a full retry next launch.
            warn!(
                "Skipped nested legacy entry {} during migration: {}",
                entry.path().display(),
                err
            );
        }
    }

    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::ffi::OsString;

    fn unique_test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "bitfun-home-migration-{name}-{}-{}",
            std::process::id(),
            timestamp_suffix()
        ))
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create parent");
        }
        std::fs::write(path, contents).expect("write file");
    }

    /// Keep `BITFUN_HOME` untouched for direct `run_migration` tests.
    struct TempRootGuard(PathBuf);

    impl Drop for TempRootGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn migrates_legacy_home_into_new_home_without_overwrite() {
        let root = unique_test_root("merge");
        let _guard = TempRootGuard(root.clone());
        let legacy_home = root.join("legacy").join(".bitfun");
        let new_home = root.join("user").join(".bitfun");

        write_file(
            &legacy_home
                .join("projects")
                .join("ws-a")
                .join("sessions")
                .join("s1")
                .join("messages.jsonl"),
            "legacy-session",
        );
        write_file(
            &legacy_home
                .join("personal_assistant")
                .join("workspace")
                .join("note.txt"),
            "legacy-workspace",
        );
        write_file(&legacy_home.join("logs").join("app.log"), "legacy-log");

        // A conflicting newer file in the new home must win.
        write_file(&new_home.join("logs").join("app.log"), "newer-log");

        let summary =
            run_migration(&legacy_home, &new_home, &REQUIRED_SOURCE_ENTRIES).expect("migration");

        assert_eq!(summary.copied_files, 3, "three legacy files copied");
        assert_eq!(
            summary.skipped_existing_files, 1,
            "conflicting file skipped"
        );
        assert!(summary.renamed, "fully migrated source is renamed");
        assert_eq!(
            std::fs::read_to_string(
                new_home
                    .join("projects")
                    .join("ws-a")
                    .join("sessions")
                    .join("s1")
                    .join("messages.jsonl"),
            )
            .expect("session migrated"),
            "legacy-session"
        );
        assert!(new_home
            .join("personal_assistant")
            .join("workspace")
            .join("note.txt")
            .exists());
        assert_eq!(
            std::fs::read_to_string(new_home.join("logs").join("app.log")).expect("log"),
            "newer-log",
            "existing files must never be overwritten"
        );
        assert!(!legacy_home.exists(), "source renamed away after success");

        let backups: Vec<_> = std::fs::read_dir(root.join("legacy"))
            .expect("legacy parent")
            .collect();
        assert!(backups.iter().any(|entry| entry
            .as_ref()
            .expect("entry")
            .file_name()
            .to_string_lossy()
            .starts_with(".bitfun.migrated-")));
    }

    #[test]
    fn rerun_after_completion_is_a_noop() {
        let root = unique_test_root("idempotent");
        let _guard = TempRootGuard(root.clone());
        let legacy_home = root.join("legacy").join(".bitfun");
        let new_home = root.join("user").join(".bitfun");

        write_file(&legacy_home.join("projects").join("s.jsonl"), "data");
        run_migration(&legacy_home, &new_home, &REQUIRED_SOURCE_ENTRIES).expect("first run");

        // Recreate a legacy-looking directory to simulate a stale leftover and
        // mark it complete; the completed marker path must short-circuit.
        std::fs::create_dir_all(&legacy_home).expect("recreate legacy");
        std::fs::write(completion_marker_path(&legacy_home), b"").expect("marker");

        let summary =
            run_migration(&legacy_home, &new_home, &REQUIRED_SOURCE_ENTRIES).expect("second run");
        assert_eq!(summary.copied_files, 0);
        assert!(!summary.renamed);
    }

    #[test]
    fn failed_required_entry_propagates_and_keeps_source() {
        let root = unique_test_root("required");
        let _guard = TempRootGuard(root.clone());
        let legacy_home = root.join("legacy").join(".bitfun");
        let new_home = root.join("user").join(".bitfun");
        std::fs::create_dir_all(&new_home).expect("new home");

        write_file(&legacy_home.join("projects").join("s.jsonl"), "data");

        let projects_dir = legacy_home.join("projects");
        std::fs::set_permissions(
            &projects_dir,
            std::os::unix::fs::PermissionsExt::from_mode(0o000),
        )
        .expect("chmod projects");

        let result = run_migration(&legacy_home, &new_home, &REQUIRED_SOURCE_ENTRIES);

        std::fs::set_permissions(
            &projects_dir,
            std::os::unix::fs::PermissionsExt::from_mode(0o755),
        )
        .expect("restore mode");

        assert!(result.is_err(), "required entry failure must surface");
        assert!(
            !completion_marker_path(&legacy_home).exists(),
            "no completion marker"
        );
        assert!(
            !lock_path(&legacy_home).exists(),
            "lock released on failure"
        );
        assert!(legacy_home.exists(), "source stays in place for retry");
    }

    #[test]
    fn non_required_entry_failure_does_not_block_completion() {
        let root = unique_test_root("optional");
        let _guard = TempRootGuard(root.clone());
        let legacy_home = root.join("legacy").join(".bitfun");
        let new_home = root.join("user").join(".bitfun");

        write_file(&legacy_home.join("projects").join("s.jsonl"), "data");
        write_file(&legacy_home.join("logs").join("app.log"), "log");

        let logs_dir = legacy_home.join("logs");
        std::fs::set_permissions(
            &logs_dir,
            std::os::unix::fs::PermissionsExt::from_mode(0o000),
        )
        .expect("chmod logs");

        let summary = run_migration(&legacy_home, &new_home, &REQUIRED_SOURCE_ENTRIES)
            .expect("optional failure must not block");

        std::fs::set_permissions(
            &logs_dir,
            std::os::unix::fs::PermissionsExt::from_mode(0o755),
        )
        .expect("restore mode");

        assert_eq!(summary.copied_files, 1, "only required entry copied");
        assert!(new_home.join("projects").join("s.jsonl").exists());
        assert!(!new_home.join("logs").exists());
    }

    #[test]
    fn active_lock_skips_migration() {
        let root = unique_test_root("lock");
        let _guard = TempRootGuard(root.clone());
        let legacy_home = root.join("legacy").join(".bitfun");
        let new_home = root.join("user").join(".bitfun");

        write_file(&legacy_home.join("projects").join("s.jsonl"), "data");
        std::fs::write(lock_path(&legacy_home), b"").expect("pre-existing lock");

        let summary =
            run_migration(&legacy_home, &new_home, &REQUIRED_SOURCE_ENTRIES).expect("skip run");

        assert_eq!(summary.copied_files, 0);
        assert!(legacy_home.join("projects").join("s.jsonl").exists());
        assert!(!new_home.join("projects").exists());
    }

    #[test]
    fn hook_respects_bitfun_home_override() {
        let root = unique_test_root("hook");
        let _guard = TempRootGuard(root.clone());
        let legacy_home = root.join("legacy").join(".bitfun");
        let override_home = root.join("override").join(".bitfun");

        write_file(&legacy_home.join("projects").join("s.jsonl"), "data");

        let saved: Option<OsString> = std::env::var_os("BITFUN_HOME");
        std::env::set_var("BITFUN_HOME", &override_home);
        let path_manager = PathManager::new().expect("path manager");
        assert_eq!(path_manager.bitfun_home_dir(), override_home);

        // Non-ohos builds contribute no legacy home, so the hook is a no-op.
        if legacy_ohos_home().is_none() {
            migrate_legacy_home_if_needed(&path_manager);
            assert!(!override_home.join("projects").exists());
        }
        match saved {
            Some(value) => std::env::set_var("BITFUN_HOME", value),
            None => std::env::remove_var("BITFUN_HOME"),
        }
    }
}
