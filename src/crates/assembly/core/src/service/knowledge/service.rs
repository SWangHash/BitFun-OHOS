//! Knowledge base service: the public entry point for base lifecycle, item
//! ingestion, and retrieval.
//!
//! Ingestion runs as detached background work: `add_items`/`reindex_items`
//! persist rows and spawn an indexing task, updating item status through
//! `reading`/`embedding` to a terminal state. This mirrors Cherry Studio's
//! durable workflow while using an in-process task instead of a persistent job
//! queue; interrupted active rows are parked as `failed` on startup.
//!
//! Retrieval is BM25-only for a base without an embedding model and hybrid
//! (BM25 + brute-force cosine, fused with RRF) for a vector-capable base.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::infrastructure::PathManager;
use crate::util::errors::{BitFunError, BitFunResult};

use super::embedding::embed_texts;
use super::rerank::rerank_documents;
use super::store::{KnowledgeStore, KnowledgeUnitInput};
use super::types::{
    KnowledgeAddItemInput, KnowledgeBase, KnowledgeBaseStatus, KnowledgeChunkMetadata,
    KnowledgeItem, KnowledgeItemChunk, KnowledgeItemStatus, KnowledgeItemType,
    KnowledgeSearchResult, DEFAULT_KNOWLEDGE_CHUNK_OVERLAP, DEFAULT_KNOWLEDGE_CHUNK_SEPARATOR,
    DEFAULT_KNOWLEDGE_CHUNK_SIZE, DEFAULT_KNOWLEDGE_CHUNK_STRATEGY,
    DEFAULT_KNOWLEDGE_DOCUMENT_COUNT,
};
use super::vector::encode_vector;

const KNOWLEDGE_SEARCH_OVERFETCH: i64 = 5;
const KNOWLEDGE_SEARCH_CANDIDATE_CAP: i64 = 200;
const RRF_K: f64 = 60.0;
const HYBRID_VECTOR_WEIGHT: f64 = 0.5;
const URL_FETCH_TIMEOUT_SECS: u64 = 60;
const URL_USER_AGENT: &str = "Mozilla/5.0 (compatible; BitFunKnowledge/1.0)";
const EMBEDDING_BATCH_SIZE: usize = 16;

/// Text-like extensions a directory import copies and indexes. Other files are
/// skipped rather than imported and immediately failed.
const DIRECTORY_SUPPORTED_EXTENSIONS: &[&str] = &[
    "txt", "md", "markdown", "mdx", "csv", "json", "html", "htm", "log", "yaml", "yml", "toml",
];

/// Create-base input.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateKnowledgeBaseRequest {
    pub name: String,
    #[serde(default)]
    pub embedding_model_id: Option<String>,
    #[serde(default)]
    pub dimensions: Option<i64>,
    #[serde(default)]
    pub rerank_model_id: Option<String>,
    #[serde(default)]
    pub chunk_size: Option<i64>,
    #[serde(default)]
    pub chunk_overlap: Option<i64>,
    #[serde(default)]
    pub chunk_strategy: Option<String>,
    #[serde(default)]
    pub chunk_separator: Option<String>,
    #[serde(default)]
    pub threshold: Option<f64>,
    #[serde(default)]
    pub document_count: Option<i64>,
}

pub struct KnowledgeService {
    store: Mutex<KnowledgeStore>,
    root: PathBuf,
}

static GLOBAL_KNOWLEDGE_SERVICE: OnceLock<Arc<KnowledgeService>> = OnceLock::new();

pub fn set_global_knowledge_service(service: Arc<KnowledgeService>) {
    let _ = GLOBAL_KNOWLEDGE_SERVICE.set(service);
}

pub fn get_global_knowledge_service() -> Option<Arc<KnowledgeService>> {
    GLOBAL_KNOWLEDGE_SERVICE.get().cloned()
}

impl KnowledgeService {
    pub fn new(path_manager: &PathManager) -> BitFunResult<Self> {
        let root = path_manager.user_data_dir().join("knowledge");
        std::fs::create_dir_all(&root).map_err(|error| {
            BitFunError::service(format!("Failed to create knowledge dir: {error}"))
        })?;
        let store = KnowledgeStore::open(&root.join("knowledge.sqlite"))?;
        Ok(Self {
            store: Mutex::new(store),
            root,
        })
    }

    fn base_dir(&self, base_id: &str) -> PathBuf {
        self.root.join(base_id)
    }

    fn raw_dir(&self, base_id: &str) -> PathBuf {
        self.base_dir(base_id).join("raw")
    }

    // ---- Base lifecycle --------------------------------------------------

    pub fn create_base(&self, request: CreateKnowledgeBaseRequest) -> BitFunResult<KnowledgeBase> {
        let name = request.name.trim();
        if name.is_empty() {
            return Err(BitFunError::validation("Knowledge base name is required"));
        }
        let (embedding_model_id, dimensions) =
            match (request.embedding_model_id, request.dimensions) {
                (Some(model), Some(dimensions)) if dimensions > 0 => {
                    (Some(model), Some(dimensions))
                }
                (None, None) => (None, None),
                _ => {
                    return Err(BitFunError::validation(
                        "Embedding model and dimensions must be provided together",
                    ))
                }
            };

        let now = now_rfc3339();
        let base = KnowledgeBase {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            embedding_model_id,
            dimensions,
            rerank_model_id: request
                .rerank_model_id
                .filter(|value| !value.trim().is_empty()),
            status: KnowledgeBaseStatus::Completed,
            error: None,
            chunk_size: request.chunk_size.unwrap_or(DEFAULT_KNOWLEDGE_CHUNK_SIZE),
            chunk_overlap: request
                .chunk_overlap
                .unwrap_or(DEFAULT_KNOWLEDGE_CHUNK_OVERLAP),
            chunk_strategy: request
                .chunk_strategy
                .unwrap_or_else(|| DEFAULT_KNOWLEDGE_CHUNK_STRATEGY.to_string()),
            chunk_separator: request
                .chunk_separator
                .unwrap_or_else(|| DEFAULT_KNOWLEDGE_CHUNK_SEPARATOR.to_string()),
            threshold: request.threshold,
            document_count: request.document_count,
            created_at: now.clone(),
            updated_at: now,
        };
        if base.chunk_overlap >= base.chunk_size {
            return Err(BitFunError::validation(
                "Chunk overlap must be smaller than chunk size",
            ));
        }

        std::fs::create_dir_all(self.raw_dir(&base.id)).map_err(|error| {
            BitFunError::service(format!("Failed to create base raw dir: {error}"))
        })?;
        self.store()?.insert_base(&base)?;
        Ok(base)
    }

    pub fn list_bases(&self) -> BitFunResult<Vec<KnowledgeBase>> {
        self.store()?.list_bases()
    }

    pub fn get_base(&self, base_id: &str) -> BitFunResult<KnowledgeBase> {
        self.store()?
            .get_base(base_id)?
            .ok_or_else(|| BitFunError::NotFound(format!("Knowledge base '{base_id}' not found")))
    }

    pub fn delete_base(&self, base_id: &str) -> BitFunResult<()> {
        self.get_base(base_id)?;
        self.store()?.delete_base(base_id)?;
        let dir = self.base_dir(base_id);
        if dir.exists() {
            let _ = std::fs::remove_dir_all(dir);
        }
        Ok(())
    }

    /// Recover after an interrupted run: re-queue jobs that were `running`, then
    /// park any active item that has no pending/running job as `failed`.
    /// Called once on startup (see `AppState`).
    pub fn recover_interrupted_items(&self) -> BitFunResult<()> {
        let store = self.store()?;
        let now = now_rfc3339();
        store.reset_running_jobs(&now)?;
        store.fail_orphan_active_items("indexing_interrupted", &now)?;
        Ok(())
    }

    // ---- Items -----------------------------------------------------------

    pub fn add_items(
        self: &Arc<Self>,
        base_id: &str,
        inputs: Vec<KnowledgeAddItemInput>,
    ) -> BitFunResult<Vec<KnowledgeItem>> {
        let base = self.get_base(base_id)?;
        if base.status != KnowledgeBaseStatus::Completed {
            return Err(BitFunError::validation(format!(
                "Knowledge base '{base_id}' is not completed"
            )));
        }

        let mut created = Vec::with_capacity(inputs.len());
        for input in inputs {
            let item = self.create_item_row(&base, input)?;
            self.enqueue_item_job(&base.id, &item)?;
            created.push(item);
        }
        Ok(created)
    }

    pub fn list_items(&self, base_id: &str) -> BitFunResult<Vec<KnowledgeItem>> {
        self.store()?.list_items(base_id)
    }

    pub fn delete_items(&self, base_id: &str, item_ids: Vec<String>) -> BitFunResult<()> {
        let store = self.store()?;
        for item_id in item_ids {
            if let Some(item) = store.get_item(&item_id)? {
                if item.base_id != base_id {
                    return Err(BitFunError::validation(format!(
                        "Knowledge item '{item_id}' does not belong to base '{base_id}'"
                    )));
                }
                store.delete_jobs_for_items(std::slice::from_ref(&item_id))?;
                store.delete_item(&item_id)?;
                self.remove_item_files(&item);
            }
        }
        Ok(())
    }

    pub fn reindex_items(
        self: &Arc<Self>,
        base_id: &str,
        item_ids: Vec<String>,
    ) -> BitFunResult<()> {
        let base = self.get_base(base_id)?;
        for item_id in item_ids {
            let item = self.store()?.get_item(&item_id)?.ok_or_else(|| {
                BitFunError::NotFound(format!("Knowledge item '{item_id}' not found"))
            })?;
            if item.base_id != base_id {
                return Err(BitFunError::validation(format!(
                    "Knowledge item '{item_id}' does not belong to base '{base_id}'"
                )));
            }
            self.set_status(&item_id, KnowledgeItemStatus::Processing, None)?;
            self.enqueue_item_job(&base.id, &item)?;
        }
        Ok(())
    }

    fn enqueue_item_job(&self, base_id: &str, item: &KnowledgeItem) -> BitFunResult<()> {
        let kind = if item.item_type == KnowledgeItemType::Directory {
            "expand"
        } else {
            "index"
        };
        let now = now_rfc3339();
        self.store()?
            .enqueue_job(&Uuid::new_v4().to_string(), base_id, &item.id, kind, &now)
    }

    /// Start the durable job worker. Runs for the process lifetime, claiming
    /// pending jobs one at a time so same-base work stays serialized.
    pub fn start_worker(self: &Arc<Self>) {
        let service = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                let claimed = match service.store() {
                    Ok(store) => store.claim_next_job(&now_rfc3339()),
                    Err(error) => Err(error),
                };
                match claimed {
                    Ok(Some(job)) => service.run_job(job).await,
                    Ok(None) => tokio::time::sleep(std::time::Duration::from_millis(400)).await,
                    Err(error) => {
                        log::warn!("Knowledge job worker failed to claim a job: {error}");
                        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    }
                }
            }
        });
    }

    async fn run_job(self: &Arc<Self>, job: super::store::KnowledgeJobRow) {
        let base = match self.get_base(&job.base_id) {
            Ok(base) => base,
            Err(_) => {
                let _ = self
                    .store()
                    .map(|store| store.complete_job(&job.id, &now_rfc3339()));
                return;
            }
        };
        let item = match self.store().and_then(|store| store.get_item(&job.item_id)) {
            Ok(Some(item)) => item,
            _ => {
                let _ = self
                    .store()
                    .map(|store| store.complete_job(&job.id, &now_rfc3339()));
                return;
            }
        };

        match self.process_item(&base, &item).await {
            Ok(()) => {
                let _ = self
                    .store()
                    .map(|store| store.complete_job(&job.id, &now_rfc3339()));
                if let Some(parent_id) = item.group_id.as_deref() {
                    let _ = self.maybe_complete_parent(&base.id, parent_id);
                }
            }
            Err(error) => {
                log::warn!(
                    "Knowledge job failed: job_id={}, item_id={}, error={}",
                    job.id,
                    item.id,
                    error
                );
                let _ = self.set_status(
                    &item.id,
                    KnowledgeItemStatus::Failed,
                    Some(&error.to_string()),
                );
                let _ = self
                    .store()
                    .map(|store| store.fail_job(&job.id, &error.to_string(), &now_rfc3339()));
                if let Some(parent_id) = item.group_id.as_deref() {
                    let _ = self.maybe_complete_parent(&base.id, parent_id);
                }
            }
        }
    }

    fn maybe_complete_parent(&self, base_id: &str, parent_id: &str) -> BitFunResult<()> {
        let store = self.store()?;
        let items = store.list_items(base_id)?;
        let any_active = items.iter().any(|child| {
            child.group_id.as_deref() == Some(parent_id)
                && matches!(
                    child.status,
                    KnowledgeItemStatus::Preparing
                        | KnowledgeItemStatus::Processing
                        | KnowledgeItemStatus::Reading
                        | KnowledgeItemStatus::Embedding
                )
        });
        if !any_active {
            store.update_item_status(
                parent_id,
                KnowledgeItemStatus::Completed,
                None,
                &now_rfc3339(),
            )?;
        }
        Ok(())
    }

    async fn process_item(&self, base: &KnowledgeBase, item: &KnowledgeItem) -> BitFunResult<()> {
        match item.item_type {
            KnowledgeItemType::Directory => self.expand_directory(base, item).await,
            _ => self.index_leaf(base, item).await,
        }
    }

    // ---- Retrieval -------------------------------------------------------

    pub async fn search(
        &self,
        base_id: &str,
        query: &str,
    ) -> BitFunResult<Vec<KnowledgeSearchResult>> {
        let base = self.get_base(base_id)?;
        if base.status != KnowledgeBaseStatus::Completed {
            return Err(BitFunError::validation(format!(
                "Knowledge base '{base_id}' is not completed"
            )));
        }
        let tokens = tokenize_query(query);
        if tokens.is_empty() {
            return Err(BitFunError::validation("Query has no searchable tokens"));
        }

        let top_k = base
            .document_count
            .unwrap_or(DEFAULT_KNOWLEDGE_DOCUMENT_COUNT);
        let candidate_limit =
            (top_k * KNOWLEDGE_SEARCH_OVERFETCH).min(KNOWLEDGE_SEARCH_CANDIDATE_CAP);

        let bm25_hits = {
            let store = self.store()?;
            if let Some(match_query) = build_match_query(&tokens) {
                store.search_bm25(base_id, &match_query, candidate_limit)?
            } else {
                let patterns: Vec<String> =
                    tokens.iter().map(|token| to_like_pattern(token)).collect();
                store.search_like(base_id, &patterns, candidate_limit)?
            }
        };

        let is_vector = is_vector_base(&base);
        let hits = if is_vector {
            let model_id = base.embedding_model_id.as_deref().unwrap_or_default();
            let dimensions = base.dimensions.unwrap_or(0);
            let query_embedding = embed_texts(model_id, &[query.to_string()], dimensions)
                .await?
                .into_iter()
                .next()
                .ok_or_else(|| BitFunError::service("Embedding model returned no query vector"))?;
            let vector_hits =
                self.store()?
                    .search_vectors(base_id, &query_embedding, candidate_limit)?;
            fuse_rrf(
                vector_hits,
                bm25_hits,
                HYBRID_VECTOR_WEIGHT,
                candidate_limit,
            )
        } else {
            bm25_hits
        };

        let (hits, score_kind) = match base
            .rerank_model_id
            .as_deref()
            .filter(|model| !model.trim().is_empty())
        {
            Some(model) if !hits.is_empty() => {
                match rerank_hits(model, query, &hits, top_k).await {
                    Ok(ranked) => (ranked, "relevance"),
                    Err(error) => {
                        log::warn!("Knowledge rerank failed; returning base ranking: {error}");
                        (hits, "ranking")
                    }
                }
            }
            _ => (hits, "ranking"),
        };

        self.to_visible_results(base_id, hits, top_k, score_kind)
    }

    pub fn list_item_chunks(
        &self,
        base_id: &str,
        item_id: &str,
    ) -> BitFunResult<Vec<KnowledgeItemChunk>> {
        let store = self.store()?;
        let item = store.get_item(item_id)?.ok_or_else(|| {
            BitFunError::NotFound(format!("Knowledge item '{item_id}' not found"))
        })?;
        if item.base_id != base_id {
            return Err(BitFunError::validation(format!(
                "Knowledge item '{item_id}' does not belong to base '{base_id}'"
            )));
        }
        if item.status != KnowledgeItemStatus::Completed {
            return Err(BitFunError::validation(format!(
                "Knowledge item '{item_id}' must be completed before listing chunks"
            )));
        }
        let units = store.list_units(item_id)?;
        Ok(units
            .into_iter()
            .map(|unit| KnowledgeItemChunk {
                id: unit.unit_id,
                item_id: item_id.to_string(),
                content: unit.text.clone(),
                metadata: chunk_metadata(&item, unit.unit_index, &unit.text),
            })
            .collect())
    }

    /// Absolute on-disk path of a file/note/url item's stored source bytes.
    pub fn get_file_path(&self, item_id: &str) -> BitFunResult<PathBuf> {
        let item = self.store()?.get_item(item_id)?.ok_or_else(|| {
            BitFunError::NotFound(format!("Knowledge item '{item_id}' not found"))
        })?;
        let relative = item
            .data
            .get("relativePath")
            .and_then(|value| value.as_str())
            .ok_or_else(|| {
                BitFunError::validation(format!("Knowledge item '{item_id}' has no stored source"))
            })?;
        Ok(self.raw_dir(&item.base_id).join(relative))
    }

    // ---- Internal --------------------------------------------------------

    fn store(&self) -> BitFunResult<std::sync::MutexGuard<'_, KnowledgeStore>> {
        self.store
            .lock()
            .map_err(|_| BitFunError::service("Knowledge store lock poisoned"))
    }

    fn set_status(
        &self,
        item_id: &str,
        status: KnowledgeItemStatus,
        error: Option<&str>,
    ) -> BitFunResult<()> {
        self.store()?
            .update_item_status(item_id, status, error, &now_rfc3339())
    }

    fn to_visible_results(
        &self,
        base_id: &str,
        hits: Vec<super::store::KnowledgeSearchHit>,
        top_k: i64,
        score_kind: &str,
    ) -> BitFunResult<Vec<KnowledgeSearchResult>> {
        let store = self.store()?;
        let mut results = Vec::new();
        for hit in hits {
            let Some(item) = store.get_item(&hit.item_id)? else {
                continue;
            };
            if item.base_id != base_id
                || item.status != KnowledgeItemStatus::Completed
                || item.status == KnowledgeItemStatus::Deleting
            {
                continue;
            }
            results.push(KnowledgeSearchResult {
                page_content: hit.text.clone(),
                score: hit.score,
                score_kind: score_kind.to_string(),
                rank: results.len() as i64 + 1,
                metadata: chunk_metadata(&item, hit.unit_index, &hit.text),
                item_id: item.id.clone(),
                chunk_id: hit.unit_id,
            });
            if results.len() as i64 >= top_k {
                break;
            }
        }
        Ok(results)
    }

    fn create_item_row(
        &self,
        base: &KnowledgeBase,
        input: KnowledgeAddItemInput,
    ) -> BitFunResult<KnowledgeItem> {
        let item_type = input.item_type();
        let group_id = input.group_id().map(str::to_string);
        let data = match &input {
            KnowledgeAddItemInput::File { data, .. } => serde_json::json!({
                "source": data.source,
                "path": data.path,
            }),
            KnowledgeAddItemInput::Url { data, .. } => serde_json::json!({
                "source": data.source,
                "url": data.url,
            }),
            KnowledgeAddItemInput::Note { data, .. } => serde_json::json!({
                "source": data.source,
                "content": data.content,
            }),
            KnowledgeAddItemInput::Directory { data, .. } => serde_json::json!({
                "source": data.source,
            }),
        };

        let now = now_rfc3339();
        let item = KnowledgeItem {
            id: Uuid::new_v4().to_string(),
            base_id: base.id.clone(),
            group_id,
            item_type,
            data,
            status: KnowledgeItemStatus::Processing,
            error: None,
            created_at: now.clone(),
            updated_at: now,
        };
        self.store()?.insert_item(&item)?;
        Ok(item)
    }

    /// Index a leaf (file/url/note) item end to end.
    async fn index_leaf(&self, base: &KnowledgeBase, item: &KnowledgeItem) -> BitFunResult<()> {
        self.set_status(&item.id, KnowledgeItemStatus::Reading, None)?;
        let (content, relative_path) = self.load_leaf_content(base, item).await?;

        let chunks = split_text(
            &content,
            base.chunk_size,
            base.chunk_overlap,
            &base.chunk_separator,
        );
        if chunks.is_empty() {
            return Err(BitFunError::validation(
                "No indexable text was extracted from the source",
            ));
        }

        let content_hash = hash_text(&content);
        let is_vector = is_vector_base(base);

        let mut body_by_hash: HashMap<String, String> = HashMap::new();
        let mut unit_hashes: Vec<String> = Vec::with_capacity(chunks.len());
        for chunk in &chunks {
            let hash = hash_embedding_text(&chunk.text);
            body_by_hash
                .entry(hash.clone())
                .or_insert_with(|| chunk.text.clone());
            unit_hashes.push(hash);
        }

        let mut embeddings: Vec<(String, Vec<u8>)> = Vec::new();
        if is_vector {
            self.set_status(&item.id, KnowledgeItemStatus::Embedding, None)?;
            let existing = {
                let store = self.store()?;
                let hashes: Vec<String> = body_by_hash.keys().cloned().collect();
                store.list_existing_embedding_hashes(&hashes)?
            };
            let missing: Vec<(String, String)> = body_by_hash
                .iter()
                .filter(|(hash, _)| !existing.contains(*hash))
                .map(|(hash, body)| (hash.clone(), body.clone()))
                .collect();

            let model_id = base.embedding_model_id.as_deref().unwrap_or_default();
            let dimensions = base.dimensions.unwrap_or(0);
            for batch in missing.chunks(EMBEDDING_BATCH_SIZE) {
                let values: Vec<String> = batch.iter().map(|(_, body)| body.clone()).collect();
                let vectors = embed_texts(model_id, &values, dimensions).await?;
                for ((hash, _), vector) in batch.iter().zip(vectors.iter()) {
                    embeddings.push((hash.clone(), encode_vector(vector)));
                }
            }
        }

        let units: Vec<KnowledgeUnitInput> = chunks
            .iter()
            .enumerate()
            .map(|(index, chunk)| KnowledgeUnitInput {
                unit_id: stable_unit_id(
                    &item.id,
                    &content_hash,
                    index as i64,
                    chunk.start,
                    chunk.end,
                ),
                unit_index: index as i64,
                char_start: chunk.start,
                char_end: chunk.end,
                text: chunk.text.clone(),
                embedding_text_hash: if is_vector {
                    Some(unit_hashes[index].clone())
                } else {
                    None
                },
            })
            .collect();

        {
            let store = self.store()?;
            // The item may have been deleted while we were reading/embedding.
            match store.get_item(&item.id)? {
                Some(current)
                    if current.status != KnowledgeItemStatus::Deleting
                        && current.base_id == base.id => {}
                _ => return Ok(()),
            }
            store.replace_material(
                &item.id,
                &base.id,
                &relative_path,
                &content_hash,
                &units,
                &embeddings,
                &now_rfc3339(),
            )?;
        }

        let mut data = item.data.clone();
        if let Some(object) = data.as_object_mut() {
            object.insert(
                "relativePath".to_string(),
                serde_json::Value::String(relative_path),
            );
        }
        self.store()?
            .update_item_data(&item.id, &data, &now_rfc3339())?;
        self.set_status(&item.id, KnowledgeItemStatus::Completed, None)?;
        Ok(())
    }

    /// Expand a directory owner into file children and index each child.
    async fn expand_directory(
        &self,
        base: &KnowledgeBase,
        owner: &KnowledgeItem,
    ) -> BitFunResult<()> {
        self.set_status(&owner.id, KnowledgeItemStatus::Preparing, None)?;
        let source = owner
            .data
            .get("source")
            .and_then(|value| value.as_str())
            .ok_or_else(|| BitFunError::validation("Knowledge directory item has no source"))?;
        let source_path = PathBuf::from(source);
        if !source_path.is_dir() {
            return Err(BitFunError::validation(format!(
                "Knowledge directory source '{source}' is not a directory"
            )));
        }

        let prefix = self.reserve_directory_prefix(&base.id, &source_path)?;
        let files = collect_directory_files(&source_path)?;
        let mut children = Vec::new();
        for (absolute, relative) in files {
            let material_relative = format!("{prefix}/{relative}");
            let destination = self.raw_dir(&base.id).join(&material_relative);
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent).map_err(|error| {
                    BitFunError::service(format!("Failed to create directory import dir: {error}"))
                })?;
            }
            std::fs::copy(&absolute, &destination).map_err(|error| {
                BitFunError::service(format!(
                    "Failed to copy '{}' into knowledge base: {error}",
                    absolute.display()
                ))
            })?;

            let data = serde_json::json!({
                "source": absolute.to_string_lossy(),
                "relativePath": material_relative,
            });
            let child = self.create_child_item(base, owner, data)?;
            children.push(child);
        }

        // Persist the deduped prefix on the owner, then enqueue one index job per
        // child. The owner stays `processing`; `maybe_complete_parent` completes it
        // once every child job is terminal.
        let mut data = owner.data.clone();
        if let Some(object) = data.as_object_mut() {
            object.insert(
                "relativePath".to_string(),
                serde_json::Value::String(prefix),
            );
        }
        self.store()?
            .update_item_data(&owner.id, &data, &now_rfc3339())?;
        self.set_status(&owner.id, KnowledgeItemStatus::Processing, None)?;

        for child in &children {
            self.enqueue_item_job(&base.id, child)?;
        }
        // A directory with no supported files has no children to wait on.
        if children.is_empty() {
            self.set_status(&owner.id, KnowledgeItemStatus::Completed, None)?;
        }
        Ok(())
    }

    fn create_child_item(
        &self,
        base: &KnowledgeBase,
        owner: &KnowledgeItem,
        data: serde_json::Value,
    ) -> BitFunResult<KnowledgeItem> {
        let now = now_rfc3339();
        let item = KnowledgeItem {
            id: Uuid::new_v4().to_string(),
            base_id: base.id.clone(),
            group_id: Some(owner.id.clone()),
            item_type: KnowledgeItemType::File,
            data,
            status: KnowledgeItemStatus::Processing,
            error: None,
            created_at: now.clone(),
            updated_at: now,
        };
        self.store()?.insert_item(&item)?;
        Ok(item)
    }

    fn reserve_directory_prefix(&self, base_id: &str, source: &Path) -> BitFunResult<String> {
        let store = self.store()?;
        let items = store.list_items(base_id)?;
        let mut reserved = std::collections::HashSet::new();
        for item in &items {
            if let Some(path) = item
                .data
                .get("relativePath")
                .and_then(|value| value.as_str())
            {
                reserved.insert(path.to_string());
            }
        }
        let name = source
            .file_name()
            .and_then(|value| value.to_str())
            .map(sanitize_segment)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "directory".to_string());
        let mut candidate = name.clone();
        let mut counter = 2;
        while reserved.contains(&candidate) {
            candidate = format!("{name}_{counter}");
            counter += 1;
        }
        Ok(candidate)
    }

    /// Resolve and persist an item's indexable content, returning the content and
    /// its base-relative stored path.
    async fn load_leaf_content(
        &self,
        base: &KnowledgeBase,
        item: &KnowledgeItem,
    ) -> BitFunResult<(String, String)> {
        match item.item_type {
            KnowledgeItemType::Note => {
                let content = item
                    .data
                    .get("content")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string();
                if content.trim().is_empty() {
                    return Err(BitFunError::validation("Knowledge note has empty content"));
                }
                if let Some(relative) = existing_relative_path(item) {
                    return Ok((content, relative));
                }
                let source = item
                    .data
                    .get("source")
                    .and_then(|value| value.as_str())
                    .unwrap_or("note");
                let relative = self.reserve_relative_path(&base.id, &note_slug(source), "md")?;
                self.write_raw(&base.id, &relative, content.as_bytes())?;
                Ok((content, relative))
            }
            KnowledgeItemType::File => {
                if let Some(relative) = existing_relative_path(item) {
                    let absolute = self.raw_dir(&base.id).join(&relative);
                    let bytes = std::fs::read(&absolute).map_err(|error| {
                        BitFunError::service(format!(
                            "Failed to read knowledge source '{}': {error}",
                            absolute.display()
                        ))
                    })?;
                    return Ok((decode_text(bytes)?, relative));
                }
                let source_path = item
                    .data
                    .get("path")
                    .and_then(|value| value.as_str())
                    .or_else(|| item.data.get("source").and_then(|value| value.as_str()))
                    .ok_or_else(|| {
                        BitFunError::validation("Knowledge file item has no source path")
                    })?;
                let bytes = std::fs::read(source_path).map_err(|error| {
                    BitFunError::service(format!(
                        "Failed to read knowledge source '{source_path}': {error}"
                    ))
                })?;
                let is_document =
                    tool_runtime::fs::document::is_supported_document_path(source_path);
                let content = if is_document {
                    let document = tool_runtime::fs::document::convert_document_to_markdown(
                        bytes,
                        source_path.to_string(),
                    )
                    .await
                    .map_err(|error| {
                        BitFunError::service(format!(
                            "Failed to convert document '{source_path}': {error}"
                        ))
                    })?;
                    document.markdown.to_string()
                } else {
                    decode_text(bytes)?
                };
                let file_name = Path::new(source_path)
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("file.txt");
                let (stem, extension) = split_file_name(file_name);
                // Converted documents are stored as their markdown projection so a
                // reindex reads the artifact instead of re-parsing the original.
                let store_extension = if is_document {
                    "md".to_string()
                } else {
                    extension
                };
                let relative = self.reserve_relative_path(&base.id, &stem, &store_extension)?;
                self.write_raw(&base.id, &relative, content.as_bytes())?;
                Ok((content, relative))
            }
            KnowledgeItemType::Url => {
                if let Some(relative) = existing_relative_path(item) {
                    let absolute = self.raw_dir(&base.id).join(&relative);
                    let bytes = std::fs::read(&absolute).map_err(|error| {
                        BitFunError::service(format!(
                            "Failed to read knowledge snapshot '{}': {error}",
                            absolute.display()
                        ))
                    })?;
                    return Ok((decode_text(bytes)?, relative));
                }
                let url = item
                    .data
                    .get("url")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| BitFunError::validation("Knowledge URL item has no url"))?;
                let (markdown, title) = fetch_url_markdown(url).await?;
                if markdown.trim().is_empty() {
                    return Err(BitFunError::validation(format!(
                        "Knowledge URL returned empty content: {url}"
                    )));
                }
                let slug = note_slug(title.as_deref().unwrap_or(url));
                let relative = self.reserve_relative_path(&base.id, &slug, "md")?;
                self.write_raw(&base.id, &relative, markdown.as_bytes())?;
                Ok((markdown, relative))
            }
            KnowledgeItemType::Directory => Err(BitFunError::validation(
                "Directory items are expanded, not indexed directly",
            )),
        }
    }

    fn write_raw(&self, base_id: &str, relative: &str, bytes: &[u8]) -> BitFunResult<()> {
        let absolute = self.raw_dir(base_id).join(relative);
        if let Some(parent) = absolute.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                BitFunError::service(format!("Failed to create knowledge dir: {error}"))
            })?;
        }
        std::fs::write(&absolute, bytes).map_err(|error| {
            BitFunError::service(format!("Failed to write knowledge file: {error}"))
        })
    }

    fn reserve_relative_path(
        &self,
        base_id: &str,
        stem: &str,
        extension: &str,
    ) -> BitFunResult<String> {
        let store = self.store()?;
        let items = store.list_items(base_id)?;
        let mut reserved = std::collections::HashSet::new();
        for item in &items {
            if let Some(path) = item
                .data
                .get("relativePath")
                .and_then(|value| value.as_str())
            {
                reserved.insert(path.to_string());
            }
        }

        let candidate = |stem: &str| -> String {
            if extension.is_empty() {
                stem.to_string()
            } else {
                format!("{stem}.{extension}")
            }
        };
        let mut name = candidate(stem);
        let mut counter = 2;
        while reserved.contains(&name) {
            name = candidate(&format!("{stem}_{counter}"));
            counter += 1;
        }
        Ok(name)
    }

    fn remove_item_files(&self, item: &KnowledgeItem) {
        if let Some(relative) = item
            .data
            .get("relativePath")
            .and_then(|value| value.as_str())
        {
            let absolute = self.raw_dir(&item.base_id).join(relative);
            let _ = std::fs::remove_file(absolute);
        }
    }
}

// ============================================================================
// Chunking and query helpers
// ============================================================================

struct TextChunk {
    text: String,
    start: i64,
    end: i64,
}

fn is_vector_base(base: &KnowledgeBase) -> bool {
    base.embedding_model_id.is_some() && base.dimensions.unwrap_or(0) > 0
}

fn existing_relative_path(item: &KnowledgeItem) -> Option<String> {
    item.data
        .get("relativePath")
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

fn decode_text(bytes: Vec<u8>) -> BitFunResult<String> {
    String::from_utf8(bytes).map_err(|_| {
        BitFunError::validation("Only UTF-8 text and Markdown files are supported in this build")
    })
}

/// Split text into overlapping chunks, preferring paragraph boundaries within a
/// look-back window. Character-budget based for the first slice; token-accurate
/// sizing (as Cherry Studio uses) is a follow-up.
fn split_text(text: &str, chunk_size: i64, chunk_overlap: i64, separator: &str) -> Vec<TextChunk> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    // Convert the token budget to a character budget once, using the document's
    // own chars-per-token ratio, so sizing stays accurate for Latin and CJK
    // without re-tokenizing each window.
    let estimated_tokens = crate::util::token_counter::TokenCounter::estimate_tokens(text).max(1);
    let chars_per_token = text.len() as f64 / estimated_tokens as f64;
    let max_chars = ((chunk_size.max(1) as f64) * chars_per_token)
        .round()
        .max(1.0) as usize;
    let overlap_chars = (((chunk_overlap.max(0) as f64) * chars_per_token).round() as usize)
        .min(max_chars.saturating_sub(1));
    let window_chars = (max_chars as f64 * 0.22).max(1.0) as usize;
    let separator = unescape_separator(separator);

    let mut chunks = Vec::new();
    let mut cursor = 0usize;
    while cursor < text.len() {
        let mut end = floor_char_boundary(text, cursor + max_chars);
        if end < text.len() {
            if let Some(cutoff) = find_cutoff(text, end, window_chars, &separator) {
                if cutoff > cursor {
                    end = cutoff;
                }
            }
        }
        if let Some(chunk) = trim_chunk(text, cursor, end) {
            chunks.push(chunk);
        }
        if end >= text.len() {
            break;
        }
        let next = floor_char_boundary(text, end.saturating_sub(overlap_chars));
        cursor = if next > cursor { next } else { end };
    }
    chunks
}

/// Snap an index down to the nearest UTF-8 character boundary so slicing never
/// panics on multibyte text (CJK content is common).
fn floor_char_boundary(text: &str, index: usize) -> usize {
    let mut index = index.min(text.len());
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn find_cutoff(text: &str, target: usize, window: usize, separator: &str) -> Option<usize> {
    let target = floor_char_boundary(text, target);
    let window_start = floor_char_boundary(text, target.saturating_sub(window));
    let haystack = &text[window_start..target];
    let mut best: Option<(usize, usize)> = None;
    let consider = |pos: usize, quality: usize, best: &mut Option<(usize, usize)>| {
        if best.map(|(_, current)| quality > current).unwrap_or(true) {
            *best = Some((pos, quality));
        }
    };
    if let Some(offset) = haystack.rfind("\n\n") {
        consider(window_start + offset + 2, 20, &mut best);
    }
    if !separator.is_empty() {
        if let Some(offset) = haystack.rfind(separator) {
            consider(window_start + offset + separator.len(), 30, &mut best);
        }
    }
    if let Some(offset) = haystack.rfind('\n') {
        consider(window_start + offset + 1, 1, &mut best);
    }
    best.map(|(pos, _)| pos)
}

fn trim_chunk(text: &str, start: usize, end: usize) -> Option<TextChunk> {
    let slice = text.get(start..end)?;
    let leading = slice.len() - slice.trim_start().len();
    let trailing = slice.len() - slice.trim_end().len();
    let trimmed_start = start + leading;
    let trimmed_end = end - trailing;
    if trimmed_start >= trimmed_end {
        return None;
    }
    Some(TextChunk {
        text: text[trimmed_start..trimmed_end].to_string(),
        start: trimmed_start as i64,
        end: trimmed_end as i64,
    })
}

fn unescape_separator(raw: &str) -> String {
    raw.replace("\\n", "\n")
        .replace("\\t", "\t")
        .replace("\\r", "\r")
        .replace("\\\\", "\\")
}

fn hash_text(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn hash_embedding_text(text: &str) -> String {
    hash_text(text)
}

fn stable_unit_id(
    material_id: &str,
    content_hash: &str,
    index: i64,
    start: i64,
    end: i64,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(material_id.as_bytes());
    hasher.update(b"\0");
    hasher.update(content_hash.as_bytes());
    hasher.update(b"\0");
    hasher.update(index.to_string().as_bytes());
    hasher.update(b"\0");
    hasher.update(start.to_string().as_bytes());
    hasher.update(b"\0");
    hasher.update(end.to_string().as_bytes());
    format!("{:x}", hasher.finalize())
}

fn tokenize_query(query: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for character in query.chars() {
        if character.is_alphanumeric() || character == '_' {
            current.push(character);
        } else if !current.is_empty() {
            tokens.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn build_match_query(tokens: &[String]) -> Option<String> {
    let terms: Vec<&String> = tokens
        .iter()
        .filter(|token| token.chars().count() >= 3)
        .collect();
    if terms.is_empty() {
        return None;
    }
    Some(
        terms
            .iter()
            .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" OR "),
    )
}

fn to_like_pattern(token: &str) -> String {
    let escaped = token
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

/// Reciprocal Rank Fusion of the vector and BM25 lanes.
fn fuse_rrf(
    vector: Vec<super::store::KnowledgeSearchHit>,
    bm25: Vec<super::store::KnowledgeSearchHit>,
    vector_weight: f64,
    top_k: i64,
) -> Vec<super::store::KnowledgeSearchHit> {
    let mut fused: HashMap<String, (super::store::KnowledgeSearchHit, f64)> = HashMap::new();
    let mut accumulate = |hits: Vec<super::store::KnowledgeSearchHit>, weight: f64| {
        for (rank, hit) in hits.into_iter().enumerate() {
            let contribution = weight / (RRF_K + rank as f64 + 1.0);
            fused
                .entry(hit.unit_id.clone())
                .and_modify(|(_, score)| *score += contribution)
                .or_insert_with(|| (hit, contribution));
        }
    };
    accumulate(vector, vector_weight);
    accumulate(bm25, 1.0 - vector_weight);

    let mut results: Vec<(super::store::KnowledgeSearchHit, f64)> = fused.into_values().collect();
    results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(top_k.max(0) as usize);
    results
        .into_iter()
        .map(|(mut hit, score)| {
            hit.score = score;
            hit
        })
        .collect()
}

/// Rerank retrieval hits, returning them reordered by relevance. A rerank model
/// is optional; the caller falls back to the base ranking on any error.
async fn rerank_hits(
    model_id: &str,
    query: &str,
    hits: &[super::store::KnowledgeSearchHit],
    top_n: i64,
) -> BitFunResult<Vec<super::store::KnowledgeSearchHit>> {
    let documents: Vec<String> = hits.iter().map(|hit| hit.text.clone()).collect();
    let scores = rerank_documents(model_id, query, &documents, top_n.max(0) as usize).await?;
    let mut ranked = Vec::with_capacity(scores.len());
    for score in scores {
        if let Some(hit) = hits.get(score.original_index) {
            let mut hit = hit.clone();
            hit.score = f64::from(score.score);
            ranked.push(hit);
        }
    }
    Ok(ranked)
}

fn chunk_metadata(item: &KnowledgeItem, chunk_index: i64, text: &str) -> KnowledgeChunkMetadata {
    let source = item
        .data
        .get("source")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    KnowledgeChunkMetadata {
        item_id: item.id.clone(),
        item_type: item.item_type,
        source,
        chunk_index,
        token_count: estimate_token_count(text),
    }
}

fn estimate_token_count(text: &str) -> i64 {
    let mut cjk = 0usize;
    let mut other = 0usize;
    for character in text.chars() {
        if is_cjk(character) {
            cjk += 1;
        } else {
            other += 1;
        }
    }
    (cjk + other.div_ceil(4)) as i64
}

fn is_cjk(character: char) -> bool {
    matches!(character as u32, 0x4E00..=0x9FFF | 0x3040..=0x30FF | 0xAC00..=0xD7AF)
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn split_file_name(file_name: &str) -> (String, String) {
    match file_name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem.to_string(), extension.to_string()),
        _ => (file_name.to_string(), String::new()),
    }
}

fn note_slug(source: &str) -> String {
    let first_line = source
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or(source);
    let sanitized = sanitize_segment(first_line);
    if sanitized.is_empty() {
        "note".to_string()
    } else {
        sanitized
    }
}

fn sanitize_segment(value: &str) -> String {
    value
        .trim()
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\n' | '\r' | '\t' => '_',
            _ => character,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string()
}

// ============================================================================
// URL fetching and directory scanning
// ============================================================================

/// Fetch a URL and return extracted markdown (or raw text for non-HTML) plus an
/// optional title.
async fn fetch_url_markdown(url: &str) -> BitFunResult<(String, Option<String>)> {
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(URL_FETCH_TIMEOUT_SECS))
        .build()
        .map_err(|error| BitFunError::service(format!("Failed to build http client: {error}")))?;
    let response = http
        .get(url)
        .header(reqwest::header::USER_AGENT, URL_USER_AGENT)
        .send()
        .await
        .map_err(|error| BitFunError::service(format!("Failed to fetch '{url}': {error}")))?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response
        .text()
        .await
        .map_err(|error| BitFunError::service(format!("Failed to read '{url}': {error}")))?;
    if !status.is_success() {
        return Err(BitFunError::service(format!(
            "Fetching '{url}' returned {status}"
        )));
    }

    if !looks_like_html(content_type.as_deref(), &body) {
        return Ok((body, None));
    }

    let article = legible::parse(
        &body,
        Some(url),
        Some(legible::Options::new().char_threshold(200)),
    )
    .map_err(|error| {
        BitFunError::service(format!("Failed to extract article from '{url}': {error}"))
    })?;
    let converter = htmd::HtmlToMarkdown::builder()
        .skip_tags(vec!["script", "style", "noscript", "iframe"])
        .build();
    let markdown = converter.convert(&article.content).map_err(|error| {
        BitFunError::service(format!("Failed to convert HTML to markdown: {error}"))
    })?;
    let title = if article.title.trim().is_empty() {
        None
    } else {
        Some(article.title)
    };
    Ok((markdown, title))
}

fn looks_like_html(content_type: Option<&str>, body: &str) -> bool {
    if let Some(content_type) = content_type {
        let content_type = content_type.to_lowercase();
        if content_type.contains("text/html") || content_type.contains("application/xhtml") {
            return true;
        }
    }
    let sample: String = body.chars().take(2048).collect();
    let sample = sample.to_lowercase();
    sample.contains("<!doctype html") || sample.contains("<html")
}

/// Recursively collect supported files under `root`, returning `(absolute,
/// relative-posix)` pairs.
fn collect_directory_files(root: &Path) -> BitFunResult<Vec<(PathBuf, String)>> {
    let mut files = Vec::new();
    collect_directory_files_into(root, root, &mut files)?;
    files.sort_by(|a, b| a.1.cmp(&b.1));
    Ok(files)
}

fn collect_directory_files_into(
    root: &Path,
    directory: &Path,
    files: &mut Vec<(PathBuf, String)>,
) -> BitFunResult<()> {
    let entries = std::fs::read_dir(directory).map_err(|error| {
        BitFunError::service(format!(
            "Failed to read directory '{}': {error}",
            directory.display()
        ))
    })?;
    for entry in entries {
        let entry = entry.map_err(|error| {
            BitFunError::service(format!("Failed to read directory entry: {error}"))
        })?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            collect_directory_files_into(root, &path, files)?;
            continue;
        }
        if !path.is_file() {
            continue;
        }
        let supported = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|extension| {
                DIRECTORY_SUPPORTED_EXTENSIONS.contains(&extension.to_lowercase().as_str())
            })
            .unwrap_or(false);
        if !supported {
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        files.push((path, relative));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_splits_words_and_cjk() {
        let tokens = tokenize_query("公司的报销 policy 2024");
        assert!(tokens.contains(&"policy".to_string()));
        assert!(tokens.contains(&"2024".to_string()));
        assert!(tokens.contains(&"公司的报销".to_string()));
    }

    #[test]
    fn build_match_query_requires_indexable_terms() {
        assert!(build_match_query(&["ab".to_string(), "的".to_string()]).is_none());
        assert_eq!(
            build_match_query(&["policy".to_string()]).as_deref(),
            Some("\"policy\"")
        );
    }

    #[test]
    fn split_text_produces_non_empty_chunks_with_offsets() {
        let text = "para one\n\npara two\n\npara three";
        let chunks = split_text(text, 12, 2, "\\n\\n");
        assert!(!chunks.is_empty());
        for chunk in &chunks {
            assert_eq!(&text[chunk.start as usize..chunk.end as usize], chunk.text);
        }
    }

    #[test]
    fn like_pattern_escapes_wildcards() {
        assert_eq!(to_like_pattern("a_b%c"), "%a\\_b\\%c%");
    }
}
