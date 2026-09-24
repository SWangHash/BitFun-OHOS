//! Knowledge base service.
//!
//! SQLite-backed knowledge bases and items plus a derived retrieval index
//! (trigram FTS5 BM25, with optional brute-force cosine vectors as a follow-up).
//! The Cherry Studio knowledge domain is the reference for behavior; this module
//! is the BitFun-native port.

mod embedding;
mod rerank;
mod service;
mod store;
mod types;
mod vector;

pub use service::{
    get_global_knowledge_service, set_global_knowledge_service, CreateKnowledgeBaseRequest,
    KnowledgeService,
};
pub use types::{
    DirectoryItemInput, FileItemInput, KnowledgeAddItemInput, KnowledgeBase, KnowledgeBaseStatus,
    KnowledgeChunkMetadata, KnowledgeItem, KnowledgeItemChunk, KnowledgeItemStatus,
    KnowledgeItemType, KnowledgeSearchResult, NoteItemInput, UrlItemInput,
    DEFAULT_KNOWLEDGE_CHUNK_OVERLAP, DEFAULT_KNOWLEDGE_CHUNK_SEPARATOR,
    DEFAULT_KNOWLEDGE_CHUNK_SIZE, DEFAULT_KNOWLEDGE_CHUNK_STRATEGY,
    DEFAULT_KNOWLEDGE_DOCUMENT_COUNT,
};
