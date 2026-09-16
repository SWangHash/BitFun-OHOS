//! Runtime-owned, bounded uploads. Relay transports only encrypted chunk envelopes.
use crate::file_write_lock::write_guard;
use anyhow::{anyhow, bail, Result};
use openbitfun_runtime_ports::{WorkspaceFileSystem, WorkspacePathKind, WorkspaceWriter};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, sync::Arc};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::Mutex,
};

pub const MAX_UPLOAD_CHUNK: usize = 3 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransferScope {
    pub account_id: String,
    /// Runtime-selected connection identity; never a controller supplied hostname.
    pub target_id: String,
    pub workspace_root: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UploadStatus {
    pub transfer_id: String,
    pub next_offset: u64,
    pub total_bytes: u64,
    pub completed: bool,
}

pub struct UploadTarget {
    pub fs: Arc<dyn WorkspaceFileSystem>,
    pub path: String,
    pub remote: bool,
}
struct Upload {
    epoch: u64,
    scope: TransferScope,
    target: UploadTarget,
    staged: String,
    writer: Option<WorkspaceWriter>,
    status: UploadStatus,
    hash: Sha256,
    expected_hash: Option<String>,
    final_hash: String,
    last_chunk: Option<(u64, usize, String)>,
    failed: bool,
    publishing: bool,
}
#[derive(Clone, Default)]
pub struct UploadTransfers {
    epochs: Arc<Mutex<HashMap<String, u64>>>,
    entries: Arc<Mutex<HashMap<String, Arc<Mutex<Upload>>>>>,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn valid_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
}

impl UploadTransfers {
    /// Accepted filesystem mutations finish under the runtime owner even if the RPC observer disconnects.
    pub async fn begin(
        &self,
        id: String,
        scope: TransferScope,
        target: UploadTarget,
        total_bytes: u64,
        final_hash: String,
        expected_hash: Option<String>,
    ) -> Result<UploadStatus> {
        let epoch = *self
            .epochs
            .lock()
            .await
            .entry(scope.account_id.clone())
            .or_default();
        let owner = self.clone();
        tokio::spawn(async move {
            owner
                .begin_inner(
                    id,
                    scope,
                    target,
                    total_bytes,
                    final_hash,
                    expected_hash,
                    epoch,
                )
                .await
        })
        .await?
    }
    pub async fn append(
        &self,
        scope: &TransferScope,
        id: &str,
        offset: u64,
        bytes: &[u8],
    ) -> Result<UploadStatus> {
        if bytes.is_empty() || bytes.len() > MAX_UPLOAD_CHUNK {
            bail!("Upload chunk must contain 1..={MAX_UPLOAD_CHUNK} bytes");
        }
        let owner = self.clone();
        let scope = scope.clone();
        let id = id.to_owned();
        let bytes = bytes.to_vec();
        tokio::spawn(async move { owner.append_inner(&scope, &id, offset, &bytes).await }).await?
    }
    pub async fn finish(&self, scope: &TransferScope, id: &str) -> Result<UploadStatus> {
        let owner = self.clone();
        let scope = scope.clone();
        let id = id.to_owned();
        tokio::spawn(async move { owner.finish_inner(&scope, &id).await }).await?
    }
    async fn begin_inner(
        &self,
        id: String,
        scope: TransferScope,
        mut target: UploadTarget,
        total_bytes: u64,
        final_hash: String,
        expected_hash: Option<String>,
        epoch: u64,
    ) -> Result<UploadStatus> {
        if scope.account_id.is_empty() || scope.target_id.is_empty() {
            bail!("Upload requires an authenticated runtime and target scope");
        }
        if !valid_hash(&final_hash)
            || expected_hash
                .as_ref()
                .is_some_and(|hash| !hash.is_empty() && !valid_hash(hash))
        {
            bail!("Upload digest must be SHA-256 hexadecimal");
        }
        if !valid_hash(&id) {
            bail!("Upload transfer id must contain 32 random bytes encoded as hexadecimal");
        }
        let parent = checked_parent(&scope, &target).await?;
        if !target.remote {
            let name = std::path::Path::new(&target.path)
                .file_name()
                .ok_or_else(|| anyhow!("Upload destination has no file name"))?;
            target.path = std::path::Path::new(&parent)
                .join(name)
                .to_string_lossy()
                .into_owned();
        }
        let begin_lock = write_guard(format!("begin:{id}"));
        let _begin_guard = begin_lock.lock().await;
        if let Ok(entry) = self.entry(&id).await {
            let existing = entry.lock().await;
            existing.check_scope(&scope)?;
            if existing.epoch != epoch {
                bail!("Upload belongs to a retired account session");
            }
            if existing.target.path != target.path
                || existing.status.total_bytes != total_bytes
                || existing.final_hash != final_hash.to_lowercase()
                || existing.expected_hash != expected_hash
            {
                bail!("Upload transfer id was already used for a different request");
            }
            return Ok(existing.status.clone());
        }
        let staged = target
            .fs
            .join_path(&parent, &[&format!(".openbitfun-upload-{id}.tmp")]);
        let writer = target.fs.open_write_new(&staged).await?;
        let status = UploadStatus {
            transfer_id: id.clone(),
            next_offset: 0,
            total_bytes,
            completed: false,
        };
        let epochs = self.epochs.lock().await;
        if epochs.get(&scope.account_id).copied().unwrap_or_default() != epoch {
            drop(epochs);
            let mut writer = writer;
            let _ = writer.shutdown().await;
            target.fs.remove_file(&staged).await?;
            bail!("Upload account retired while the transfer was being created");
        }
        self.entries.lock().await.insert(
            id,
            Arc::new(Mutex::new(Upload {
                epoch,
                scope,
                target,
                staged,
                writer: Some(writer),
                status: status.clone(),
                hash: Sha256::new(),
                expected_hash,
                final_hash: final_hash.to_lowercase(),
                last_chunk: None,
                failed: false,
                publishing: false,
            })),
        );
        Ok(status)
    }
    async fn entry(&self, id: &str) -> Result<Arc<Mutex<Upload>>> {
        self.entries.lock().await.get(id).cloned().ok_or_else(|| {
            anyhow!("Upload transfer is unavailable; the owning runtime may have restarted")
        })
    }
    async fn ensure_active(&self, account_id: String, epoch: u64) -> Result<()> {
        if self
            .epochs
            .lock()
            .await
            .get(&account_id)
            .copied()
            .unwrap_or_default()
            != epoch
        {
            bail!("Upload belongs to a retired account session");
        }
        Ok(())
    }
    pub async fn status(&self, scope: &TransferScope, id: &str) -> Result<UploadStatus> {
        let entry = self.entry(id).await?;
        let upload = entry.lock().await;
        upload.check_scope(scope)?;
        self.ensure_active(upload.scope.account_id.clone(), upload.epoch)
            .await?;
        Ok(upload.status.clone())
    }
    async fn append_inner(
        &self,
        scope: &TransferScope,
        id: &str,
        offset: u64,
        bytes: &[u8],
    ) -> Result<UploadStatus> {
        if bytes.is_empty() || bytes.len() > MAX_UPLOAD_CHUNK {
            bail!("Upload chunk must contain 1..={MAX_UPLOAD_CHUNK} bytes");
        }
        let entry = self.entry(id).await?;
        let mut upload = entry.lock().await;
        upload.check_scope(scope)?;
        self.ensure_active(upload.scope.account_id.clone(), upload.epoch)
            .await?;
        let chunk_hash = hex(&Sha256::digest(bytes));
        if upload
            .last_chunk
            .as_ref()
            .is_some_and(|last| last.0 == offset && last.1 == bytes.len() && last.2 == chunk_hash)
        {
            return Ok(upload.status.clone());
        }
        if upload.status.completed {
            bail!("Upload is already completed");
        }
        if offset != upload.status.next_offset {
            bail!(
                "Upload offset mismatch: expected {}",
                upload.status.next_offset
            );
        }
        let next = offset
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| anyhow!("Upload offset overflow"))?;
        if next > upload.status.total_bytes {
            bail!("Upload exceeds its declared length");
        }
        // A failed write may be partial. Retire this stream rather than invent an acknowledged offset.
        if let Err(error) = upload
            .writer
            .as_mut()
            .ok_or_else(|| anyhow!("Upload stream failed; restart this transfer"))?
            .write_all(bytes)
            .await
        {
            upload.writer.take();
            upload.failed = true;
            return Err(error.into());
        }
        upload.hash.update(bytes);
        upload.status.next_offset = next;
        upload.last_chunk = Some((offset, bytes.len(), chunk_hash));
        Ok(upload.status.clone())
    }
    async fn finish_inner(&self, scope: &TransferScope, id: &str) -> Result<UploadStatus> {
        let entry = self.entry(id).await?;
        let mut upload = entry.lock().await;
        upload.check_scope(scope)?;
        self.ensure_active(upload.scope.account_id.clone(), upload.epoch)
            .await?;
        if upload.status.completed {
            return Ok(upload.status.clone());
        }
        if upload.failed {
            bail!("Upload stream failed; restart this transfer");
        }
        if upload.status.next_offset != upload.status.total_bytes {
            bail!("Upload is incomplete");
        }
        if hex(&upload.hash.clone().finalize()) != upload.final_hash {
            bail!("Upload SHA-256 mismatch");
        }
        if let Some(mut writer) = upload.writer.take() {
            upload.failed = true;
            writer.flush().await?;
            writer.shutdown().await?;
            upload.failed = false;
        }
        let lock = write_guard(format!(
            "{}\0{}",
            upload.scope.target_id, upload.target.path
        ));
        let _guard = lock.lock().await;
        checked_parent(&upload.scope, &upload.target).await?;
        if upload.publishing
            && upload
                .target
                .fs
                .metadata(&upload.staged, false)
                .await?
                .is_none()
        {
            if file_hash(upload.target.fs.as_ref(), &upload.target.path)
                .await?
                .as_deref()
                == Some(upload.final_hash.as_str())
            {
                upload.status.completed = true;
                return Ok(upload.status.clone());
            }
            bail!("Upload publication outcome is uncertain and destination content differs");
        }
        if let Some(expected) = &upload.expected_hash {
            let current = file_hash(upload.target.fs.as_ref(), &upload.target.path).await?;
            if (expected.is_empty() && current.is_some())
                || (!expected.is_empty()
                    && current.as_deref() != Some(expected.to_lowercase().as_str()))
            {
                bail!("FILE_CONFLICT: destination changed during upload");
            }
        }
        upload.publishing = true;
        upload
            .target
            .fs
            .atomic_replace(&upload.staged, &upload.target.path)
            .await?;
        upload.status.completed = true;
        Ok(upload.status.clone())
    }
    pub async fn cancel(&self, scope: &TransferScope, id: &str) -> Result<()> {
        let entry = self.entry(id).await?;
        let mut upload = entry.lock().await;
        upload.check_scope(scope)?;
        if let Some(mut writer) = upload.writer.take() {
            let _ = writer.shutdown().await;
        }
        if !upload.status.completed {
            upload.target.fs.remove_file(&upload.staged).await?;
        }
        self.entries.lock().await.remove(id);
        Ok(())
    }
    /// Explicit account retirement releases only that account's staged transfers.
    pub async fn retire_account(&self, account_id: &str) -> Result<()> {
        {
            let mut epochs = self.epochs.lock().await;
            let epoch = epochs.entry(account_id.to_string()).or_default();
            *epoch = epoch.wrapping_add(1);
        }
        let entries: Vec<_> = self
            .entries
            .lock()
            .await
            .iter()
            .map(|(id, entry)| (id.clone(), entry.clone()))
            .collect();
        for (id, entry) in entries {
            let scope = entry.lock().await.scope.clone();
            if scope.account_id == account_id {
                self.cancel(&scope, &id).await?;
            }
        }
        Ok(())
    }
}
impl Upload {
    fn check_scope(&self, scope: &TransferScope) -> Result<()> {
        if &self.scope != scope {
            bail!("Upload belongs to a different account or workspace target");
        }
        Ok(())
    }
}
async fn file_hash(fs: &dyn WorkspaceFileSystem, path: &str) -> Result<Option<String>> {
    if fs.metadata(path, false).await?.is_none() {
        return Ok(None);
    }
    let mut reader = fs.open_read(path).await?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(Some(hex(&hash.finalize())))
}
async fn checked_parent(scope: &TransferScope, target: &UploadTarget) -> Result<String> {
    let parent = if target.remote {
        if !target.path.starts_with('/')
            || target
                .path
                .split('/')
                .any(|part| part == ".." || part == ".")
        {
            bail!("Upload remote path must be normalized absolute POSIX");
        }
        let root = scope.workspace_root.trim_end_matches('/');
        if !root.is_empty() && !target.path.starts_with(&format!("{root}/")) {
            bail!("Upload is outside its workspace");
        }
        let parent = target
            .path
            .rsplit_once('/')
            .ok_or_else(|| anyhow!("Upload destination has no parent"))?
            .0;
        let mut ancestor = String::new();
        for part in parent.split('/').filter(|part| !part.is_empty()) {
            ancestor.push('/');
            ancestor.push_str(part);
            if target.fs.path_kind_no_follow(&ancestor).await? != Some(WorkspacePathKind::Directory)
            {
                bail!("Upload parent is not a directory or traverses a symlink");
            }
        }
        if parent.is_empty() {
            "/".to_string()
        } else {
            parent.to_string()
        }
    } else {
        let root = tokio::fs::canonicalize(&scope.workspace_root).await?;
        let parent = tokio::fs::canonicalize(
            std::path::Path::new(&target.path)
                .parent()
                .ok_or_else(|| anyhow!("Upload destination has no parent"))?,
        )
        .await?;
        if !parent.starts_with(root) {
            bail!("Upload is outside its workspace");
        }
        parent.to_string_lossy().into_owned()
    };
    if target
        .fs
        .path_kind_no_follow(&target.path)
        .await?
        .is_some_and(|kind| kind != WorkspacePathKind::File)
    {
        bail!("Upload destination is not a regular file");
    }
    Ok(parent)
}

#[cfg(all(test, feature = "workspace-runtime"))]
mod tests {
    use super::*;
    fn scope(root: &std::path::Path) -> TransferScope {
        TransferScope {
            account_id: "account-a".into(),
            target_id: "local".into(),
            workspace_root: root.to_string_lossy().into_owned(),
        }
    }
    fn target(path: &std::path::Path) -> UploadTarget {
        UploadTarget {
            fs: Arc::new(crate::workspace::LocalWorkspaceFs),
            path: path.to_string_lossy().into_owned(),
            remote: false,
        }
    }
    #[tokio::test]
    async fn upload_resume_duplicate_scope_and_atomic_publication() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("file.bin");
        tokio::fs::write(&path, b"old").await.unwrap();
        let transfers = UploadTransfers::default();
        let owner = scope(root.path());
        let content = vec![37u8; MAX_UPLOAD_CHUNK + 19];
        let hash = hex(&Sha256::digest(&content));
        let id = "a".repeat(64);
        transfers
            .begin(
                id.clone(),
                owner.clone(),
                target(&path),
                content.len() as u64,
                hash.clone(),
                Some(hex(&Sha256::digest(b"old"))),
            )
            .await
            .unwrap();
        assert_eq!(
            transfers
                .begin(
                    id.clone(),
                    owner.clone(),
                    target(&path),
                    content.len() as u64,
                    hash,
                    Some(hex(&Sha256::digest(b"old")))
                )
                .await
                .unwrap()
                .next_offset,
            0
        );
        let first = &content[..MAX_UPLOAD_CHUNK];
        transfers.append(&owner, &id, 0, first).await.unwrap();
        assert_eq!(
            transfers
                .append(&owner, &id, 0, first)
                .await
                .unwrap()
                .next_offset,
            MAX_UPLOAD_CHUNK as u64
        );
        assert!(transfers
            .append(&owner, &id, 0, b"different")
            .await
            .is_err());
        let mut other = owner.clone();
        other.account_id = "account-b".into();
        assert!(transfers.status(&other, &id).await.is_err());
        assert_eq!(tokio::fs::read(&path).await.unwrap(), b"old");
        assert!(transfers.finish(&owner, &id).await.is_err());
        let next = transfers.status(&owner, &id).await.unwrap().next_offset;
        transfers
            .append(&owner, &id, next, &content[MAX_UPLOAD_CHUNK..])
            .await
            .unwrap();
        assert!(transfers.finish(&owner, &id).await.unwrap().completed);
        assert!(transfers.finish(&owner, &id).await.unwrap().completed);
        assert_eq!(tokio::fs::read(&path).await.unwrap(), content);
    }
    #[tokio::test]
    async fn upload_observer_cancellation_does_not_interrupt_accepted_chunk() {
        let root = tempfile::tempdir().unwrap();
        let owner = scope(root.path());
        let transfers = UploadTransfers::default();
        let id = "c".repeat(64);
        let (writer, mut receiver) = tokio::io::duplex(8);
        transfers.entries.lock().await.insert(
            id.clone(),
            Arc::new(Mutex::new(Upload {
                epoch: 0,
                scope: owner.clone(),
                target: target(&root.path().join("file")),
                staged: String::new(),
                writer: Some(Box::new(writer)),
                status: UploadStatus {
                    transfer_id: id.clone(),
                    next_offset: 0,
                    total_bytes: 32,
                    completed: false,
                },
                hash: Sha256::new(),
                expected_hash: None,
                final_hash: hex(&Sha256::digest([7u8; 32])),
                last_chunk: None,
                failed: false,
                publishing: false,
            })),
        );
        let called = transfers.clone();
        let called_scope = owner.clone();
        let called_id = id.clone();
        let observer = tokio::spawn(async move {
            called
                .append(&called_scope, &called_id, 0, &[7u8; 32])
                .await
        });
        let mut first = [0u8; 8];
        receiver.read_exact(&mut first).await.unwrap();
        observer.abort();
        let _ = observer.await;
        let mut remaining = [0u8; 24];
        receiver.read_exact(&mut remaining).await.unwrap();
        let status = transfers.status(&owner, &id).await.unwrap();
        assert_eq!(status.next_offset, 32);
        assert_eq!(remaining, [7u8; 24]);
    }

    #[tokio::test]
    async fn upload_late_begin_cannot_reappear_after_account_retirement() {
        let root = tempfile::tempdir().unwrap();
        let owner = scope(root.path());
        let transfers = UploadTransfers::default();
        transfers.retire_account(&owner.account_id).await.unwrap();
        let id = "d".repeat(64);
        assert!(transfers
            .begin_inner(
                id.clone(),
                owner.clone(),
                target(&root.path().join("file")),
                0,
                hex(&Sha256::digest([])),
                None,
                0
            )
            .await
            .unwrap_err()
            .to_string()
            .contains("retired"));
        assert!(transfers.status(&owner, &id).await.is_err());
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn upload_conflict_keeps_original_and_retirement_removes_only_staging() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("file");
        let owner = scope(root.path());
        let transfers = UploadTransfers::default();
        let id = "b".repeat(64);
        transfers
            .begin(
                id.clone(),
                owner.clone(),
                target(&path),
                3,
                hex(&Sha256::digest(b"new")),
                Some(String::new()),
            )
            .await
            .unwrap();
        transfers.append(&owner, &id, 0, b"new").await.unwrap();
        tokio::fs::write(&path, b"other editor").await.unwrap();
        assert!(transfers
            .finish(&owner, &id)
            .await
            .unwrap_err()
            .to_string()
            .contains("FILE_CONFLICT"));
        transfers.retire_account(&owner.account_id).await.unwrap();
        assert_eq!(tokio::fs::read(&path).await.unwrap(), b"other editor");
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
    }
}
