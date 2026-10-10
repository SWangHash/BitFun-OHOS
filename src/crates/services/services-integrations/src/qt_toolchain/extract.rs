//! Archive extraction for the Qt toolchain provisioner.

use super::{QtToolchainArchiveKind, QtToolchainProvisionError};
use flate2::read::GzDecoder;
use std::collections::BTreeSet;
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use tar::Archive;

/// Extracts `archive_path` into `destination`, stripping the archive's
/// top-level directory.
pub(super) fn extract_archive_stripping_top_level(
    archive_path: &Path,
    archive_kind: QtToolchainArchiveKind,
    destination: &Path,
) -> Result<(), QtToolchainProvisionError> {
    std::fs::create_dir_all(destination).map_err(|error| {
        QtToolchainProvisionError::IoFailed(format!(
            "failed to create the Qt toolchain extraction directory {}: {error}",
            destination.display()
        ))
    })?;
    let result = match archive_kind {
        QtToolchainArchiveKind::Zip => extract_zip_stripping_top_level(archive_path, destination),
        QtToolchainArchiveKind::TarGz => {
            extract_tar_gz_stripping_top_level(archive_path, destination)
        }
    };
    if let Err(error) = &result {
        // Never hand back a half-extracted payload: the caller removes the
        // staging directory, and this keeps the failure self-contained too.
        let _ = std::fs::remove_dir_all(destination);
        log::warn!(
            "Qt toolchain archive extraction failed: archive={}, kind={}, destination={}, error={}",
            archive_path.display(),
            archive_kind.as_str(),
            destination.display(),
            error
        );
    }
    result
}

fn extract_zip_stripping_top_level(
    archive_path: &Path,
    destination: &Path,
) -> Result<(), QtToolchainProvisionError> {
    let file = open_archive(archive_path)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| {
        QtToolchainProvisionError::ArchiveExtractFailed(format!(
            "{} is not a readable zip archive: {error}",
            archive_path.display()
        ))
    })?;
    archive
        .extract_unwrapped_root_dir(destination, zip::read::root_dir_common_filter)
        .map_err(|error| {
            QtToolchainProvisionError::ArchiveExtractFailed(format!(
                "failed to extract the zip archive {}: {error}",
                archive_path.display()
            ))
        })
}

fn extract_tar_gz_stripping_top_level(
    archive_path: &Path,
    destination: &Path,
) -> Result<(), QtToolchainProvisionError> {
    let decoder = GzDecoder::new(open_archive(archive_path)?);
    extract_tar_stripping_top_level(decoder, destination, archive_path)
}

/// Reader-generic half of the tar path, so the top-level stripping and the
/// path-safety rules are covered by tests without a gzip encoder.
fn extract_tar_stripping_top_level<R: Read>(
    reader: R,
    destination: &Path,
    archive_path: &Path,
) -> Result<(), QtToolchainProvisionError> {
    let mut archive = Archive::new(reader);
    let entries = archive
        .entries()
        .map_err(|error| archive_error(archive_path, error))?;
    let mut top_level_dirs: BTreeSet<PathBuf> = BTreeSet::new();

    for entry in entries {
        let mut entry = entry.map_err(|error| archive_error(archive_path, error))?;
        let relative = entry
            .path()
            .map_err(|error| archive_error(archive_path, error))?;
        let Some(stripped) = strip_top_level(&relative)? else {
            continue;
        };
        if let Some(top_level) = top_level_component(&relative) {
            top_level_dirs.insert(top_level);
        }
        let target = destination.join(&stripped);
        // `tar`'s `Entry::unpack` writes the entry but does not create the
        // directories above it, so the parent is created here.
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                QtToolchainProvisionError::ArchiveExtractFailed(format!(
                    "failed to create the extraction directory {}: {error}",
                    parent.display()
                ))
            })?;
        }
        entry
            .unpack(&target)
            .map_err(|error| archive_error(archive_path, error))?;
    }

    if top_level_dirs.len() != 1 {
        return Err(QtToolchainProvisionError::ArchiveExtractFailed(format!(
            "the tar archive {} does not expose a single top-level directory to strip (found {})",
            archive_path.display(),
            describe_roots(&top_level_dirs)
        )));
    }
    Ok(())
}

/// Removes the first path component, returning `None` for the top-level entry
/// itself. Rejects absolute paths and `..` components instead of normalizing
/// them, so an archive cannot escape `destination`.
fn strip_top_level(relative: &Path) -> Result<Option<PathBuf>, QtToolchainProvisionError> {
    let mut stripped = PathBuf::new();
    let mut skipped_first = false;
    for component in relative.components() {
        match component {
            Component::Normal(part) => {
                if skipped_first {
                    stripped.push(part);
                } else {
                    skipped_first = true;
                }
            }
            Component::CurDir => {}
            _ => {
                return Err(QtToolchainProvisionError::ArchiveExtractFailed(format!(
                    "archive entry contains an unsafe path: {}",
                    relative.display()
                )));
            }
        }
    }
    if stripped.as_os_str().is_empty() {
        return Ok(None);
    }
    Ok(Some(stripped))
}

/// The first normal component of an archive entry, when it has one.
fn top_level_component(relative: &Path) -> Option<PathBuf> {
    relative.components().find_map(|component| match component {
        Component::Normal(part) => Some(PathBuf::from(part)),
        _ => None,
    })
}

fn describe_roots(roots: &BTreeSet<PathBuf>) -> String {
    if roots.is_empty() {
        return "none".to_string();
    }
    roots
        .iter()
        .map(|root| root.display().to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

fn open_archive(archive_path: &Path) -> Result<File, QtToolchainProvisionError> {
    File::open(archive_path).map_err(|error| {
        QtToolchainProvisionError::ArchiveExtractFailed(format!(
            "failed to open the Qt toolchain archive {}: {error}",
            archive_path.display()
        ))
    })
}

fn archive_error(archive_path: &Path, error: std::io::Error) -> QtToolchainProvisionError {
    // `tar` wraps its own failures in an `std::io::Error` whose `Display` drops
    // the cause, so the debug form is what actually names the problem.
    QtToolchainProvisionError::ArchiveExtractFailed(format!(
        "failed to read the tar archive {}: {error:?}",
        archive_path.display()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_top_level_removes_the_single_upstream_directory() {
        assert_eq!(
            strip_top_level(Path::new("qt-6.13.0-dev/bin/qmake")).unwrap(),
            Some(PathBuf::from("bin/qmake"))
        );
        assert_eq!(
            strip_top_level(Path::new("./qt-6.13.0-dev/lib/cmake/Qt6/Qt6Config.cmake")).unwrap(),
            Some(PathBuf::from("lib/cmake/Qt6/Qt6Config.cmake"))
        );
        // The top-level directory entry itself carries nothing to write.
        assert_eq!(strip_top_level(Path::new("qt-6.13.0-dev/")).unwrap(), None);
        assert_eq!(strip_top_level(Path::new("qt-6.13.0-dev")).unwrap(), None);
    }

    #[test]
    fn strip_top_level_rejects_paths_that_escape_the_destination() {
        let error = strip_top_level(Path::new("../evil/qmake")).unwrap_err();
        assert!(error.to_string().contains("unsafe path"));
        let error = strip_top_level(Path::new("/etc/passwd")).unwrap_err();
        assert!(error.to_string().contains("unsafe path"));
    }
}
