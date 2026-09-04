use crate::service::snapshot::types::{
    FileMetadata, FileSnapshot, OptimizedContent, SnapshotError, SnapshotResult, SnapshotType,
    StorageStats,
};
use crate::service::workspace_runtime::WorkspaceRuntimeContext;
use log::{debug, error, info, warn};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Instant, SystemTime};
use tokio::sync::RwLock;
use uuid::Uuid;

/// Baseline snapshot cache
pub struct BaselineCache {
    /// In-memory cache: file_path -> snapshot_id
    /// `None` indicates it has been queried but does not exist.
    cache: Arc<RwLock<HashMap<PathBuf, Option<String>>>>,

    /// Baseline metadata directory
    baseline_dir: PathBuf,
}

impl BaselineCache {
    /// Creates a new baseline cache.
    pub fn new(baseline_dir: PathBuf) -> Self {
        debug!(
            "BaselineCache initialized: directory={}",
            baseline_dir.display()
        );

        Self {
            cache: Arc::new(RwLock::new(HashMap::new())),
            baseline_dir,
        }
    }

    /// Gets the baseline snapshot ID for a file.
    ///
    /// Strategy: check the in-memory map first; if missing, check the directory, then cache the result.
    pub async fn get(&self, file_path: &Path) -> Option<String> {
        {
            let cache = self.cache.read().await;
            if let Some(cached) = cache.get(file_path) {
                debug!("Baseline cache hit: file_path={:?}", file_path);
                return cached.clone();
            }
        }

        debug!("Querying baseline directory: file_path={:?}", file_path);
        if let Some(snapshot_id) = self.query_directory(file_path).await {
            debug!(
                "Found baseline snapshot: file_path={:?} snapshot_id={}",
                file_path, snapshot_id
            );

            {
                let mut cache = self.cache.write().await;
                cache.insert(file_path.to_path_buf(), Some(snapshot_id.clone()));
            }

            return Some(snapshot_id);
        }

        debug!("Baseline snapshot not found: file_path={:?}", file_path);
        {
            let mut cache = self.cache.write().await;
            cache.insert(file_path.to_path_buf(), None);
        }
        None
    }

    /// Queries baseline snapshots from the directory.
    async fn query_directory(&self, file_path: &Path) -> Option<String> {
        let entries = fs::read_dir(&self.baseline_dir).ok()?;

        let mut found_snapshots: Vec<(SystemTime, String)> = Vec::new();

        for entry in entries.flatten() {
            let path = entry.path();

            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }

            let content = fs::read_to_string(&path).ok()?;
            let metadata: FileSnapshot = serde_json::from_str(&content).ok()?;

            if metadata.snapshot_type == SnapshotType::Baseline && metadata.file_path == file_path {
                found_snapshots.push((metadata.timestamp, metadata.snapshot_id));
            }
        }

        if found_snapshots.is_empty() {
            return None;
        }

        found_snapshots.sort_by_key(|snapshot| std::cmp::Reverse(snapshot.0));
        let (timestamp, snapshot_id) = &found_snapshots[0];

        debug!(
            "Found {} baseline snapshots, using latest: snapshot_id={} timestamp={:?}",
            found_snapshots.len(),
            snapshot_id,
            timestamp
        );

        Some(snapshot_id.clone())
    }

    /// Creates a baseline from a "before" snapshot.
    pub async fn create_from_snapshot(
        &self,
        file_path: &Path,
        before_snapshot_id: &str,
        active_snapshots: &HashMap<String, FileSnapshot>,
    ) -> SnapshotResult<String> {
        debug!(
            "Creating baseline snapshot: file_path={:?} before_snapshot_id={}",
            file_path, before_snapshot_id
        );

        let before_snapshot = active_snapshots
            .get(before_snapshot_id)
            .ok_or_else(|| SnapshotError::SnapshotNotFound(before_snapshot_id.to_string()))?;

        let baseline_id = format!("baseline_{}", Uuid::new_v4());

        let baseline_metadata = FileSnapshot {
            snapshot_id: baseline_id.clone(),
            file_path: file_path.to_path_buf(),
            content_hash: before_snapshot.content_hash.clone(),
            snapshot_type: SnapshotType::Baseline,
            compressed_content: before_snapshot.compressed_content.clone(),
            timestamp: SystemTime::now(),
            metadata: before_snapshot.metadata.clone(),
        };

        let baseline_meta_path = self.baseline_dir.join(format!("{}.json", baseline_id));
        let metadata_json = serde_json::to_string_pretty(&baseline_metadata)?;
        fs::write(&baseline_meta_path, metadata_json)?;

        debug!(
            "Created baseline snapshot: file_path={:?} baseline_id={} metadata_path={}",
            file_path,
            baseline_id,
            baseline_meta_path.display()
        );

        {
            let mut cache = self.cache.write().await;
            cache.insert(file_path.to_path_buf(), Some(baseline_id.clone()));
        }

        Ok(baseline_id)
    }

    /// Creates an empty baseline for files that are first introduced during the session.
    pub async fn create_empty(
        &self,
        file_path: &Path,
        empty_content_hash: &str,
        content_path: &Path,
    ) -> SnapshotResult<String> {
        let baseline_id = format!("baseline_empty_{}", Uuid::new_v4());

        if !content_path.exists() {
            fs::write(content_path, [])?;
        }

        let baseline_metadata = FileSnapshot {
            snapshot_id: baseline_id.clone(),
            file_path: file_path.to_path_buf(),
            content_hash: empty_content_hash.to_string(),
            snapshot_type: SnapshotType::Baseline,
            compressed_content: Vec::new(),
            timestamp: SystemTime::now(),
            metadata: FileMetadata {
                size: 0,
                permissions: None,
                last_modified: SystemTime::now(),
                encoding: "utf-8".to_string(),
            },
        };

        let baseline_meta_path = self.baseline_dir.join(format!("{}.json", baseline_id));
        let metadata_json = serde_json::to_string_pretty(&baseline_metadata)?;
        fs::write(&baseline_meta_path, metadata_json)?;

        {
            let mut cache = self.cache.write().await;
            cache.insert(file_path.to_path_buf(), Some(baseline_id.clone()));
        }

        Ok(baseline_id)
    }
}

/// Simplified file snapshot system
///
/// Only stores snapshots of file content; does not manage a change queue.
pub struct FileSnapshotSystem {
    snapshot_dir: PathBuf,
    snapshot_by_hash_dir: PathBuf,
    snapshot_metadata_dir: PathBuf,
    hash_to_path: HashMap<String, PathBuf>,
    active_snapshots: HashMap<String, FileSnapshot>,
    compression_enabled: bool,
    dedup_enabled: bool,
    streamed_snapshot_threshold: u64,
    baseline_cache: BaselineCache,
}

const SNAPSHOT_ENCODING_SNIFF_LIMIT_BYTES: u64 = 8 * 1024;

impl FileSnapshotSystem {
    /// Creates a new file snapshot system.
    pub fn new(runtime_context: WorkspaceRuntimeContext) -> Self {
        let snapshot_dir = runtime_context.snapshots_dir.clone();

        Self {
            snapshot_by_hash_dir: runtime_context.snapshot_by_hash_dir.clone(),
            snapshot_metadata_dir: runtime_context.snapshot_metadata_dir.clone(),
            snapshot_dir,
            hash_to_path: HashMap::new(),
            active_snapshots: HashMap::new(),
            compression_enabled: true,
            dedup_enabled: true,
            streamed_snapshot_threshold: 32 * 1024 * 1024,
            baseline_cache: BaselineCache::new(runtime_context.snapshot_baselines_dir.clone()),
        }
    }

    /// Initializes the snapshot system.
    pub async fn initialize(&mut self) -> SnapshotResult<()> {
        let total_started_at = Instant::now();
        info!("Initializing file snapshot system");

        let directories_started_at = Instant::now();
        self.ensure_directories().await?;
        debug!(
            "File snapshot initialize step completed: step=ensure_directories duration_ms={}",
            directories_started_at.elapsed().as_millis()
        );

        let index_started_at = Instant::now();
        self.load_snapshot_index().await?;
        debug!(
            "File snapshot initialize step completed: step=load_snapshot_index duration_ms={}",
            index_started_at.elapsed().as_millis()
        );

        info!(
            "File snapshot system initialized: loaded_snapshots={} duration_ms={}",
            self.active_snapshots.len(),
            total_started_at.elapsed().as_millis()
        );
        Ok(())
    }

    /// Ensures required directories exist.
    async fn ensure_directories(&self) -> SnapshotResult<()> {
        let directories = [
            &self.snapshot_dir,
            &self.snapshot_by_hash_dir,
            &self.snapshot_metadata_dir,
            &self.baseline_cache.baseline_dir,
        ];

        for dir in &directories {
            if !dir.exists() {
                return Err(SnapshotError::ConfigError(format!(
                    "Snapshot runtime directory is missing: {}",
                    dir.display()
                )));
            }
        }

        Ok(())
    }

    /// Loads the existing snapshot index.
    ///
    /// Workspaces accumulate thousands of small metadata files, and this load
    /// gates the first snapshot view of a workspace. Reading them sequentially
    /// on one thread costs seconds, so the files are read and parsed on a
    /// bounded set of blocking threads and merged on the async side.
    async fn load_snapshot_index(&mut self) -> SnapshotResult<()> {
        let started_at = Instant::now();
        let metadata_dir = self.snapshot_metadata_dir.clone();

        if !metadata_dir.exists() {
            return Ok(());
        }

        let mut metadata_paths = Vec::new();
        for entry in fs::read_dir(&metadata_dir)? {
            let path = entry?.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                metadata_paths.push(path);
            }
        }

        const MAX_LOAD_THREADS: usize = 8;
        const MIN_FILES_PER_THREAD: usize = 64;
        let thread_count = (metadata_paths.len() / MIN_FILES_PER_THREAD).clamp(1, MAX_LOAD_THREADS);
        let chunk_size = metadata_paths.len().div_ceil(thread_count).max(1);

        let mut load_tasks = Vec::with_capacity(thread_count);
        for chunk in metadata_paths.chunks(chunk_size) {
            let chunk = chunk.to_vec();
            load_tasks.push(tokio::task::spawn_blocking(move || {
                let mut snapshots = Vec::with_capacity(chunk.len());
                for path in chunk {
                    let parsed = fs::read_to_string(&path)
                        .map_err(SnapshotError::from)
                        .and_then(|content| {
                            serde_json::from_str::<FileSnapshot>(&content)
                                .map_err(SnapshotError::from)
                        });
                    match parsed {
                        Ok(snapshot) => snapshots.push(snapshot),
                        Err(e) => {
                            warn!(
                                "Failed to load snapshot metadata: path={} error={}",
                                path.display(),
                                e
                            );
                        }
                    }
                }
                snapshots
            }));
        }

        let mut loaded_count = 0;
        for task in load_tasks {
            let snapshots = task.await.map_err(|e| {
                SnapshotError::ConfigError(format!("Snapshot metadata load task failed: {e}"))
            })?;
            for snapshot in snapshots {
                self.hash_to_path.insert(
                    snapshot.content_hash.clone(),
                    self.get_content_path(&snapshot.content_hash),
                );
                self.active_snapshots
                    .insert(snapshot.snapshot_id.clone(), snapshot);
                loaded_count += 1;
            }
        }

        debug!(
            "Loaded snapshot metadata files: count={} duration_ms={}",
            loaded_count,
            started_at.elapsed().as_millis()
        );
        Ok(())
    }

    /// Loads snapshot metadata.
    async fn load_snapshot_metadata(&self, path: &Path) -> SnapshotResult<FileSnapshot> {
        let content = fs::read_to_string(path)?;
        let snapshot: FileSnapshot = serde_json::from_str(&content)?;
        Ok(snapshot)
    }

    /// Creates a file snapshot.
    pub async fn create_snapshot(&mut self, file_path: &Path) -> SnapshotResult<String> {
        self.create_snapshot_with_ownership(file_path, false).await
    }

    /// Creates a snapshot with an independent metadata handle while retaining
    /// content-addressed blob deduplication. The caller owns this handle and may
    /// delete it without invalidating another operation's snapshot reference.
    pub(crate) async fn create_owned_snapshot(
        &mut self,
        file_path: &Path,
    ) -> SnapshotResult<String> {
        self.create_snapshot_with_ownership(file_path, true).await
    }

    async fn create_snapshot_with_ownership(
        &mut self,
        file_path: &Path,
        independent_handle: bool,
    ) -> SnapshotResult<String> {
        debug!("Creating snapshot: file_path={}", file_path.display());

        if !file_path.exists() {
            error!(
                "File not found for snapshot: file_path={}",
                file_path.display()
            );
            return Err(SnapshotError::FileNotFound(file_path.to_path_buf()));
        }

        let file_size = fs::metadata(file_path).map(|metadata| metadata.len()).unwrap_or(0);

        let metadata = self.extract_file_metadata(file_path).await?;

        let (content_hash, compressed_content) = if file_size > self.streamed_snapshot_threshold {
            // Large files must never be loaded into memory: reading the whole
            // file, hashing it, and attempting gzip on top can each allocate
            // another copy of the file and exhaust the process. Stream the
            // bytes straight into the content store instead.
            let hash = self.stream_content_into_store(file_path)?;

            if !independent_handle
                && self.dedup_enabled
                && self.hash_to_path.contains_key(&hash)
            {
                if let Some(snapshot_id) = self.find_snapshot_by_hash(&hash) {
                    debug!(
                        "Found duplicate content, reusing existing snapshot: content_hash={}",
                        hash
                    );
                    return Ok(snapshot_id);
                }
            }

            (hash, Vec::new())
        } else {
            let content = match fs::read(file_path) {
                Ok(data) => data,
                Err(e) => {
                    error!(
                        "Failed to read file for snapshot: file_path={} error={}",
                        file_path.display(),
                        e
                    );
                    return Err(SnapshotError::Io(e));
                }
            };

            let content_hash = self.calculate_content_hash(&content);

            if !independent_handle
                && self.dedup_enabled
                && self.hash_to_path.contains_key(&content_hash)
            {
                if let Some(snapshot_id) = self.find_snapshot_by_hash(&content_hash) {
                    debug!(
                        "Found duplicate content, reusing existing snapshot: content_hash={}",
                        content_hash
                    );
                    return Ok(snapshot_id);
                }

                debug!(
                    "Found reusable content without active snapshot metadata, creating new snapshot metadata: content_hash={}",
                    content_hash
                );
            }

            let compressed_content = match self.optimize_content(&content) {
                OptimizedContent::Raw(data) => data,
                OptimizedContent::Compressed(data) => data,
                OptimizedContent::Reference(_) => Vec::new(),
            };
            (content_hash, compressed_content)
        };

        let snapshot = FileSnapshot {
            snapshot_id: Uuid::new_v4().to_string(),
            file_path: file_path.to_path_buf(),
            content_hash: content_hash.clone(),
            snapshot_type: SnapshotType::Before,
            compressed_content,
            timestamp: SystemTime::now(),
            metadata,
        };

        self.store_snapshot(&snapshot).await?;

        self.hash_to_path
            .insert(content_hash, self.get_content_path(&snapshot.content_hash));
        let snapshot_id = snapshot.snapshot_id.clone();
        self.active_snapshots.insert(snapshot_id.clone(), snapshot);

        debug!("Snapshot created successfully: snapshot_id={}", snapshot_id);
        Ok(snapshot_id)
    }

    /// Streams a large file into the content store and returns its MD5 hash.
    ///
    /// Memory use stays bounded by the copy buffer regardless of file size.
    /// Content is staged next to the store and renamed into place, so a crash
    /// mid-stream never leaves a partial file under the content-addressed name.
    fn stream_content_into_store(&self, file_path: &Path) -> SnapshotResult<String> {
        use std::io::{BufReader, BufWriter, Read, Write};

        fs::create_dir_all(&self.snapshot_by_hash_dir)?;

        let staging_path = self
            .snapshot_by_hash_dir
            .join(format!(".streaming-{}", Uuid::new_v4()));

        let hashed = (|| -> std::io::Result<String> {
            let input = fs::File::open(file_path)?;
            let mut reader = BufReader::with_capacity(1024 * 1024, input);
            let output = fs::File::create(&staging_path)?;
            let mut writer = BufWriter::with_capacity(1024 * 1024, output);

            let mut hasher = md5::Context::new();
            let mut buffer = vec![0u8; 1024 * 1024];
            loop {
                let read = reader.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                hasher.consume(&buffer[..read]);
                writer.write_all(&buffer[..read])?;
            }
            writer.flush()?;
            Ok(format!("{:x}", hasher.compute()))
        })();

        let content_hash = match hashed {
            Ok(hash) => hash,
            Err(e) => {
                let _ = fs::remove_file(&staging_path);
                return Err(SnapshotError::Io(e));
            }
        };

        let content_path = self.get_content_path(&content_hash);
        if content_path.exists() {
            fs::remove_file(&staging_path)?;
        } else {
            fs::rename(&staging_path, &content_path)?;
        }

        Ok(content_hash)
    }

    /// Extracts file metadata.
    async fn extract_file_metadata(&self, file_path: &Path) -> SnapshotResult<FileMetadata> {
        let metadata = fs::metadata(file_path)?;

        let permissions = {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                Some(metadata.permissions().mode())
            }
            #[cfg(not(unix))]
            {
                None
            }
        };

        let encoding_limit = if metadata.len() > self.streamed_snapshot_threshold {
            Some(SNAPSHOT_ENCODING_SNIFF_LIMIT_BYTES)
        } else {
            None
        };

        let encoding = self
            .detect_file_encoding(file_path, encoding_limit)
            .await
            .unwrap_or_else(|| "utf-8".to_string());

        Ok(FileMetadata {
            size: metadata.len(),
            permissions,
            last_modified: metadata.modified()?,
            encoding,
        })
    }

    /// Detects file encoding.
    ///
    /// `read_limit` bounds how many bytes are inspected; `None` reads the
    /// whole file and keeps the previous exactness for small files.
    async fn detect_file_encoding(&self, file_path: &Path, read_limit: Option<u64>) -> Option<String> {
        use std::io::{BufReader, Read};

        let input = fs::File::open(file_path).ok()?;
        let mut reader = BufReader::new(input);
        let mut bytes = Vec::new();
        let mut chunk = [0u8; 8192];
        loop {
            let want = match read_limit {
                Some(limit) => {
                    let remaining = limit.saturating_sub(bytes.len() as u64);
                    if remaining == 0 {
                        break;
                    }
                    (remaining as usize).min(chunk.len())
                }
                None => chunk.len(),
            };
            match reader.read(&mut chunk[..want]) {
                Ok(0) => break,
                Ok(read) => bytes.extend_from_slice(&chunk[..read]),
                Err(_) => return None,
            }
        }

        if bytes.is_ascii() {
            Some("ascii".to_string())
        } else if String::from_utf8(bytes).is_ok() {
            Some("utf-8".to_string())
        } else {
            Some("binary".to_string())
        }
    }

    /// Computes content hash.
    fn calculate_content_hash(&self, content: &[u8]) -> String {
        format!("{:x}", md5::compute(content))
    }

    /// Optimizes content storage.
    fn optimize_content(&self, content: &[u8]) -> OptimizedContent {
        if self.dedup_enabled {
            let hash = self.calculate_content_hash(content);
            let content_path = self.get_content_path(&hash);
            if self.hash_to_path.contains_key(&hash) && content_path.exists() {
                return OptimizedContent::Reference(hash);
            }
        }

        if self.compression_enabled && content.len() > 1024 {
            match self.compress_content(content) {
                Ok(compressed) => {
                    if compressed.len() < content.len() * 4 / 5 {
                        return OptimizedContent::Compressed(compressed);
                    }
                }
                Err(e) => {
                    warn!("Content compression failed: error={}", e);
                }
            }
        }

        OptimizedContent::Raw(content.to_vec())
    }

    /// Compresses content.
    fn compress_content(&self, content: &[u8]) -> Result<Vec<u8>, std::io::Error> {
        use flate2::write::GzEncoder;
        use flate2::Compression;
        use std::io::Write;

        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(content)?;
        encoder.finish()
    }

    /// Decompresses content.
    fn decompress_content(&self, compressed: &[u8]) -> Result<Vec<u8>, std::io::Error> {
        use flate2::read::GzDecoder;
        use std::io::Read;

        let mut decoder = GzDecoder::new(compressed);
        let mut decompressed = Vec::new();
        decoder.read_to_end(&mut decompressed)?;
        Ok(decompressed)
    }

    /// Stores a snapshot.
    async fn store_snapshot(&self, snapshot: &FileSnapshot) -> SnapshotResult<()> {
        let content_path = self.get_content_path(&snapshot.content_hash);
        if !content_path.exists() {
            fs::write(&content_path, &snapshot.compressed_content)?;
        }

        let metadata_path = self.get_metadata_path(&snapshot.snapshot_id);
        let metadata_json = serde_json::to_string_pretty(snapshot)?;
        fs::write(&metadata_path, metadata_json)?;

        debug!(
            "Snapshot stored: snapshot_id={} content_path={}",
            snapshot.snapshot_id,
            content_path.display()
        );
        Ok(())
    }

    /// Returns the content file path.
    fn get_content_path(&self, content_hash: &str) -> PathBuf {
        self.snapshot_by_hash_dir
            .join(format!("{}.snap", content_hash))
    }

    /// Returns the metadata file path.
    fn get_metadata_path(&self, snapshot_id: &str) -> PathBuf {
        if snapshot_id.starts_with("baseline_") {
            self.baseline_cache
                .baseline_dir
                .join(format!("{}.json", snapshot_id))
        } else {
            self.snapshot_metadata_dir
                .join(format!("{}.json", snapshot_id))
        }
    }

    /// Finds a snapshot ID by hash.
    fn find_snapshot_by_hash(&self, content_hash: &str) -> Option<String> {
        for (snapshot_id, snapshot) in &self.active_snapshots {
            if snapshot.content_hash == content_hash {
                return Some(snapshot_id.clone());
            }
        }
        None
    }

    /// Recorded logical size (bytes) from snapshot metadata, without loading file contents.
    pub async fn get_snapshot_recorded_size_bytes(&self, snapshot_id: &str) -> SnapshotResult<u64> {
        let snapshot = self.load_snapshot_from_disk(snapshot_id).await?;
        Ok(snapshot.metadata.size)
    }

    /// Loads snapshot metadata from disk (without using in-memory cache).
    async fn load_snapshot_from_disk(&self, snapshot_id: &str) -> SnapshotResult<FileSnapshot> {
        debug!(
            "Loading snapshot metadata from disk: snapshot_id={}",
            snapshot_id
        );
        let metadata_path = self.get_metadata_path(snapshot_id);

        if !metadata_path.exists() {
            return Err(SnapshotError::SnapshotNotFound(snapshot_id.to_string()));
        }

        let snapshot = self.load_snapshot_metadata(&metadata_path).await?;
        debug!(
            "Snapshot metadata loaded successfully: snapshot_id={}",
            snapshot_id
        );
        Ok(snapshot)
    }

    /// Gets snapshot content (string), read directly from disk.
    pub async fn get_snapshot_content(&self, snapshot_id: &str) -> SnapshotResult<String> {
        let content_bytes = self.restore_snapshot_content(snapshot_id).await?;
        String::from_utf8(content_bytes).map_err(|e| {
            SnapshotError::ConfigError(format!("Snapshot content is not valid UTF-8: {}", e))
        })
    }

    /// Restores snapshot content (read directly from disk, without using in-memory cache).
    pub async fn restore_snapshot_content(&self, snapshot_id: &str) -> SnapshotResult<Vec<u8>> {
        let snapshot = self.load_snapshot_from_disk(snapshot_id).await?;

        if !snapshot.compressed_content.is_empty() {
            return self.extract_content_from_snapshot(&snapshot);
        }

        let content_path = self.get_content_path(&snapshot.content_hash);
        if !content_path.exists() {
            return Err(SnapshotError::SnapshotNotFound(format!(
                "content file not found: {}",
                content_path.display()
            )));
        }

        let compressed_content = fs::read(&content_path)?;

        match self.decompress_content(&compressed_content) {
            Ok(decompressed) => Ok(decompressed),
            Err(_) => Ok(compressed_content),
        }
    }

    /// Extracts content from a snapshot.
    fn extract_content_from_snapshot(&self, snapshot: &FileSnapshot) -> SnapshotResult<Vec<u8>> {
        if snapshot.compressed_content.is_empty() {
            return Err(SnapshotError::SnapshotNotFound(
                "snapshot content is empty".to_string(),
            ));
        }

        match self.decompress_content(&snapshot.compressed_content) {
            Ok(decompressed) => Ok(decompressed),
            Err(_) => Ok(snapshot.compressed_content.clone()),
        }
    }

    /// Restores a file to the specified path (reads snapshot directly from disk).
    pub async fn restore_file(&self, snapshot_id: &str, target_path: &Path) -> SnapshotResult<()> {
        info!(
            "Restoring file from snapshot: snapshot_id={} target_path={}",
            snapshot_id,
            target_path.display()
        );

        let snapshot = self.load_snapshot_from_disk(snapshot_id).await?;
        let metadata = snapshot.metadata.clone();

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)?;
        }

        if !snapshot.compressed_content.is_empty() {
            // Legacy metadata embeds the content inline; that only happens for
            // small files, so this in-memory path stays bounded.
            let content = self.extract_content_from_snapshot(&snapshot)?;
            fs::write(target_path, content)?;
        } else {
            self.stream_content_to_path(&snapshot.content_hash, target_path)?;
        }

        self.restore_file_metadata(target_path, &metadata).await?;

        info!(
            "File restored successfully: target_path={}",
            target_path.display()
        );
        Ok(())
    }

    /// Streams snapshot content into `target_path` without loading it into memory.
    ///
    /// Content on disk is detected as gzip by magic bytes and streamed through a
    /// decoder when needed. The destination is staged first, so a failed restore
    /// never truncates the original file.
    fn stream_content_to_path(&self, content_hash: &str, target_path: &Path) -> SnapshotResult<()> {
        use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};

        let content_path = self.get_content_path(content_hash);
        if !content_path.exists() {
            return Err(SnapshotError::SnapshotNotFound(format!(
                "content file not found: {}",
                content_path.display()
            )));
        }

        let input = fs::File::open(&content_path)?;
        let mut reader = BufReader::with_capacity(1024 * 1024, input);

        const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];
        let mut magic = [0u8; 2];
        let is_gzip = reader.read_exact(&mut magic).is_ok() && magic == GZIP_MAGIC;
        if !is_gzip {
            reader.seek(SeekFrom::Start(0))?;
        }

        let staging_path = target_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(format!(".restore-staging-{}", Uuid::new_v4()));

        let staging = match fs::File::create(&staging_path) {
            Ok(file) => file,
            Err(e) => {
                let _ = fs::remove_file(&staging_path);
                return Err(SnapshotError::Io(e));
            }
        };
        let mut writer = BufWriter::with_capacity(1024 * 1024, staging);

        let copy_result = if is_gzip {
            let mut decoder = flate2::read::GzDecoder::new(reader);
            std::io::copy(&mut decoder, &mut writer).and_then(|_| writer.flush())
        } else {
            std::io::copy(&mut reader, &mut writer).and_then(|_| writer.flush())
        };

        match copy_result {
            Ok(_) => {
                if fs::rename(&staging_path, target_path).is_err() {
                    if target_path.exists() {
                        fs::remove_file(target_path)?;
                    }
                    fs::rename(&staging_path, target_path)?;
                }
            }
            Err(e) => {
                let _ = fs::remove_file(&staging_path);
                return Err(SnapshotError::Io(e));
            }
        }

        Ok(())
    }

    /// Restores file metadata.
    async fn restore_file_metadata(
        &self,
        file_path: &Path,
        metadata: &FileMetadata,
    ) -> SnapshotResult<()> {
        #[cfg(unix)]
        {
            if let Some(permissions) = metadata.permissions {
                use std::os::unix::fs::PermissionsExt;
                let perms = std::fs::Permissions::from_mode(permissions);
                fs::set_permissions(file_path, perms)?;
            }
        }

        let filetime = filetime::FileTime::from_system_time(metadata.last_modified);
        if let Err(e) = filetime::set_file_mtime(file_path, filetime) {
            warn!("Failed to restore file modification time: error={}", e);
        }

        Ok(())
    }

    /// Deletes a snapshot.
    pub async fn delete_snapshot(&mut self, snapshot_id: &str) -> SnapshotResult<()> {
        info!("Deleting snapshot: snapshot_id={}", snapshot_id);

        let snapshot = self
            .active_snapshots
            .remove(snapshot_id)
            .ok_or_else(|| SnapshotError::SnapshotNotFound(snapshot_id.to_string()))?;

        let content_still_used = self
            .active_snapshots
            .values()
            .any(|s| s.content_hash == snapshot.content_hash);

        if !content_still_used {
            let content_path = self.get_content_path(&snapshot.content_hash);
            if content_path.exists() {
                fs::remove_file(&content_path)?;
            }

            self.hash_to_path.remove(&snapshot.content_hash);
        }

        let metadata_path = self.get_metadata_path(snapshot_id);
        if metadata_path.exists() {
            fs::remove_file(&metadata_path)?;
        }

        debug!("Snapshot deleted successfully: snapshot_id={}", snapshot_id);
        Ok(())
    }

    /// Returns storage statistics.
    pub async fn get_storage_stats(&self) -> SnapshotResult<StorageStats> {
        let mut total_size_bytes = 0;
        let mut compressed_size_bytes = 0;

        let total_snapshots = self.active_snapshots.len();

        let content_dir = self.snapshot_by_hash_dir.clone();
        if content_dir.exists() {
            for entry in fs::read_dir(&content_dir)? {
                let entry = entry?;
                if let Ok(metadata) = entry.metadata() {
                    compressed_size_bytes += metadata.len();
                }
            }
        }

        for snapshot in self.active_snapshots.values() {
            total_size_bytes += snapshot.metadata.size;
        }

        let compression_ratio = if total_size_bytes > 0 {
            compressed_size_bytes as f32 / total_size_bytes as f32
        } else {
            1.0
        };

        let dedup_savings_bytes = if self.dedup_enabled {
            let unique_hashes = self.hash_to_path.len() as u64;
            let total_hashes = total_snapshots as u64;
            if total_hashes > unique_hashes {
                (total_size_bytes * (total_hashes - unique_hashes)) / total_hashes
            } else {
                0
            }
        } else {
            0
        };

        Ok(StorageStats {
            total_snapshots,
            total_size_bytes,
            compressed_size_bytes,
            compression_ratio,
            dedup_savings_bytes,
        })
    }

    /// Cleans up orphaned snapshots.
    pub async fn cleanup_orphaned_snapshots(&mut self) -> SnapshotResult<usize> {
        info!("Cleaning up orphaned snapshots");

        let mut cleaned_count = 0;
        let content_dir = self.snapshot_by_hash_dir.clone();

        if !content_dir.exists() {
            return Ok(0);
        }

        let mut content_files = Vec::new();
        for entry in fs::read_dir(&content_dir)? {
            let entry = entry?;
            if entry.path().extension().and_then(|s| s.to_str()) == Some("snap") {
                content_files.push(entry.path());
            }
        }

        for content_file in content_files {
            if let Some(file_stem) = content_file.file_stem().and_then(|s| s.to_str()) {
                let content_hash = file_stem;

                let is_referenced = self
                    .active_snapshots
                    .values()
                    .any(|snapshot| snapshot.content_hash == content_hash);

                if !is_referenced {
                    fs::remove_file(&content_file)?;
                    self.hash_to_path.remove(content_hash);
                    cleaned_count += 1;
                    debug!(
                        "Deleted orphaned content file: path={}",
                        content_file.display()
                    );
                }
            }
        }

        info!("Cleaned up {} orphaned snapshots", cleaned_count);
        Ok(cleaned_count)
    }

    /// Lists all snapshots.
    pub fn list_snapshots(&self) -> Vec<&FileSnapshot> {
        self.active_snapshots.values().collect()
    }

    /// Returns the snapshot count.
    pub fn snapshot_count(&self) -> usize {
        self.active_snapshots.len()
    }

    /// Gets the baseline snapshot ID for a file.
    ///
    /// Returns: Option<String> - `None` means this file has no baseline
    pub async fn get_baseline_snapshot_id(&self, file_path: &Path) -> Option<String> {
        self.baseline_cache.get(file_path).await
    }

    /// Creates a baseline snapshot.
    ///
    /// Creates a baseline from the specified "before" snapshot.
    /// If a baseline already exists, it will not be created again.
    ///
    /// # Parameters
    /// - file_path: File path
    /// - before_snapshot_id: before snapshot ID
    ///
    /// # Returns
    /// Baseline snapshot ID
    pub async fn create_baseline_from_snapshot(
        &self,
        file_path: &Path,
        before_snapshot_id: &str,
    ) -> SnapshotResult<String> {
        debug!(
            "Creating baseline snapshot: file_path={:?} before_snapshot_id={}",
            file_path, before_snapshot_id
        );

        if let Some(existing_id) = self.get_baseline_snapshot_id(file_path).await {
            debug!(
                "Baseline snapshot already exists: baseline_id={}",
                existing_id
            );
            return Ok(existing_id);
        }

        self.baseline_cache
            .create_from_snapshot(file_path, before_snapshot_id, &self.active_snapshots)
            .await
    }

    /// Creates an empty baseline for files that did not exist before the session.
    pub async fn create_empty_baseline(&mut self, file_path: &Path) -> SnapshotResult<String> {
        let empty_content_hash = self.calculate_content_hash(&[]);
        let content_path = self.get_content_path(&empty_content_hash);

        if !self.hash_to_path.contains_key(&empty_content_hash) {
            self.hash_to_path
                .insert(empty_content_hash.clone(), content_path.clone());
        }

        self.baseline_cache
            .create_empty(file_path, &empty_content_hash, &content_path)
            .await
    }

    /// Checks whether the file has a baseline.
    pub async fn has_baseline(&self, file_path: &Path) -> bool {
        self.get_baseline_snapshot_id(file_path).await.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::workspace_runtime::{WorkspaceRuntimeContext, WorkspaceRuntimeTarget};

    fn test_runtime_context() -> WorkspaceRuntimeContext {
        let runtime_root =
            std::env::temp_dir().join(format!("bitfun_snapshot_test_{}", Uuid::new_v4()));
        WorkspaceRuntimeContext::new(
            WorkspaceRuntimeTarget::LocalWorkspace {
                workspace_root: runtime_root.join("workspace"),
            },
            runtime_root,
        )
    }

    fn create_runtime_dirs(context: &WorkspaceRuntimeContext) {
        for directory in context.required_directories() {
            fs::create_dir_all(directory).expect("create runtime directory");
        }
    }

    #[tokio::test]
    async fn create_snapshot_reuses_empty_baseline_content_without_panicking() {
        let context = test_runtime_context();
        create_runtime_dirs(&context);

        let file_path = context.runtime_root.join("workspace").join("empty.txt");
        fs::create_dir_all(file_path.parent().expect("file has parent")).expect("create parent");

        let mut snapshot_system = FileSnapshotSystem::new(context.clone());
        snapshot_system
            .initialize()
            .await
            .expect("initialize snapshots");
        snapshot_system
            .create_empty_baseline(&file_path)
            .await
            .expect("create empty baseline");

        fs::write(&file_path, []).expect("write empty file");

        let snapshot_id = snapshot_system
            .create_snapshot(&file_path)
            .await
            .expect("create snapshot");
        let restored = snapshot_system
            .restore_snapshot_content(&snapshot_id)
            .await
            .expect("restore snapshot content");

        assert!(restored.is_empty());

        fs::remove_dir_all(&context.runtime_root).expect("cleanup runtime root");
    }

    #[tokio::test]
    async fn owned_snapshot_handle_does_not_delete_an_existing_deduplicated_snapshot() {
        let context = test_runtime_context();
        create_runtime_dirs(&context);
        let file_path = context.runtime_root.join("workspace").join("shared.txt");
        fs::create_dir_all(file_path.parent().expect("file has parent")).expect("create parent");
        fs::write(&file_path, "same content").expect("write fixture");

        let mut snapshot_system = FileSnapshotSystem::new(context.clone());
        snapshot_system
            .initialize()
            .await
            .expect("initialize snapshots");
        let existing = snapshot_system
            .create_snapshot(&file_path)
            .await
            .expect("create existing snapshot");
        let owned = snapshot_system
            .create_owned_snapshot(&file_path)
            .await
            .expect("create independent checkpoint handle");

        assert_ne!(existing, owned);
        snapshot_system
            .delete_snapshot(&owned)
            .await
            .expect("delete owned handle");
        assert_eq!(
            snapshot_system
                .get_snapshot_content(&existing)
                .await
                .expect("existing snapshot must survive"),
            "same content"
        );

        fs::remove_dir_all(&context.runtime_root).expect("cleanup runtime root");
    }

    #[tokio::test]
    async fn create_snapshot_streams_large_files_without_embedding_content() {
        let context = test_runtime_context();
        create_runtime_dirs(&context);
        let file_path = context.runtime_root.join("workspace").join("big.bin");
        fs::create_dir_all(file_path.parent().expect("file has parent")).expect("create parent");

        let mut snapshot_system = FileSnapshotSystem::new(context.clone());
        snapshot_system.streamed_snapshot_threshold = 16;
        snapshot_system
            .initialize()
            .await
            .expect("initialize snapshots");

        let payload = vec![7u8; 64];
        fs::write(&file_path, &payload).expect("write fixture");

        let snapshot_id = snapshot_system
            .create_snapshot(&file_path)
            .await
            .expect("create snapshot");

        let snapshot = snapshot_system
            .active_snapshots
            .get(&snapshot_id)
            .expect("active snapshot")
            .clone();
        assert!(snapshot.compressed_content.is_empty());
        assert_eq!(snapshot.metadata.size, 64);

        let metadata_path = snapshot_system.get_metadata_path(&snapshot_id);
        let metadata_json = fs::read_to_string(&metadata_path).expect("read metadata");
        assert!(
            !metadata_json.contains("[7, 7, 7"),
            "streamed snapshot metadata must not embed file content"
        );

        let content_path = snapshot_system.get_content_path(&snapshot.content_hash);
        assert!(content_path.exists(), "streamed content file must exist");
        let content_dir = content_path.parent().expect("content dir");
        let entries = fs::read_dir(content_dir).expect("read content dir");
        assert_eq!(
            entries.count(),
            1,
            "staging file must be renamed or removed, not left behind"
        );

        let restored = snapshot_system
            .restore_snapshot_content(&snapshot_id)
            .await
            .expect("restore snapshot content");
        assert_eq!(restored, payload);

        let restore_target = context.runtime_root.join("workspace").join("restored.bin");
        snapshot_system
            .restore_file(&snapshot_id, &restore_target)
            .await
            .expect("restore file via streaming");
        assert_eq!(
            fs::read(&restore_target).expect("read restored file"),
            payload
        );

        let leftover_staging = restore_target
            .parent()
            .expect("restore parent")
            .read_dir()
            .expect("read restore parent")
            .filter_map(|entry| entry.ok())
            .any(|entry| entry.file_name().to_string_lossy().starts_with(".restore-staging-"));
        assert!(
            !leftover_staging,
            "restore staging file must be renamed into place, not left behind"
        );

        fs::remove_dir_all(&context.runtime_root).expect("cleanup runtime root");
    }
}
