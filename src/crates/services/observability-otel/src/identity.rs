use crate::TelemetryRuntimeError;
use fs2::FileExt;
use hmac::{Hmac, Mac};
use bitfun_observability::PseudonymousInstallationId;
use sha2::Sha256;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use uuid::Uuid;

const INSTALLATION_ID_FILE: &str = "installation-root-id";
const INSTALLATION_ID_LOCK_FILE: &str = "installation-root-id.lock";

#[derive(Debug, Clone)]
pub struct InstallationIdentityStore {
    directory: PathBuf,
}

impl InstallationIdentityStore {
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        Self {
            directory: directory.into(),
        }
    }

    pub fn identity_path(&self) -> PathBuf {
        self.directory.join(INSTALLATION_ID_FILE)
    }

    /// Creates the local root only when an enabled, validated receiver asks for
    /// a scoped ID. The root value is never returned from this API.
    pub fn scoped_id(
        &self,
        receiver_audience: &str,
    ) -> Result<PseudonymousInstallationId, TelemetryRuntimeError> {
        let root = self.load_or_create_root()?;
        let mut mac = Hmac::<Sha256>::new_from_slice(root.as_bytes())
            .map_err(|_| TelemetryRuntimeError::InvalidConfig("identity key is invalid"))?;
        mac.update(b"bitfun-installation-v1\0");
        mac.update(receiver_audience.as_bytes());
        Ok(PseudonymousInstallationId::from_hmac_digest(
            mac.finalize().into_bytes().into(),
        ))
    }

    pub fn reset(&self) -> Result<bool, TelemetryRuntimeError> {
        let lock = self.lock()?;
        let removed = match std::fs::remove_file(self.identity_path()) {
            Ok(()) => true,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => return Err(TelemetryRuntimeError::Identity(error)),
        };
        drop(lock);
        Ok(removed)
    }

    fn load_or_create_root(&self) -> Result<Uuid, TelemetryRuntimeError> {
        let lock = self.lock()?;
        let root = match read_root(&self.identity_path()) {
            Ok(root) => root,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => self.create_root()?,
            Err(error) if error.kind() == std::io::ErrorKind::InvalidData => {
                self.quarantine_corrupt_root()?;
                self.create_root()?
            }
            Err(error) => return Err(TelemetryRuntimeError::Identity(error)),
        };
        drop(lock);
        Ok(root)
    }

    fn lock(&self) -> Result<File, TelemetryRuntimeError> {
        std::fs::create_dir_all(&self.directory).map_err(TelemetryRuntimeError::Identity)?;
        set_directory_permissions(&self.directory).map_err(TelemetryRuntimeError::Identity)?;
        let lock = secure_open(&self.directory.join(INSTALLATION_ID_LOCK_FILE), false)
            .map_err(TelemetryRuntimeError::Identity)?;
        lock.lock_exclusive()
            .map_err(TelemetryRuntimeError::Identity)?;
        Ok(lock)
    }

    fn create_root(&self) -> Result<Uuid, TelemetryRuntimeError> {
        let root = Uuid::new_v4();
        let temporary = self
            .directory
            .join(format!(".{INSTALLATION_ID_FILE}.{}.tmp", Uuid::new_v4()));
        let mut file = secure_open(&temporary, true).map_err(TelemetryRuntimeError::Identity)?;
        file.write_all(root.hyphenated().to_string().as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(TelemetryRuntimeError::Identity)?;
        drop(file);
        if let Err(error) = std::fs::rename(&temporary, self.identity_path()) {
            let _ = std::fs::remove_file(&temporary);
            return Err(TelemetryRuntimeError::Identity(error));
        }
        sync_directory(&self.directory).map_err(TelemetryRuntimeError::Identity)?;
        Ok(root)
    }

    fn quarantine_corrupt_root(&self) -> Result<(), TelemetryRuntimeError> {
        let quarantine = self.directory.join(format!(
            ".{INSTALLATION_ID_FILE}.corrupt.{}",
            Uuid::new_v4()
        ));
        std::fs::rename(self.identity_path(), quarantine).map_err(TelemetryRuntimeError::Identity)
    }
}

fn read_root(path: &Path) -> std::io::Result<Uuid> {
    set_file_permissions(path)?;
    let mut contents = String::new();
    File::open(path)?.take(128).read_to_string(&mut contents)?;
    Uuid::parse_str(contents.trim()).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "installation identity is corrupt",
        )
    })
}

fn secure_open(path: &Path, truncate: bool) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options
        .read(true)
        .write(true)
        .create(true)
        .truncate(truncate);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path)?;
    set_file_permissions(path)?;
    Ok(file)
}

#[cfg(unix)]
fn set_directory_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn set_directory_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn set_file_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn set_file_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> std::io::Result<()> {
    File::open(path)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn scoped_ids_are_stable_and_receiver_isolated() {
        let temporary = tempfile::tempdir().unwrap();
        let store = InstallationIdentityStore::new(temporary.path().join("telemetry"));
        let first = store
            .scoped_id("https://collector-a.test:443|prod")
            .unwrap();
        let repeated = store
            .scoped_id("https://collector-a.test:443|prod")
            .unwrap();
        let other = store
            .scoped_id("https://collector-b.test:443|prod")
            .unwrap();
        let root = std::fs::read_to_string(store.identity_path()).unwrap();

        assert_eq!(first, repeated);
        assert_ne!(first, other);
        assert_eq!(first.as_str().len(), 32);
        assert!(!first.as_str().contains(root.trim()));
    }

    #[test]
    fn corrupt_identity_is_quarantined_and_recovered() {
        let temporary = tempfile::tempdir().unwrap();
        let store = InstallationIdentityStore::new(temporary.path().join("telemetry"));
        std::fs::create_dir_all(store.identity_path().parent().unwrap()).unwrap();
        std::fs::write(store.identity_path(), b"not-a-uuid").unwrap();

        let id = store.scoped_id("receiver").unwrap();
        assert_eq!(id.as_str().len(), 32);
        assert!(Uuid::parse_str(
            std::fs::read_to_string(store.identity_path())
                .unwrap()
                .trim()
        )
        .is_ok());
    }

    #[test]
    fn concurrent_process_threads_share_one_atomic_root_identity() {
        let temporary = tempfile::tempdir().unwrap();
        let store = Arc::new(InstallationIdentityStore::new(
            temporary.path().join("telemetry"),
        ));
        let barrier = Arc::new(std::sync::Barrier::new(12));
        let workers = (0..12)
            .map(|_| {
                let store = store.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    store.scoped_id("https://collector.test:443|prod").unwrap()
                })
            })
            .collect::<Vec<_>>();
        let ids = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect::<Vec<_>>();

        assert!(ids.iter().all(|id| id == &ids[0]));
        assert!(Uuid::parse_str(
            std::fs::read_to_string(store.identity_path())
                .unwrap()
                .trim()
        )
        .is_ok());
        assert_eq!(
            std::fs::read_dir(store.identity_path().parent().unwrap())
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp"))
                .count(),
            0
        );
    }

    #[test]
    fn reset_removes_the_root_and_next_enable_rotates_identity() {
        let temporary = tempfile::tempdir().unwrap();
        let store = InstallationIdentityStore::new(temporary.path().join("telemetry"));
        let first = store.scoped_id("receiver").unwrap();
        assert!(store.reset().unwrap());
        assert!(!store.identity_path().exists());
        let second = store.scoped_id("receiver").unwrap();
        assert_ne!(first, second);
    }

    #[cfg(unix)]
    #[test]
    fn root_identity_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let temporary = tempfile::tempdir().unwrap();
        let store = InstallationIdentityStore::new(temporary.path().join("telemetry"));
        store.scoped_id("receiver").unwrap();
        let mode = std::fs::metadata(store.identity_path())
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }
}
