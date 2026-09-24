//! Knowledge base Tauri commands.
//!
//! Thin adapters over `bitfun_core::service::knowledge::KnowledgeService`. The
//! service owns persistence and retrieval; these commands only translate the
//! structured `request` payloads and surface errors as strings.

use bitfun_core::service::knowledge::{
    get_global_knowledge_service, CreateKnowledgeBaseRequest, KnowledgeAddItemInput, KnowledgeBase,
    KnowledgeItem, KnowledgeItemChunk, KnowledgeSearchResult, KnowledgeService,
};
use log::debug;
use serde::Deserialize;
use std::sync::Arc;

fn knowledge_service() -> Result<Arc<KnowledgeService>, String> {
    get_global_knowledge_service().ok_or_else(|| "Knowledge service is not initialized".to_string())
}

fn map_error(action: &str, error: impl std::fmt::Display) -> String {
    format!("{action} failed: {error}")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateKnowledgeBaseCommandRequest {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseIdRequest {
    pub base_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddItemsRequest {
    pub base_id: String,
    pub items: Vec<KnowledgeAddItemInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemIdsRequest {
    pub base_id: String,
    pub item_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub base_id: String,
    pub query: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemIdRequest {
    pub item_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListItemChunksRequest {
    pub base_id: String,
    pub item_id: String,
}

#[tauri::command]
pub async fn knowledge_create_base(
    request: CreateKnowledgeBaseCommandRequest,
) -> Result<KnowledgeBase, String> {
    debug!("Creating knowledge base: name={}", request.name);
    let service = knowledge_service()?;
    service
        .create_base(CreateKnowledgeBaseRequest {
            name: request.name,
            embedding_model_id: request.embedding_model_id,
            dimensions: request.dimensions,
            rerank_model_id: request.rerank_model_id,
            chunk_size: request.chunk_size,
            chunk_overlap: request.chunk_overlap,
            chunk_strategy: request.chunk_strategy,
            chunk_separator: request.chunk_separator,
            threshold: request.threshold,
            document_count: request.document_count,
        })
        .map_err(|error| map_error("Create knowledge base", error))
}

#[tauri::command]
pub async fn knowledge_list_bases() -> Result<Vec<KnowledgeBase>, String> {
    let service = knowledge_service()?;
    service
        .list_bases()
        .map_err(|error| map_error("List knowledge bases", error))
}

#[tauri::command]
pub async fn knowledge_get_base(request: BaseIdRequest) -> Result<KnowledgeBase, String> {
    let service = knowledge_service()?;
    service
        .get_base(&request.base_id)
        .map_err(|error| map_error("Get knowledge base", error))
}

#[tauri::command]
pub async fn knowledge_delete_base(request: BaseIdRequest) -> Result<bool, String> {
    debug!("Deleting knowledge base: base_id={}", request.base_id);
    let service = knowledge_service()?;
    service
        .delete_base(&request.base_id)
        .map(|_| true)
        .map_err(|error| map_error("Delete knowledge base", error))
}

#[tauri::command]
pub async fn knowledge_add_items(request: AddItemsRequest) -> Result<Vec<KnowledgeItem>, String> {
    debug!(
        "Adding knowledge items: base_id={}, count={}",
        request.base_id,
        request.items.len()
    );
    let service = knowledge_service()?;
    service
        .add_items(&request.base_id, request.items)
        .map_err(|error| map_error("Add knowledge items", error))
}

#[tauri::command]
pub async fn knowledge_list_items(request: BaseIdRequest) -> Result<Vec<KnowledgeItem>, String> {
    let service = knowledge_service()?;
    service
        .list_items(&request.base_id)
        .map_err(|error| map_error("List knowledge items", error))
}

#[tauri::command]
pub async fn knowledge_delete_items(request: ItemIdsRequest) -> Result<bool, String> {
    let service = knowledge_service()?;
    service
        .delete_items(&request.base_id, request.item_ids)
        .map(|_| true)
        .map_err(|error| map_error("Delete knowledge items", error))
}

#[tauri::command]
pub async fn knowledge_reindex_items(request: ItemIdsRequest) -> Result<bool, String> {
    let service = knowledge_service()?;
    service
        .reindex_items(&request.base_id, request.item_ids)
        .map(|_| true)
        .map_err(|error| map_error("Reindex knowledge items", error))
}

#[tauri::command]
pub async fn knowledge_search(
    request: SearchRequest,
) -> Result<Vec<KnowledgeSearchResult>, String> {
    let service = knowledge_service()?;
    service
        .search(&request.base_id, &request.query)
        .await
        .map_err(|error| map_error("Search knowledge base", error))
}

#[tauri::command]
pub async fn knowledge_list_item_chunks(
    request: ListItemChunksRequest,
) -> Result<Vec<KnowledgeItemChunk>, String> {
    let service = knowledge_service()?;
    service
        .list_item_chunks(&request.base_id, &request.item_id)
        .map_err(|error| map_error("List knowledge item chunks", error))
}

#[tauri::command]
pub async fn knowledge_get_file_path(request: ItemIdRequest) -> Result<String, String> {
    let service = knowledge_service()?;
    service
        .get_file_path(&request.item_id)
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| map_error("Get knowledge file path", error))
}
