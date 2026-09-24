//! Rerank request path for knowledge retrieval.
//!
//! Like embeddings, BitFun's `AIClient` has no rerank request, so this issues the
//! provider's rerank endpoint directly from the resolved model config. Cohere and
//! OpenAI-compatible/Jina shapes are supported. Any failure degrades to the
//! un-reranked ranking (the caller logs and falls back), because a rerank model
//! is an optional quality improvement, not a correctness requirement.

use std::time::Duration;

use serde_json::json;

use crate::infrastructure::ai::get_global_ai_client_factory;
use crate::util::errors::{BitFunError, BitFunResult};

const RERANK_REQUEST_TIMEOUT_SECS: u64 = 60;

/// One reranked document: the original index and its relevance score.
#[derive(Debug, Clone)]
pub(crate) struct RerankScore {
    pub original_index: usize,
    pub score: f32,
}

pub(crate) async fn rerank_documents(
    model_id: &str,
    query: &str,
    documents: &[String],
    top_n: usize,
) -> BitFunResult<Vec<RerankScore>> {
    if documents.is_empty() {
        return Ok(Vec::new());
    }

    let factory = get_global_ai_client_factory().await?;
    let client = factory
        .get_client_resolved(model_id)
        .await
        .map_err(|error| {
            BitFunError::service(format!(
                "Failed to resolve rerank model '{model_id}': {error}"
            ))
        })?;
    let config = &client.config;
    let base_url = config.base_url.trim().trim_end_matches('/');
    let format = config.format.trim().to_ascii_lowercase();
    let endpoint = if format == "cohere" {
        "rerank"
    } else {
        "reranks"
    };
    let url = format!("{base_url}/{endpoint}");

    let body = json!({
        "model": config.model,
        "query": query,
        "documents": documents,
        "top_n": top_n,
    });

    let http = reqwest::Client::builder()
        .danger_accept_invalid_certs(config.skip_ssl_verify)
        .timeout(Duration::from_secs(RERANK_REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|error| {
            BitFunError::service(format!("Failed to build rerank http client: {error}"))
        })?;
    let mut request = http.post(url).bearer_auth(&config.api_key).json(&body);
    if let Some(headers) = &config.custom_headers {
        for (name, value) in headers {
            request = request.header(name.as_str(), value.as_str());
        }
    }

    let response = request
        .send()
        .await
        .map_err(|error| BitFunError::service(format!("Rerank request failed: {error}")))?;
    let status = response.status();
    let body_text = response.text().await.map_err(|error| {
        BitFunError::service(format!("Failed to read rerank response: {error}"))
    })?;
    if !status.is_success() {
        return Err(BitFunError::service(format!(
            "Rerank request returned {status}: {}",
            body_text.chars().take(300).collect::<String>()
        )));
    }

    let parsed: serde_json::Value = serde_json::from_str(&body_text).map_err(|error| {
        BitFunError::service(format!("Failed to parse rerank response: {error}"))
    })?;
    let results = parsed
        .get("results")
        .and_then(|value| value.as_array())
        .ok_or_else(|| BitFunError::service("Rerank response is missing a results array"))?;

    let mut scores = Vec::with_capacity(results.len());
    for result in results {
        let index = result
            .get("index")
            .and_then(|value| value.as_u64())
            .ok_or_else(|| BitFunError::service("Rerank result is missing an index"))?
            as usize;
        let score = result
            .get("relevance_score")
            .or_else(|| result.get("score"))
            .and_then(|value| value.as_f64())
            .ok_or_else(|| BitFunError::service("Rerank result is missing a score"))?;
        scores.push(RerankScore {
            original_index: index,
            score: score as f32,
        });
    }
    scores.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(scores)
}
