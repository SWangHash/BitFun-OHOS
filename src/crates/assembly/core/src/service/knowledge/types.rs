//! Knowledge base data contracts.
//!
//! Mirrors the Cherry Studio knowledge domain (bases, items, retrieval results)
//! with BitFun-idiomatic wire names (`camelCase` fields, lowercase enum tags).
//! The main SQLite database is the business authority for base configuration and
//! item identity/status; the per-base retrieval rows are a rebuildable projection.

use serde::{Deserialize, Serialize};

pub const DEFAULT_KNOWLEDGE_CHUNK_SIZE: i64 = 1024;
pub const DEFAULT_KNOWLEDGE_CHUNK_OVERLAP: i64 = 200;
pub const DEFAULT_KNOWLEDGE_CHUNK_STRATEGY: &str = "structured";
pub const DEFAULT_KNOWLEDGE_CHUNK_SEPARATOR: &str = "\\n\\n";
pub const DEFAULT_KNOWLEDGE_DOCUMENT_COUNT: i64 = 10;

/// Persisted knowledge item types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KnowledgeItemType {
    File,
    Url,
    Note,
    Directory,
}

impl KnowledgeItemType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Url => "url",
            Self::Note => "note",
            Self::Directory => "directory",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "file" => Some(Self::File),
            "url" => Some(Self::Url),
            "note" => Some(Self::Note),
            "directory" => Some(Self::Directory),
            _ => None,
        }
    }
}

/// Persisted item lifecycle states.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KnowledgeItemStatus {
    Idle,
    Preparing,
    Processing,
    Reading,
    Embedding,
    Completed,
    Failed,
    Deleting,
}

impl KnowledgeItemStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Preparing => "preparing",
            Self::Processing => "processing",
            Self::Reading => "reading",
            Self::Embedding => "embedding",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Deleting => "deleting",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "idle" => Some(Self::Idle),
            "preparing" => Some(Self::Preparing),
            "processing" => Some(Self::Processing),
            "reading" => Some(Self::Reading),
            "embedding" => Some(Self::Embedding),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            "deleting" => Some(Self::Deleting),
            _ => None,
        }
    }
}

/// Base readiness state. A `Failed` base stays visible/recoverable but is not
/// usable for add/search until repaired.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KnowledgeBaseStatus {
    Completed,
    Failed,
}

impl KnowledgeBaseStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }
}

/// A knowledge base row.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeBase {
    pub id: String,
    pub name: String,
    pub embedding_model_id: Option<String>,
    pub dimensions: Option<i64>,
    pub rerank_model_id: Option<String>,
    pub status: KnowledgeBaseStatus,
    pub error: Option<String>,
    pub chunk_size: i64,
    pub chunk_overlap: i64,
    pub chunk_strategy: String,
    pub chunk_separator: String,
    pub threshold: Option<f64>,
    pub document_count: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

/// A knowledge item row. `data` is the type-specific JSON payload (source path,
/// URL, note content, ...), mirroring Cherry Studio's `knowledge_item.data`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeItem {
    pub id: String,
    pub base_id: String,
    pub group_id: Option<String>,
    #[serde(rename = "type")]
    pub item_type: KnowledgeItemType,
    pub data: serde_json::Value,
    pub status: KnowledgeItemStatus,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Add-item inputs (discriminated by `type`)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileItemInput {
    pub source: String,
    /// Absolute source path selected by the user before Knowledge copies it.
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlItemInput {
    pub source: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteItemInput {
    pub source: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryItemInput {
    pub source: String,
}

/// Runtime add payload. Internal callers (migrator/restore) can reuse the same
/// shape; the persisted `relativePath` is written by the service, never by the
/// caller.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum KnowledgeAddItemInput {
    File {
        #[serde(default, rename = "groupId")]
        group_id: Option<String>,
        data: FileItemInput,
    },
    Url {
        #[serde(default, rename = "groupId")]
        group_id: Option<String>,
        data: UrlItemInput,
    },
    Note {
        #[serde(default, rename = "groupId")]
        group_id: Option<String>,
        data: NoteItemInput,
    },
    Directory {
        #[serde(default, rename = "groupId")]
        group_id: Option<String>,
        data: DirectoryItemInput,
    },
}

impl KnowledgeAddItemInput {
    pub fn group_id(&self) -> Option<&str> {
        match self {
            Self::File { group_id, .. }
            | Self::Url { group_id, .. }
            | Self::Note { group_id, .. }
            | Self::Directory { group_id, .. } => group_id.as_deref(),
        }
    }

    pub fn item_type(&self) -> KnowledgeItemType {
        match self {
            Self::File { .. } => KnowledgeItemType::File,
            Self::Url { .. } => KnowledgeItemType::Url,
            Self::Note { .. } => KnowledgeItemType::Note,
            Self::Directory { .. } => KnowledgeItemType::Directory,
        }
    }
}

// ============================================================================
// Retrieval
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeChunkMetadata {
    pub item_id: String,
    pub item_type: KnowledgeItemType,
    pub source: String,
    pub chunk_index: i64,
    pub token_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSearchResult {
    pub page_content: String,
    pub score: f64,
    pub score_kind: String,
    pub rank: i64,
    pub metadata: KnowledgeChunkMetadata,
    pub item_id: String,
    pub chunk_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeItemChunk {
    pub id: String,
    pub item_id: String,
    pub content: String,
    pub metadata: KnowledgeChunkMetadata,
}
