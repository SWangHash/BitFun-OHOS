//! Local model HTTP client for interacting with the local LLM service
//! (compatible with Ollama/OpenAI APIs).
//!
//! Provides methods for:
//! - Detecting local service availability (`detect_service`)
//! - Listing models with full status info (`list_models`)
//! - Pulling/downloading models with streaming progress (`pull_model`)
//! - Pausing model downloads (`pause_download`)

use crate::service::config::types::{
    LocalModel, LocalModelDetails, LocalModelPullProgress, LocalModelStatus, LocalServiceStatus,
};
use log::{debug, info, warn};
use serde::Deserialize;
use std::time::Duration;

const DEFAULT_LOCAL_PORT: u16 = 11434;
const DETECT_TIMEOUT_SECS: u64 = 3;

/// Error type for local model client operations.
#[derive(Debug)]
pub enum LocalModelError {
    /// The local service is not reachable.
    ServiceUnavailable { port: u16, source: String },
    /// The request timed out.
    Timeout { port: u16 },
    /// The service returned a 403 (privacy not agreed).
    PrivacyNotAgreed,
    /// The service returned a 404 (not found).
    NotFound { detail: String },
    /// The service returned a 500 (internal error).
    InternalError { detail: String },
    /// The service returned an unexpected status code.
    UnexpectedStatus { code: u16, detail: String },
    /// Failed to parse the response body.
    ParseError { source: String },
    /// A network or I/O error occurred.
    NetworkError { source: String },
}

impl std::fmt::Display for LocalModelError { 
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { 
        match self { 
            Self::ServiceUnavailable { port, source } => {
                write!(f, "Local model service unavailable on port {}: {}", port, source)
            }
            Self::Timeout { port } => {
                write!(f, "Local model service on port {} did not respond within {}s", port, DETECT_TIMEOUT_SECS)
            }
            Self::PrivacyNotAgreed => {
                write!(f, "Privacy agreement requied before using local model service (HTTP 403)")
            }
            Self::NotFound { detail } => write!(f, "not found: {}", detail),
            Self::InternalError { detail } => write!(f, "Internal server error: {}", detail),
            Self::UnexpectedStatus { code, detail } => {
                write!(f, "Unexpected HTTP status {}: {}", code, detail)
            }
            Self::ParseError { source } => write!(f, "Failed to parse response: {}", source),
            Self::NetworkError { source } => write!(f, "Network error: {}", source),
        }
    }
}

impl std::error::Error for LocalModelError {}

fn classify_http_error(status: reqwest::StatusCode, body: &str) -> LocalModelError {
    let detail = if body.len() > 200 {
        &body[..200]
    } else {
        body
    };
    match status.as_u16() {
        400 => LocalModelError::NotFound {
            detail: detail.to_string(),
        },
        403 => LocalModelError::PrivacyNotAgreed,
        404 => LocalModelError::NotFound {
            detail: detail.to_string(),
        },
        500 => LocalModelError::InternalError {
            detail: detail.to_string(),
        },
        code => LocalModelError::UnexpectedStatus {
            code,
            detail: detail.to_string(),
        },
    }
}

/// Detect local model service availability.
///
/// Sends a GET request to `http://localhost:{port}/v1/models` with a short
/// timeout. Returns the service status including available models if reachable.
pub async fn detect_service(port: u16) -> Result<LocalServiceStatus, LocalModelError> {
    let url = format!("http://localhost:{}/v1/models", port);
    info!("[local-model] Detecting local model service at {}", url);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(DETECT_TIMEOUT_SECS))
        .build()
        .map_err(|e| {
            warn!("[local-model] Failed to build reqwest client: {}", e);
            LocalModelError::NetworkError {
                source: e.to_string(),
            }
        })?;
    
    info!("[local-model] Sending GET request to {}", url);
    let response = client.get(&url).send().await;

    match response {
        Ok(resp) => {
            info!("[local-model] Got response status: {}", resp.status());
            if resp.status().is_success() {
                let body = resp.text().await.map_err(|e| LocalModelError::ParseError {
                    source: e.to_string(),
                })?;

                info!("[local-model] Response body (first 500 chars): {}", &body[..body.len().min(500)]);

                // Parse OpenAI-format models response to extract model IDs.
                let models = parse_openai_models_response(&body).unwrap_or_default();

                info!("[local-model] Parsed {} model(s) from /v1/models", models.len());

                // Try to fetch service name and version from /api/version.
                let (service_name, version) = fetch_service_info(port).await;

                info!(
                    "[local-model] Local model service detected on port {} with {} model(s)", 
                    port,
                    models.len()
                );

                Ok(LocalServiceStatus {
                    available: true,
                    port,
                    service_name,
                    version,
                    models,
                })
            } else {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                let error = classify_http_error(status, &body);
                warn!(
                    "[local-model] Local model service on port {} returned HTTP {}: {}",
                    port,
                    status,
                    &body[..body.len().min(200)]
                );
                Err(error)
            }
        }
        Err(e) => {
            let mut err_chain = String::new();
            let mut source = std::error::Error::source(&e);
            while let Some(s) = source {
                err_chain.push_str(&format!("; cause: {}", s));
                source = std::error::Error::source(s);
            }
            if e.is_timeout() {
                warn!("[local-model] Service on port {} timed out after {}s{}", port, DETECT_TIMEOUT_SECS, err_chain);
                Err(LocalModelError::Timeout { port })
            } else if e.is_connect() {
                warn!("[local-model] Service not reachable on port {}: {}{}", port, e, err_chain);
                Err(LocalModelError::ServiceUnavailable {
                    port,
                    source: e.to_string(),
                })
            } else {
                warn!("[local-model] Network error on port {}: {}{}", port, e, err_chain);
                Err(LocalModelError::NetworkError {
                    source: e.to_string(),
                })
            }
        }
    }
}

/// List all models from the local model service (includes download status).
///
/// Uses the Ollama-compatible `/api/modellist` endpoint which returns
/// richer model info (status, size, download progress) than the OpenAI
/// `/v1/models` endpoint.
pub async fn list_models(port: u16) -> Result<Vec<LocalModel>, LocalModelError> {
    let url = format!("http://localhost:{}/api/modellist", port);
    info!("[local-model] Listing local models from {}", url);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| LocalModelError::NetworkError {
            source: e.to_string(),
        })?;

    let response = client.get(&url).send().await.map_err(|e| {
        if e.is_timeout() {
            LocalModelError::Timeout { port }
        } else if e.is_connect() {
            LocalModelError::ServiceUnavailable {
                port,
                source: e.to_string(),
            }
        } else {
            LocalModelError::NetworkError {
                source: e.to_string(),
            }
        }
    })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        warn!("[local-model] /api/modellist returned HTTP {}: {}", status, &body[..body.len().min(200)]);
        return Err(classify_http_error(status, &body));
    }

    let body = response.text().await.map_err(|e| LocalModelError::ParseError {
        source: e.to_string(),
    })?;

    info!("[local-model] /api/modellist response body (first 500 chars): {}", &body[..body.len().min(500)]);

    let result = parse_modellist_response(&body);
    match &result {
        Ok(models) => info!("[local-model] Parsed {} model(s) from /api/modellist", models.len()),
        Err(e) => warn!("[local-model] Failed to parse /api/modellist response: {}", e)
    }
    result
}

/// Pull (download) a model from the local model service.
///
/// Sends a POST to `/api/pull` with `stream: true`. This is a streaming
/// endpoint; the caller should process the response line-by-line and
/// emit progress events.
///
/// Returns a receiver that yields `LocalModelPullProgress` item as they
/// arrive from the server.
pub async fn pull_model(
    port: u16,
    model_name: &str,
) -> Result<tokio::sync::mpsc::Receiver<LocalModelPullProgress>, LocalModelError> {
    let url = format!("http://localhost:{}/api/pull", port);
    info!("[local-model] Pulling model '{}' from {}", model_name, url);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| LocalModelError::NetworkError {
            source: e.to_string(),
        })?;
    
    let body = serde_json::json!({
        "model": model_name,
        "stream": true
    });

    info!("[local-model] Sending POST to {} with body: {}", url, body);

    let response = client.post(&url).json(&body).send().await.map_err(|e| {
        warn!("[local-model] Pull request failed for model '{}': {}", model_name, e);
        if e.is_connect() {
            LocalModelError::ServiceUnavailable {
                port,
                source: e.to_string(),
            }
        } else {
            LocalModelError::NetworkError {
                source: e.to_string(),
            }
        }
    })?;

    let status = response.status();
    info!("[local-model] Pull response status: {}", status);

    if !status.is_success() { 
        let error_body = response.text().await.unwrap_or_default();
        warn!("[local-model] Pull failed with HTTP {}: {}", status, &error_body[..error_body.len().min(200)]);
        return Err(classify_http_error(status, &error_body));
    }

    let (tx, rx) = tokio::sync::mpsc::channel(32);

    // Spawn a task to read the streaming response and parse progress.
    let model_name_owned = model_name.to_string();
    tokio::spawn(async move {
        use futures::StreamExt;
        let mut buffer = String::new();
        let mut chunk_count: u32 = 0;
        let mut progress_sent_count: u32 = 0;

        let mut stream = Box::pin(response.bytes_stream());

        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(chunk) => {
                    chunk_count += 1;
                    let chunk_str = String::from_utf8_lossy(&chunk);
                    buffer.push_str(&chunk_str);

                    if chunk_count <= 5 {
                        info!("[local-model] Pull chunk #{}: {} bytes, buffer len: {}", chunk_count, chunk.len(), buffer.len());
                    }

                    // Process complete lines from the buffer.
                    while let Some(newline_pos) = buffer.find('\n') {
                        let line = buffer[..newline_pos].trim().to_string();
                        buffer = buffer[newline_pos + 1..].to_string();

                        if line.is_empty() {
                            continue;
                        }

                        if progress_sent_count < 5 {
                            info!("[local-model] Parsing pull line: {}", &line[..line.len().min(200)]);
                        }

                        match parse_pull_progress_line(&line, &model_name_owned) {
                            Ok(progress) => {
                                progress_sent_count += 1;
                                let is_success = progress.status == "success";
                                let is_paused = progress.status == "paused";
                                if progress_sent_count <= 5 || is_success || is_paused { 
                                    info!(
                                        "[local-model] Pull progress #{}: model={}, status={}, total={}, completed={}",
                                        progress_sent_count, progress.model_name, progress.status,
                                        progress.total, progress.completed
                                    );
                                }
                                if tx.send(progress).await.is_err() {
                                    info!("[local-model] Pull progress channel closed, stopping stream processing");
                                    return;
                                }
                                if is_success {
                                    info!("[local-model] Model pull completed: {}", model_name_owned);
                                    return;
                                }
                                if is_paused {
                                    info!("[local-model] Model pull paused: {}", model_name_owned);
                                    return;
                                }
                            }
                            Err(e) => {
                                warn!("[local-model] Failed to parse pull progress line: {}, raw: {}", e, &line[..line.len().min(200)]);
                            }
                        }
                    }
                }
                Err(e) => {
                    warn!("[local-model] Error reading pull stream chunk #{}: {}", chunk_count + 1, e);
                    break;
                }
            }
        }

        info!(
            "[local-model] Pull stream ended for model '{}': {} chunks, {} progress events sent",
            model_name_owned, chunk_count, progress_sent_count
        );
    });

    Ok(rx)
}

/// Pause a model download.
///
/// Sends a POST to `/api/pause-download`.
pub async fn pause_download(port: u16, model_name: &str) -> Result<bool, LocalModelError> {
    let url = format!("http://localhost:{}/api/pause-download", port);
    debug!("[local-model] Pausing download for model '{}' at {}", model_name, url);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| LocalModelError::NetworkError {
            source: e.to_string(),
        })?;

    let body = serde_json::json!({
        "model": model_name
    });

    let response = client.post(&url).json(&body).send().await.map_err(|e| {
        if e.is_connect() {
            LocalModelError::ServiceUnavailable {
                port,
                source: e.to_string(),
            }
        } else {
            LocalModelError::NetworkError {
                source: e.to_string(),
            }
        }
    })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_body = response.text().await.unwrap_or_default();
        return Err(classify_http_error(status, &error_body));
    }

    let resp_body = response.text().await.map_err(|e| LocalModelError::ParseError {
        source: e.to_string(),
    })?;

    // Check for success status in the response.
    let success = resp_body.contains("\"success\"") || resp_body.contains("\"status\":\"success\"");

    Ok(success)
}

// --- Response parsing helpers ---

#[derive(Debug, Deserialize)]
struct OpenAIModelsResponse {
    #[serde(default)]
    data: Vec<OpenAIModelEntry>,
}

#[derive(Debug, Deserialize)]
struct OpenAIModelEntry {
    id: String,
}

fn parse_openai_models_response(body: &str) -> Result<Vec<LocalModel>, LocalModelError> {
    let payload: OpenAIModelsResponse =
        serde_json::from_str(body).map_err(|e| LocalModelError::ParseError {
            source: e.to_string(),
        })?;

    let models = payload
        .data
        .into_iter()
        .map(|entry| LocalModel {
            name: entry.id,
            status: LocalModelStatus::Downloaded,
            ..Default::default()
        })
        .collect();
    
    Ok(models)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct ModelListResponse {
    #[serde(default)]
    models: Vec<ModelListEntry>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ModelListEntry {
    #[serde(default)]
    name: String,
    #[serde(default, rename = "type")]
    model_type: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    modified_at: Option<String>,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    completed: Option<u64>,
    #[serde(default)]
    digest: Option<String>,
    #[serde(default)]
    details: Option<ModelListEntryDetails>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ModelListEntryDetails {
    #[serde(default)]
    format: String,
    #[serde(default)]
    family: String,
    #[serde(default)]
    families: Vec<String>,
    #[serde(default)]
    parameter_size: String,
    #[serde(default)]
    quantization_level: String,
}

fn parse_status_string(status: &str) -> LocalModelStatus {
    match status.to_lowercase().as_str() {
        "downloaded" => LocalModelStatus::Downloaded,
        "undownloaded" => LocalModelStatus::Undownloaded,
        "downloading" => LocalModelStatus::Downloading,
        "paused" => LocalModelStatus::Paused,
        "failed" => LocalModelStatus::Failed,
        _ => LocalModelStatus::Undownloaded,
    }
}

fn parse_modellist_response(body: &str) -> Result<Vec<LocalModel>, LocalModelError> {
    let payload: ModelListResponse =
        serde_json::from_str(body).map_err(|e| LocalModelError::ParseError {
            source: e.to_string(),
        })?;

    let models = payload
        .models
        .into_iter()
        .map(|entry| {
            let details = entry
                .details
                .map(|d| LocalModelDetails {
                    format: d.format,
                    family: d.family,
                    families: d.families,
                    parameter_size: d.parameter_size,
                    quantization_level: d.quantization_level,
                })
                .unwrap_or_default();

            LocalModel {
                name: entry.name,
                model_type: entry.model_type,
                status: parse_status_string(&entry.status),
                modified_at: entry.modified_at,
                size: entry.size,
                completed: entry.completed,
                digest: entry.digest,
                details,
            }
        })
        .collect();

    Ok(models)
}

// Parse a single JSON line from the `/api/pull` streaming response.
fn parse_pull_progress_line(
    line: &str,
    model_name: &str,
) -> Result<LocalModelPullProgress, serde_json::Error> {
    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PullLine {
        #[serde(default)]
        status: String,
        #[serde(default)]
        digest: Option<String>,
        #[serde(default)]
        total: u64,
        #[serde(default)]
        completed: u64,
    }

    let parsed: PullLine = serde_json::from_str(line)?;

    Ok(LocalModelPullProgress {
        model_name: model_name.to_string(),
        status: parsed.status,
        digest: parsed.digest,
        total: parsed.total,
        completed: parsed.completed,
    })
}

/// Returns the default local model service port.
pub fn default_port() -> u16 {
    DEFAULT_LOCAL_PORT
}

/// Attempts to fetch service name and version from `/api/version`.
/// Returns (Some("Ollam"), Some(version)) on success, (None, None) on failure.
async fn fetch_service_info(port: u16) -> (Option<String>, Option<String>) {
    let url = format!("http://localhost:{}/api/version", port);
    debug!("[local-model] Fetching service info from {}", url);

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(_) => return (None, None),
    };

    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => {
            #[derive(Deserialize)]
            struct VersionResponse {
                #[serde(default)]
                version: Option<String>,
            }
            match resp.text().await {
                Ok(body) => {
                    let parsed: VersionResponse = serde_json::from_str(&body).unwrap_or(VersionResponse { version: None });
                    (Some("Ollama".to_string()), parsed.version)
                }
                Err(_) => (Some("Ollama".to_string()), None),
            }
        }
        _ => (None, None),
    }
}
