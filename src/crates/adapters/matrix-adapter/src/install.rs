//! `GET /api/registry/skill/{enName}/install` — download, verify, and
//! atomically install a Matrix skill ZIP to `~/.bitfun/skills/matrix/<enName>/`.
//!
//! Install flow (mirrors BitFun `builtin.rs` staging + atomic rename pattern,
//! see `spec/matrix-skill-market/plan.md` RD-003 + RD-004):
//!
//! 1. Download ZIP bytes via `MatrixHttpClient::fetch_skill_zip` (bounded 16 MiB)
//! 2. Fetch expected SHA-256 + size via `check_checksum` (AFTER download, per
//!    Matrix's real-time-update note in `spec.md` US4 scenario 3)
//! 3. Compute SHA-256 of downloaded bytes, reject on mismatch (`Integrity`)
//! 4. Resolve `~/.bitfun/skills/matrix/` via cross-platform home dir lookup
//! 5. Create staging dir `~/.bitfun/skills/matrix/.staging-{en_name}-{pid}-{nanos}/`
//! 6. Unzip into staging dir with path traversal guard (reject `/`-prefix,
//!    `..` segments, out-of-tree resolution, and symlink entries)
//! 7. Verify `SKILL.md` exists in extracted root
//! 8. Atomic rename staging → final `~/.bitfun/skills/matrix/{en_name}/`
//!    (remove existing target first, then rename — atomic on the same
//!    filesystem)
//! 9. Cleanup staging on every error path so half-completed installs never
//!    pollute the SkillRegistry scan

use crate::checksum::check_checksum;
use crate::client::MatrixHttpClient;
use crate::error::{MatrixApiError, MatrixApiErrorKind};
use crate::models::MatrixSkillInstallResult;
use sha2::{Digest, Sha256};
use std::io::{self, Cursor, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::fs;

/// Fixed `source_id` for Matrix-installed skills (per `spec.md` FR-006).
const MATRIX_SOURCE_ID: &str = "matrix";

/// Unix file mode mask for the file type bits (`S_IFMT`).
const S_IFMT: u32 = 0o170_000;
/// Unix file type for symlinks (`S_IFLNK`).
const S_IFLNK: u32 = 0o120_000;

/// Resolve the Matrix skills install root: `~/.bitfun/skills/matrix/`.
///
/// Uses `USERPROFILE` (Windows) or `HOME` (Unix) for the home directory. Does
/// not create the directory; callers (e.g. [`install_skill`]) create it
/// lazily via `fs::create_dir_all`.
pub fn resolve_matrix_skills_root() -> Result<PathBuf, MatrixApiError> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| {
            MatrixApiError::new(
                MatrixApiErrorKind::RuntimeUnavailable,
                "Could not resolve user home directory (USERPROFILE and HOME env vars both unset)",
            )
        })?;
    Ok(PathBuf::from(home)
        .join(".bitfun")
        .join("skills")
        .join("matrix"))
}

/// Install a Matrix skill by `en_name` to a caller-supplied `install_root`.
///
/// `install_root` is the destination base directory (e.g. the user-level
/// `~/.bitfun/skills/matrix/` or a project-level
/// `<workspace>/.bitfun/skills/matrix/`). The skill is installed to
/// `<install_root>/<en_name>/`. The caller (Tauri command layer) resolves the
/// root based on the chosen install scope; this crate stays free of
/// workspace/level concerns.
///
/// See the module-level docs for the full flow. Returns a
/// `MatrixSkillInstallResult` with the verified install metadata on success.
/// On any error, staging directories are cleaned up before propagating the
/// error.
pub async fn install_skill_to_root(
    en_name: &str,
    client: &MatrixHttpClient,
    install_root: &Path,
) -> Result<MatrixSkillInstallResult, MatrixApiError> {
    log::info!(
        "Matrix install_skill_to_root start: en_name={}, install_root={}",
        en_name,
        install_root.display()
    );
    if en_name.trim().is_empty() {
        log::error!("Matrix install_skill_to_root: en_name is empty");
        return Err(MatrixApiError::new(
            MatrixApiErrorKind::Parse,
            "Matrix skill en_name must not be empty",
        ));
    }

    // Step 1: Download ZIP bytes (bounded to 16 MiB by the client helper).
    log::info!(
        "Matrix install_skill_to_root step 1 download: en_name={}",
        en_name
    );
    let zip_bytes = client.fetch_skill_zip(en_name).await?;
    let size = zip_bytes.len() as u64;
    log::info!(
        "Matrix install_skill_to_root step 1 done: en_name={}, size_bytes={}",
        en_name,
        size
    );

    // Step 2: Fetch expected SHA-256 (after download, per Matrix's real-time
    // update note). The checksum endpoint may return a fresher value than
    // what was embedded in the skills list.
    log::info!(
        "Matrix install_skill_to_root step 2 checksum: en_name={}",
        en_name
    );
    let checksum = check_checksum(client, en_name).await?;
    log::info!(
        "Matrix install_skill_to_root step 2 done: en_name={}, expected_sha256={}, expected_size={}",
        en_name,
        checksum.sha256,
        checksum.size
    );

    // Step 3: Compute SHA-256 of downloaded bytes and compare.
    log::info!(
        "Matrix install_skill_to_root step 3 verify: en_name={}",
        en_name
    );
    let actual_sha256_hex = sha256_hex(&zip_bytes);
    if actual_sha256_hex != checksum.sha256 {
        log::error!(
            "Matrix install_skill_to_root integrity mismatch: en_name={}, expected={}, actual={}",
            en_name,
            checksum.sha256,
            actual_sha256_hex
        );
        return Err(MatrixApiError::new(
            MatrixApiErrorKind::Integrity {
                expected: checksum.sha256.clone(),
                actual: actual_sha256_hex.clone(),
            },
            "SHA-256 checksum mismatch between downloaded ZIP and checksum endpoint",
        ));
    }
    log::info!(
        "Matrix install_skill_to_root step 3 verified: en_name={}, sha256={}",
        en_name,
        actual_sha256_hex
    );

    // Step 4: install_root is supplied by the caller (resolved in the Tauri
    // command layer based on the chosen install scope).
    log::info!(
        "Matrix install_skill_to_root step 4 root: en_name={}, install_root={}",
        en_name,
        install_root.display()
    );

    // Step 5: Create the install root and a unique staging directory.
    fs::create_dir_all(install_root).await?;
    let staging_dir = staging_path(install_root, en_name);
    if let Err(error) = fs::create_dir_all(&staging_dir).await {
        log::warn!(
            "Failed to create Matrix skill staging directory {}: {}",
            staging_dir.display(),
            error
        );
        return Err(MatrixApiError::from(error));
    }
    log::info!(
        "Matrix install_skill_to_root step 5 staging: en_name={}, staging_dir={}",
        en_name,
        staging_dir.display()
    );

    // Steps 6-7: Unzip + SKILL.md presence check. Both run inside
    // spawn_blocking because the zip crate is sync and we do not want to
    // block the async runtime.
    log::info!(
        "Matrix install_skill_to_root step 6 unzip: en_name={}, staging_dir={}",
        en_name,
        staging_dir.display()
    );
    let staging_dir_for_unzip = staging_dir.clone();
    let unzip_result = tokio::task::spawn_blocking(move || -> Result<(), MatrixApiError> {
        unzip_with_path_guard(&zip_bytes, &staging_dir_for_unzip)?;
        let skill_md = staging_dir_for_unzip.join("SKILL.md");
        if !skill_md.exists() {
            return Err(MatrixApiError::new(
                MatrixApiErrorKind::Parse,
                "Matrix skill package missing SKILL.md",
            ));
        }
        Ok(())
    })
    .await;

    let unzip_result = match unzip_result {
        Ok(inner) => inner,
        Err(join_error) => {
            cleanup_staging(&staging_dir).await;
            log::error!(
                "Matrix install_skill_to_root unzip task panicked: en_name={}, error={}",
                en_name,
                join_error
            );
            return Err(MatrixApiError::new(
                MatrixApiErrorKind::RuntimeUnavailable,
                format!("Matrix skill unzip task panicked: {}", join_error),
            ));
        }
    };

    if let Err(error) = unzip_result {
        cleanup_staging(&staging_dir).await;
        log::error!(
            "Matrix install_skill_to_root unzip failed: en_name={}, error={:?}",
            en_name,
            error
        );
        return Err(error);
    }
    log::info!(
        "Matrix install_skill_to_root step 6-7 done: en_name={}, staging_dir={}",
        en_name,
        staging_dir.display()
    );

    // Step 8: Atomic rename staging → final. Remove an existing target first
    // (tokio::fs::rename fails if the destination is a non-empty dir on
    // Windows).
    let final_dir = install_root.join(en_name);
    log::info!(
        "Matrix install_skill_to_root step 8 atomic rename: en_name={}, staging={}, final={}",
        en_name,
        staging_dir.display(),
        final_dir.display()
    );
    if final_dir.exists() {
        if let Err(error) = fs::remove_dir_all(&final_dir).await {
            cleanup_staging(&staging_dir).await;
            return Err(MatrixApiError::new(
                MatrixApiErrorKind::Io,
                format!(
                    "Failed to remove existing Matrix skill directory {}: {}",
                    final_dir.display(),
                    error
                ),
            ));
        }
    }
    if let Err(error) = fs::rename(&staging_dir, &final_dir).await {
        cleanup_staging(&staging_dir).await;
        return Err(MatrixApiError::new(
            MatrixApiErrorKind::Io,
            format!(
                "Failed to atomically rename Matrix skill staging directory to {}: {}",
                final_dir.display(),
                error
            ),
        ));
    }
    log::info!(
        "Matrix install_skill_to_root step 8 done: en_name={}, final_dir={}",
        en_name,
        final_dir.display()
    );

    log::info!(
        "Matrix install_skill_to_root complete: en_name={}, install_path={}, size={}, sha256={}",
        en_name,
        final_dir.display(),
        size,
        actual_sha256_hex
    );
    Ok(MatrixSkillInstallResult {
        en_name: en_name.to_string(),
        version: None,
        install_path: final_dir.to_string_lossy().into_owned(),
        sha256: actual_sha256_hex,
        size,
        source_id: MATRIX_SOURCE_ID.to_string(),
        skill_md_present: true,
    })
}

/// Install a Matrix skill to the user-level root `~/.bitfun/skills/matrix/`.
///
/// Convenience wrapper around [`install_skill_to_root`] that resolves the
/// default user-level install root via [`resolve_matrix_skills_root`]. Use
/// [`install_skill_to_root`] directly when a project-level (or custom) root is
/// needed.
pub async fn install_skill(
    en_name: &str,
    client: &MatrixHttpClient,
) -> Result<MatrixSkillInstallResult, MatrixApiError> {
    let install_root = resolve_matrix_skills_root()?;
    install_skill_to_root(en_name, client, &install_root).await
}

/// Build a unique staging directory path under `install_root` for the given
/// `en_name`. Combines the process ID and a nanosecond timestamp to avoid
/// collisions between concurrent installs.
fn staging_path(install_root: &Path, en_name: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let dir_name = format!(".staging-{}-{}-{}", en_name, std::process::id(), timestamp);
    install_root.join(dir_name)
}

/// Best-effort cleanup of the staging directory. Logs a warning if cleanup
/// fails but does not propagate the error (the original install error takes
/// precedence).
async fn cleanup_staging(staging_dir: &Path) {
    if let Err(error) = fs::remove_dir_all(staging_dir).await {
        if error.kind() != std::io::ErrorKind::NotFound {
            log::warn!(
                "Failed to clean up Matrix skill staging directory {}: {}",
                staging_dir.display(),
                error
            );
        }
    }
}

/// Compute the SHA-256 hex digest of `bytes`.
fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    digest.iter().map(|byte| format!("{:02x}", byte)).collect()
}

/// Unzip `zip_bytes` into `staging_dir` with a path-traversal guard.
///
/// Defense layers (per `spec.md` FR-007 and plan.md RD-004):
/// 1. Reject entries whose name starts with `/` (absolute path).
/// 2. Reject entries containing `..` path segments.
/// 3. Use `zip::ZipFile::enclosed_name()` for an additional sanitize pass.
/// 4. Verify the resolved destination is still inside `staging_dir`.
/// 5. Reject symlink entries (via Unix mode bits).
fn unzip_with_path_guard(zip_bytes: &[u8], staging_dir: &Path) -> Result<(), MatrixApiError> {
    let cursor = Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|error| {
        MatrixApiError::new(
            MatrixApiErrorKind::Parse,
            format!("Failed to read Matrix skill ZIP archive: {}", error),
        )
    })?;

    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|error| {
            MatrixApiError::new(
                MatrixApiErrorKind::Parse,
                format!("Failed to read Matrix ZIP entry {}: {}", index, error),
            )
        })?;

        let entry_name = file.name().to_string();

        // Defense 1: Reject absolute paths.
        if entry_name.starts_with('/') || entry_name.starts_with('\\') {
            return Err(MatrixApiError::security(format!(
                "Matrix ZIP entry '{}' has an absolute path, rejected",
                entry_name
            )));
        }

        // Defense 2: Reject `..` segments.
        let raw_path = PathBuf::from(&entry_name);
        if raw_path
            .components()
            .any(|component| component.as_os_str() == "..")
        {
            return Err(MatrixApiError::security(format!(
                "Matrix ZIP entry '{}' contains a '..' segment, rejected",
                entry_name
            )));
        }

        // Defense 3: Use the zip crate's own sanitize pass.
        let safe_path = match file.enclosed_name() {
            Some(path) => path,
            None => {
                return Err(MatrixApiError::security(format!(
                    "Matrix ZIP entry '{}' has an unsafe path, rejected",
                    entry_name
                )));
            }
        };

        // Defense 4: Verify the resolved destination is inside staging_dir.
        let dest_path = staging_dir.join(&safe_path);
        if !dest_path.starts_with(staging_dir) {
            return Err(MatrixApiError::security(format!(
                "Matrix ZIP entry '{}' resolves outside the staging directory, rejected",
                entry_name
            )));
        }

        // Defense 5: Reject symlink entries (Unix mode bits).
        if let Some(mode) = file.unix_mode() {
            if (mode & S_IFMT) == S_IFLNK {
                return Err(MatrixApiError::security(format!(
                    "Matrix ZIP entry '{}' is a symlink, rejected",
                    entry_name
                )));
            }
        }

        if file.is_dir() {
            std::fs::create_dir_all(&dest_path).map_err(MatrixApiError::from)?;
        } else {
            if let Some(parent) = dest_path.parent() {
                std::fs::create_dir_all(parent).map_err(MatrixApiError::from)?;
            }
            let mut output = std::fs::File::create(&dest_path).map_err(MatrixApiError::from)?;
            let _ = io::copy(&mut file, &mut output)
                .map_err(|error| MatrixApiError::new(MatrixApiErrorKind::Io, error.to_string()))?;
            // Flush to ensure all bytes are on disk before rename.
            output
                .flush()
                .map_err(|error| MatrixApiError::new(MatrixApiErrorKind::Io, error.to_string()))?;
        }
    }

    Ok(())
}
