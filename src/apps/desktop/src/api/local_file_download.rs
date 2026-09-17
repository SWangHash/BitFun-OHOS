//! Controller-local atomic destination for streamed peer downloads.
use serde::{Deserialize, Serialize};
use std::{io::Write, path::PathBuf, sync::Mutex};
use tauri::{Manager, Resource};
use tauri_plugin_fs::FsExt;

struct DownloadSink {
    staging: tempfile::NamedTempFile,
    destination: PathBuf,
    offset: u64,
}
impl DownloadSink {
    fn begin(destination: PathBuf) -> Result<Self, String> {
        let parent = destination
            .parent()
            .ok_or("Missing destination directory")?;
        let staging = tempfile::Builder::new()
            .prefix(".bitfun-download-")
            .tempfile_in(parent)
            .map_err(|e| e.to_string())?;
        Ok(Self {
            staging,
            destination,
            offset: 0,
        })
    }
    fn write(&mut self, offset: u64, bytes: &[u8]) -> Result<(), String> {
        if self.offset != offset {
            return Err("Download offset mismatch".into());
        }
        self.staging.write_all(bytes).map_err(|e| e.to_string())?;
        self.offset += bytes.len() as u64;
        Ok(())
    }
    fn finish(self, expected: u64) -> Result<(), String> {
        if self.offset != expected {
            return Err("Incomplete download".into());
        }
        self.staging
            .as_file()
            .sync_all()
            .map_err(|e| e.to_string())?;
        self.staging
            .persist(&self.destination)
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
struct DownloadResource(Mutex<Option<DownloadSink>>);
impl Resource for DownloadResource {}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum LocalFileDownloadRequest {
    Begin {
        destination: PathBuf,
    },
    Write {
        id: u32,
        offset: u64,
        bytes: Vec<u8>,
    },
    Finish {
        id: u32,
        size: u64,
    },
    Cancel {
        id: u32,
    },
}
#[derive(Serialize)]
pub struct LocalFileDownloadResponse {
    id: u32,
}

#[tauri::command]
pub async fn local_file_download(
    webview: tauri::Webview,
    request: LocalFileDownloadRequest,
) -> Result<LocalFileDownloadResponse, String> {
    // File IO runs off the async executor. Resource IDs belong to this webview,
    // matching the filesystem plugin's lifetime and cross-window isolation.
    tauri::async_runtime::spawn_blocking(move || {
        let id = match request {
            LocalFileDownloadRequest::Begin { destination } => {
                if !destination.is_absolute() || !webview.fs_scope().is_allowed(&destination) {
                    return Err("Download destination is not authorized".into());
                }
                // The selected destination is the only authorized product path.
                // Staging remains private to Rust; no directory scope is granted.
                let sink = DownloadSink::begin(destination)?;
                webview
                    .resources_table()
                    .add(DownloadResource(Mutex::new(Some(sink))))
            }
            LocalFileDownloadRequest::Write { id, offset, bytes } => {
                let resource = webview
                    .resources_table()
                    .get::<DownloadResource>(id)
                    .map_err(|e| e.to_string())?;
                let mut sink = resource.0.lock().map_err(|e| e.to_string())?;
                sink.as_mut()
                    .ok_or("Download already closed")?
                    .write(offset, &bytes)?;
                id
            }
            LocalFileDownloadRequest::Finish { id, size } => {
                let resource = webview
                    .resources_table()
                    .take::<DownloadResource>(id)
                    .map_err(|e| e.to_string())?;
                let sink = resource
                    .0
                    .lock()
                    .map_err(|e| e.to_string())?
                    .take()
                    .ok_or("Download already closed")?;
                sink.finish(size)?;
                id
            }
            LocalFileDownloadRequest::Cancel { id } => {
                let resource = webview
                    .resources_table()
                    .take::<DownloadResource>(id)
                    .map_err(|e| e.to_string())?;
                resource.0.lock().map_err(|e| e.to_string())?.take();
                id
            }
        };
        Ok(LocalFileDownloadResponse { id })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn incomplete_and_cancelled_download_preserve_existing_destination() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("existing");
        std::fs::write(&target, b"original").unwrap();
        let mut sink = DownloadSink::begin(target.clone()).unwrap();
        sink.write(0, b"partial").unwrap();
        assert!(sink.finish(100).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"original");
        drop(DownloadSink::begin(target.clone()).unwrap());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn complete_download_replaces_existing_and_rejects_wrong_offset() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("existing");
        std::fs::write(&target, b"original").unwrap();
        let mut sink = DownloadSink::begin(target.clone()).unwrap();
        assert!(sink.write(1, b"wrong").is_err());
        sink.write(0, b"new").unwrap();
        sink.finish(3).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn failed_replace_cleans_staging_without_removing_target() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("directory");
        std::fs::create_dir(&target).unwrap();
        let sink = DownloadSink::begin(target.clone()).unwrap();
        assert!(sink.finish(0).is_err());
        assert!(target.is_dir());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
