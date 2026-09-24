//! Embedding request path for knowledge indexing and query embedding.
//!
//! BitFun's `AIClient` only exposes chat/stream requests, so this module issues
//! the provider's embedding request directly from the resolved model config:
//! OpenAI-compatible `/embeddings` and Gemini `batchEmbedContents`. Providers
//! without an embedding endpoint (e.g. Anthropic) return an explicit error.

use std::time::Duration;

use serde_json::json;

use crate::infrastructure::ai::get_global_ai_client_factory;
use crate::util::errors::{BitFunError, BitFunResult};

const EMBEDDING_REQUEST_TIMEOUT_SECS: u64 = 120;

/// Embed an ordered batch of texts with the resolved embedding model.
pub(crate) async fn embed_texts(
    model_id: &str,
    values: &[String],
    dimensions: i64,
) -> BitFunResult<Vec<Vec<f32>>> {
    if values.is_empty() {
        return Ok(Vec::new());
    }

    let factory = get_global_ai_client_factory().await?;
    let client = factory
        .get_client_resolved(model_id)
        .await
        .map_err(|error| {
            BitFunError::service(format!(
                "Failed to resolve embedding model '{model_id}': {error}"
            ))
        })?;
    let config = &client.config;

    let http = reqwest::Client::builder()
        .danger_accept_invalid_certs(config.skip_ssl_verify)
        .timeout(Duration::from_secs(EMBEDDING_REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|error| {
            BitFunError::service(format!("Failed to build embedding http client: {error}"))
        })?;

    let format = config.format.trim().to_ascii_lowercase();
    let base_url = config.base_url.trim().trim_end_matches('/');
    let mut request = match format.as_str() {
        "openai" | "openai-compatible" | "response" | "responses" | "" => {
            let url = format!("{base_url}/embeddings");
            let body = json!({ "model": config.model, "input": values });
            http.post(url).bearer_auth(&config.api_key).json(&body)
        }
        "gemini" | "google" => {
            let url = format!(
                "{base_url}/v1beta/models/{}:batchEmbedContents",
                config.model
            );
            let requests: Vec<serde_json::Value> = values
                .iter()
                .map(|value| {
                    json!({
                        "model": format!("models/{}", config.model),
                        "content": { "parts": [{ "text": value }] }
                    })
                })
                .collect();
            http.post(url)
                .header("x-goog-api-key", &config.api_key)
                .json(&json!({ "requests": requests }))
        }
        other => {
            return Err(BitFunError::NotImplemented(format!(
                "Embedding requests are not supported for provider format '{other}'"
            )))
        }
    };

    if let Some(headers) = &config.custom_headers {
        for (name, value) in headers {
            request = request.header(name.as_str(), value.as_str());
        }
    }

    let response = request
        .send()
        .await
        .map_err(|error| BitFunError::service(format!("Embedding request failed: {error}")))?;
    let status = response.status();
    let body_text = response.text().await.map_err(|error| {
        BitFunError::service(format!("Failed to read embedding response: {error}"))
    })?;
    if !status.is_success() {
        return Err(BitFunError::service(format!(
            "Embedding request returned {status}: {}",
            truncate(&body_text, 500)
        )));
    }

    let parsed: serde_json::Value = serde_json::from_str(&body_text).map_err(|error| {
        BitFunError::service(format!("Failed to parse embedding response: {error}"))
    })?;
    let vectors = parse_embedding_response(&format, &parsed)?;
    validate_vectors(model_id, values.len(), dimensions, vectors)
}

fn parse_embedding_response(
    format: &str,
    value: &serde_json::Value,
) -> BitFunResult<Vec<Vec<f32>>> {
    let raw = if format == "gemini" || format == "google" {
        value
            .get("embeddings")
            .and_then(|embeddings| embeddings.as_array())
            .map(|embeddings| {
                embeddings
                    .iter()
                    .map(|item| {
                        item.get("values")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null)
                    })
                    .collect::<Vec<_>>()
            })
    } else {
        value
            .get("data")
            .and_then(|data| data.as_array())
            .map(|data| {
                data.iter()
                    .map(|item| {
                        item.get("embedding")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null)
                    })
                    .collect::<Vec<_>>()
            })
    }
    .ok_or_else(|| BitFunError::service("Embedding response is missing a data/embeddings array"))?;

    let mut vectors = Vec::with_capacity(raw.len());
    for entry in raw {
        let array = entry.as_array().ok_or_else(|| {
            BitFunError::service("Embedding response contains a non-array vector")
        })?;
        let mut vector = Vec::with_capacity(array.len());
        for component in array {
            let number = component.as_f64().ok_or_else(|| {
                BitFunError::service("Embedding vector contains a non-numeric value")
            })?;
            vector.push(number as f32);
        }
        vectors.push(vector);
    }
    Ok(vectors)
}

fn validate_vectors(
    model_id: &str,
    expected_count: usize,
    dimensions: i64,
    vectors: Vec<Vec<f32>>,
) -> BitFunResult<Vec<Vec<f32>>> {
    if vectors.len() != expected_count {
        return Err(BitFunError::service(format!(
            "Embedding model '{model_id}' returned {} vectors for {expected_count} inputs",
            vectors.len()
        )));
    }
    for (index, vector) in vectors.iter().enumerate() {
        if vector.is_empty() {
            return Err(BitFunError::service(format!(
                "Embedding model '{model_id}' returned an empty vector at index {index}"
            )));
        }
        if dimensions > 0 && vector.len() as i64 != dimensions {
            return Err(BitFunError::service(format!(
                "Embedding model '{model_id}' returned width {} but the base expects {dimensions} at index {index}",
                vector.len()
            )));
        }
    }
    Ok(vectors)
}

fn truncate(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        value.to_string()
    } else {
        value.chars().take(max).collect()
    }
}
