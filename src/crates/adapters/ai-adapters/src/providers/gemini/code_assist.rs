//! Google Cloud Code Assist transport (`cloudcode-pa.googleapis.com`).
//!
//! Used by `gemini-cli` after a personal Google login. The endpoint accepts the
//! regular Gemini request body but wrapped in
//! `{ "model": "...", "project": "...", "request": { ... } }` and authenticated
//! with a Bearer access_token (we don't pass `x-goog-api-key`).

use super::{request as gemini_request, GeminiMessageConverter};
use crate::client::sse::execute_sse_request;
use crate::client::{AIClient, StreamResponse};
use crate::providers::shared;
use crate::stream::handle_gemini_stream_with_empty_tools;
use crate::trace::ModelExchangeTraceConfig;
use crate::types::{Message, RemoteModelInfo, ToolDefinition};
use anyhow::{anyhow, Context, Result};
use log::{debug, warn};
use reqwest::RequestBuilder;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tokio::sync::Mutex;

const CODE_ASSIST_BASE: &str = "https://cloudcode-pa.googleapis.com";
const STREAM_ENDPOINT: &str = "/v1internal:streamGenerateContent?alt=sse";
const LOAD_CODE_ASSIST_ENDPOINT: &str = "/v1internal:loadCodeAssist";
const ONBOARD_USER_ENDPOINT: &str = "/v1internal:onboardUser";
const AVAILABLE_MODELS_ENDPOINT: &str = "/v1internal:fetchAvailableModels";

struct CachedProject {
    credential: [u8; 32],
    antigravity: bool,
    project: String,
}

fn cached_project() -> &'static Mutex<Option<CachedProject>> {
    static CACHE: OnceLock<Mutex<Option<CachedProject>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn is_antigravity(client: &AIClient) -> bool {
    client
        .config
        .custom_headers
        .as_ref()
        .is_some_and(|headers| {
            headers.iter().any(|(name, value)| {
                name.eq_ignore_ascii_case("Client-Metadata") && value.contains("ANTIGRAVITY")
            })
        })
}

async fn project_for(client: &AIClient) -> Option<String> {
    let credential: [u8; 32] = Sha256::digest(client.config.api_key.as_bytes()).into();
    cached_project()
        .lock()
        .await
        .as_ref()
        .filter(|entry| {
            entry.credential == credential && entry.antigravity == is_antigravity(client)
        })
        .map(|entry| entry.project.clone())
}

async fn remember_project(client: &AIClient, project: String) -> String {
    *cached_project().lock().await = Some(CachedProject {
        credential: Sha256::digest(client.config.api_key.as_bytes()).into(),
        antigravity: is_antigravity(client),
        project: project.clone(),
    });
    project
}

fn client_metadata(client: &AIClient) -> serde_json::Value {
    serde_json::json!({
        "ideType": if is_antigravity(client) { "ANTIGRAVITY" } else { "IDE_UNSPECIFIED" },
        "platform": "PLATFORM_UNSPECIFIED",
        "pluginType": "GEMINI",
    })
}

pub(crate) fn apply_headers(client: &AIClient, builder: RequestBuilder) -> RequestBuilder {
    let has_custom_user_agent = client
        .config
        .custom_headers
        .as_ref()
        .is_some_and(|headers| {
            headers
                .keys()
                .any(|key| key.eq_ignore_ascii_case("user-agent"))
        });
    shared::apply_header_policy(client, builder, |builder| {
        let builder = builder
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", client.config.api_key));
        if has_custom_user_agent {
            builder
        } else {
            builder.header("User-Agent", "BitFun-CodeAssist/1.0")
        }
    })
}

#[derive(Debug, Deserialize)]
struct LoadCodeAssistResponse {
    #[serde(default, rename = "cloudaicompanionProject")]
    cloudaicompanion_project: Option<serde_json::Value>,
    #[serde(default, rename = "allowedTiers")]
    allowed_tiers: Option<Vec<CodeAssistTier>>,
}

#[derive(Debug, Deserialize)]
struct CodeAssistTier {
    id: Option<String>,
    #[serde(default, rename = "isDefault")]
    is_default: bool,
}

fn extract_project(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(|value| {
            value
                .as_str()
                .or_else(|| value.get("id").and_then(serde_json::Value::as_str))
        })
        .filter(|project| !project.trim().is_empty())
        .map(str::to_string)
}

#[derive(Debug, Deserialize)]
struct OnboardOperation {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    error: Option<serde_json::Value>,
    #[serde(default)]
    done: Option<bool>,
    #[serde(default)]
    response: Option<OnboardResponse>,
}

#[derive(Debug, Deserialize)]
struct OnboardResponse {
    #[serde(default, rename = "cloudaicompanionProject")]
    cloudaicompanion_project: Option<OnboardProject>,
}

#[derive(Debug, Deserialize)]
struct OnboardProject {
    #[serde(default)]
    id: Option<String>,
}

async fn discover_project(client: &AIClient) -> Result<String> {
    if let Some(project) = project_for(client).await {
        return Ok(project);
    }
    if let Ok(project) = std::env::var("GOOGLE_CLOUD_PROJECT") {
        if !project.is_empty() {
            return Ok(remember_project(client, project).await);
        }
    }
    let project = load_project(client, CODE_ASSIST_BASE).await?;
    Ok(remember_project(client, project).await)
}

async fn load_project(client: &AIClient, base_url: &str) -> Result<String> {
    let metadata = client_metadata(client);
    let load_body = serde_json::json!({ "metadata": metadata });
    let load_resp = post_code_assist(
        client,
        base_url,
        LOAD_CODE_ASSIST_ENDPOINT,
        &load_body,
        None,
    )
    .await?;
    let load_status = load_resp.status();
    if !load_status.is_success() {
        let body = load_resp.text().await.unwrap_or_default();
        return Err(anyhow!("loadCodeAssist failed: HTTP {load_status}: {body}"));
    }
    let load_parsed: LoadCodeAssistResponse = load_resp.json().await?;
    if let Some(project) = extract_project(load_parsed.cloudaicompanion_project.as_ref()) {
        return Ok(project);
    }

    // Use the account's default tier when provisioning its managed project.
    let tier = load_parsed
        .allowed_tiers
        .as_deref()
        .unwrap_or_default()
        .iter()
        .find(|tier| tier.is_default)
        .and_then(|tier| tier.id.as_deref())
        .filter(|id| !id.trim().is_empty())
        .unwrap_or("free-tier");
    let onboard_body = serde_json::json!({
        "tierId": tier,
        "metadata": metadata,
    });
    let onboard_resp =
        post_code_assist(client, base_url, ONBOARD_USER_ENDPOINT, &onboard_body, None).await?;
    let onboard_status = onboard_resp.status();
    if !onboard_status.is_success() {
        let body = onboard_resp.text().await.unwrap_or_default();
        return Err(anyhow!("onboardUser failed: HTTP {onboard_status}: {body}"));
    }
    let operation_url = onboard_resp.url().clone();
    let parsed: OnboardOperation = onboard_resp.json().await?;
    let completion = complete_onboarding(client, operation_url, parsed);
    let parsed = if let Some(timeout) = client.stream_options.ttft_timeout {
        tokio::time::timeout(timeout, completion)
            .await
            .context("Timed out waiting for the Code Assist project to finish onboarding")??
    } else {
        completion.await?
    };
    let project = parsed
        .response
        .and_then(|r| r.cloudaicompanion_project)
        .and_then(|p| p.id)
        .filter(|project| !project.trim().is_empty())
        .ok_or_else(|| anyhow!("onboardUser response missing project id"))?;
    Ok(project)
}

async fn complete_onboarding(
    client: &AIClient,
    mut operation_url: reqwest::Url,
    mut operation: OnboardOperation,
) -> Result<OnboardOperation> {
    if let Some(error) = operation.error.as_ref().filter(|error| !error.is_null()) {
        return Err(anyhow!("onboardUser operation failed: {error}"));
    }
    if operation.done.unwrap_or(false) {
        return Ok(operation);
    }
    let name = operation
        .name
        .as_deref()
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| anyhow!("Pending onboardUser operation has no operation name"))?;
    operation_url.set_query(None);
    operation_url
        .path_segments_mut()
        .map_err(|_| anyhow!("Invalid Code Assist operation URL"))?
        .clear()
        .push("v1internal")
        .extend(name.split('/'));
    while !operation.done.unwrap_or(false) {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        let response = apply_headers(client, client.client.get(operation_url.clone()))
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "Code Assist operation failed: HTTP {status}: {body}"
            ));
        }
        operation = response.json().await?;
        if let Some(error) = operation.error.as_ref().filter(|error| !error.is_null()) {
            return Err(anyhow!("onboardUser operation failed: {error}"));
        }
    }
    Ok(operation)
}

pub(crate) async fn send_stream(
    client: &AIClient,
    messages: Vec<Message>,
    tools: Option<Vec<ToolDefinition>>,
    extra_body: Option<serde_json::Value>,
    max_tries: usize,
    trace: Option<ModelExchangeTraceConfig>,
) -> Result<StreamResponse> {
    let (mut request_body, empty_tools) = build_request_body(client, messages, tools, extra_body)?;
    let project = discover_project(client).await?;
    request_body["project"] = serde_json::json!(project);
    let url = if client.config.request_url.is_empty() {
        format!("{}{}", CODE_ASSIST_BASE, STREAM_ENDPOINT)
    } else {
        client.config.request_url.clone()
    };
    debug!(
        "Gemini Code Assist config: model={}, request_url={}, project={}, max_tries={}",
        client.config.model, url, project, max_tries
    );
    let urls = endpoint_urls(&url, is_antigravity(client));
    stream_from_urls(client, &request_body, &urls, max_tries, trace, empty_tools).await
}

fn build_request_body(
    client: &AIClient,
    messages: Vec<Message>,
    tools: Option<Vec<ToolDefinition>>,
    extra_body: Option<serde_json::Value>,
) -> Result<(serde_json::Value, Vec<String>)> {
    let antigravity = is_antigravity(client);
    let (system_instruction, contents) =
        GeminiMessageConverter::convert_messages(messages, &client.config.model);
    let gemini_tools = if antigravity {
        GeminiMessageConverter::convert_code_assist_tools(tools)
    } else {
        GeminiMessageConverter::convert_tools(tools)
    };
    let mut inner = gemini_request::try_build_code_assist_request_body(
        client,
        system_instruction,
        contents,
        gemini_tools,
        extra_body,
        antigravity,
    )?;
    let model = if antigravity {
        resolve_antigravity_model(&client.config.model, &inner)
    } else {
        client.config.model.clone()
    };
    let empty_tools = if antigravity {
        super::antigravity::prepare_request(&model, &mut inner)?
    } else {
        Vec::new()
    };
    let mut request_body = serde_json::json!({
        "model": model,
        "request": inner,
    });
    if antigravity {
        if let Some(obj) = request_body.as_object_mut() {
            obj.insert(
                "userAgent".to_string(),
                serde_json::Value::String("antigravity".to_string()),
            );
        }
    }

    Ok((request_body, empty_tools))
}

fn endpoint_urls(primary: &str, antigravity: bool) -> Vec<String> {
    let mut urls = vec![primary.to_string()];
    if !antigravity {
        return urls;
    }
    let Ok(mut parsed) = reqwest::Url::parse(primary) else {
        return urls;
    };
    const HOSTS: &[&str] = &[
        "cloudcode-pa.googleapis.com",
        "daily-cloudcode-pa.sandbox.googleapis.com",
        "autopush-cloudcode-pa.sandbox.googleapis.com",
    ];
    if parsed.scheme() != "https"
        || parsed.port_or_known_default() != Some(443)
        || !parsed.path().starts_with("/v1internal:")
        || !parsed.host_str().is_some_and(|host| HOSTS.contains(&host))
    {
        return urls;
    }
    let primary_host = parsed.host_str().unwrap_or_default().to_string();
    for host in HOSTS {
        if *host != primary_host && parsed.set_host(Some(host)).is_ok() {
            urls.push(parsed.to_string());
        }
    }
    urls
}

fn compatible_endpoint_error(error: &anyhow::Error) -> bool {
    if let Some(error) = error.downcast_ref::<bitfun_core_types::errors::AiProviderError>() {
        return error.http_status.is_some_and(compatible_endpoint_status);
    }
    error
        .downcast_ref::<reqwest::Error>()
        .is_some_and(|error| error.is_connect() || error.is_timeout())
}

fn compatible_endpoint_status(status: u16) -> bool {
    matches!(status, 403 | 404 | 500..=599)
}

async fn stream_from_urls(
    client: &AIClient,
    body: &serde_json::Value,
    urls: &[String],
    max_tries: usize,
    trace: Option<ModelExchangeTraceConfig>,
    empty_tools: Vec<String>,
) -> Result<StreamResponse> {
    let mut last_error = None;
    for (index, url) in urls.iter().enumerate() {
        let idle_timeout = client.stream_options.idle_timeout;
        let result = execute_sse_request(
            "Gemini Code Assist Streaming API",
            url,
            body,
            max_tries,
            client.stream_options.ttft_timeout,
            trace.clone(),
            || apply_headers(client, client.client.post(url)),
            |response, tx, tx_raw, remaining_ttft_timeout| {
                handle_gemini_stream_with_empty_tools(
                    response,
                    tx,
                    tx_raw,
                    remaining_ttft_timeout,
                    idle_timeout,
                    empty_tools.clone(),
                )
            },
        )
        .await;
        match result {
            Ok(stream) => return Ok(stream),
            Err(error) if index + 1 < urls.len() && compatible_endpoint_error(&error) => {
                warn!("Code Assist endpoint failed; trying the next compatible endpoint");
                last_error = Some(error);
            }
            Err(error) => return Err(error),
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("No Code Assist endpoint is configured")))
}

async fn post_code_assist(
    client: &AIClient,
    base_url: &str,
    endpoint: &str,
    body: &serde_json::Value,
    timeout: Option<std::time::Duration>,
) -> Result<reqwest::Response> {
    let urls = endpoint_urls(&format!("{base_url}{endpoint}"), is_antigravity(client));
    for (index, url) in urls.iter().enumerate() {
        let mut request = apply_headers(client, client.client.post(url)).json(body);
        if let Some(timeout) = timeout {
            request = request.timeout(timeout);
        }
        match request.send().await {
            Ok(response)
                if index + 1 < urls.len()
                    && compatible_endpoint_status(response.status().as_u16()) =>
            {
                continue
            }
            Ok(response) => return Ok(response),
            Err(error) if index + 1 < urls.len() && (error.is_connect() || error.is_timeout()) => {
                continue
            }
            Err(error) => return Err(error.into()),
        }
    }
    Err(anyhow!("No Code Assist endpoint is configured"))
}

/// Only legacy preview aliases need translation; account catalog IDs are wire IDs.
fn resolve_antigravity_model(configured: &str, request: &serde_json::Value) -> String {
    let pro = match configured {
        "gemini-3-pro-preview" | "gemini-3-pro-preview-customtools" => Some("gemini-3-pro"),
        "gemini-3.1-pro-preview" | "gemini-3.1-pro-preview-customtools" => Some("gemini-3.1-pro"),
        "gemini-3-flash-preview" => return "gemini-3-flash".to_string(),
        _ => None,
    };
    if let Some(base) = pro {
        let high = request
            .get("generationConfig")
            .and_then(|config| config.get("thinkingConfig"))
            .and_then(|config| config.get("thinkingLevel"))
            .and_then(serde_json::Value::as_str)
            .is_some_and(|level| level.eq_ignore_ascii_case("high"));
        return format!("{base}-{}", if high { "high" } else { "low" });
    }
    configured.to_string()
}

#[derive(Deserialize)]
struct AvailableModelsResponse {
    models: std::collections::BTreeMap<String, AvailableModel>,
}

#[derive(Deserialize)]
struct AvailableModel {
    #[serde(default, rename = "displayName")]
    display_name: Option<String>,
}

async fn list_antigravity_models(
    client: &AIClient,
    base_url: &str,
) -> Result<Vec<RemoteModelInfo>> {
    // Opening a model picker must not provision a project or reuse another account's project.
    let mut body = serde_json::json!({});
    if let Some(project) = project_for(client).await {
        body["project"] = serde_json::json!(project);
    }
    let response = post_code_assist(
        client,
        base_url,
        AVAILABLE_MODELS_ENDPOINT,
        &body,
        Some(std::time::Duration::from_secs(
            AIClient::STREAM_CONNECT_TIMEOUT_SECS,
        )),
    )
    .await
    .context("fetch Antigravity account models")?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "Antigravity model discovery failed: HTTP {status}: {body}"
        ));
    }
    let payload = response
        .json::<AvailableModelsResponse>()
        .await
        .context("parse Antigravity account model catalog")?;
    let models = crate::client::utils::dedupe_remote_models(
        payload
            .models
            .into_iter()
            .map(|(id, model)| RemoteModelInfo {
                id,
                display_name: model.display_name,
            })
            .collect(),
    );
    if models.is_empty() {
        return Err(anyhow!(
            "Antigravity returned no available models for this account"
        ));
    }
    Ok(models)
}

const DEFAULT_CODE_ASSIST_MODELS: &[(&str, &str)] = &[
    ("gemini-3.1-pro-preview", "Gemini 3.1 Pro"),
    ("gemini-3-pro-preview", "Gemini 3 Pro"),
    ("gemini-3-flash-preview", "Gemini 3 Flash"),
    ("gemini-3.1-flash-lite-preview", "Gemini 3.1 Flash Lite"),
    ("gemini-2.5-pro", "Gemini 2.5 Pro"),
    ("gemini-2.5-flash", "Gemini 2.5 Flash"),
    ("gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite"),
];

fn gemini_home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".gemini"))
}

fn read_gemini_settings_model(gemini_home: &Path) -> Option<String> {
    let settings_path = gemini_home.join("settings.json");
    let bytes = match std::fs::read(&settings_path) {
        Ok(b) => b,
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                warn!(
                    "Failed to read Gemini settings from {}: {}",
                    settings_path.display(),
                    e
                );
            }
            return None;
        }
    };
    let value: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            warn!(
                "Failed to parse Gemini settings JSON from {}: {}",
                settings_path.display(),
                e
            );
            return None;
        }
    };
    value
        .get("model")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(str::to_string)
}

fn read_gemini_env_model(gemini_home: &Path) -> Option<String> {
    let env_path = gemini_home.join(".env");
    let text = match std::fs::read_to_string(&env_path) {
        Ok(t) => t,
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                warn!(
                    "Failed to read Gemini .env from {}: {}",
                    env_path.display(),
                    e
                );
            }
            return None;
        }
    };
    text.lines().find_map(|line| {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            return None;
        }
        let (key, value) = line.split_once('=')?;
        if key.trim() != "GEMINI_MODEL" {
            return None;
        }
        let model = value.trim().trim_matches(|ch| ch == '"' || ch == '\'');
        (!model.is_empty()).then(|| model.to_string())
    })
}

/// Antigravity uses its account catalog. Ordinary Code Assist keeps the existing
/// defaults and local model selection.
pub(crate) async fn list_models(client: &AIClient) -> Result<Vec<RemoteModelInfo>> {
    if is_antigravity(client) {
        return list_antigravity_models(client, CODE_ASSIST_BASE).await;
    }
    let mut models = Vec::new();

    if let Some(gemini_home) = gemini_home_dir() {
        if let Some(model) =
            read_gemini_settings_model(&gemini_home).or_else(|| read_gemini_env_model(&gemini_home))
        {
            models.push(RemoteModelInfo {
                id: model,
                display_name: None,
            });
        }
    }

    for (id, display_name) in DEFAULT_CODE_ASSIST_MODELS {
        models.push(RemoteModelInfo {
            id: (*id).to_string(),
            display_name: Some((*display_name).to_string()),
        });
    }

    Ok(crate::client::utils::dedupe_remote_models(models))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        http::{HeaderMap, StatusCode},
        routing::{get, post},
        Json, Router,
    };
    use futures::StreamExt;
    use serde_json::{json, Value};
    use std::sync::Arc;

    fn client(credential: &str, antigravity: bool) -> AIClient {
        AIClient::new(serde_json::from_value(json!({
            "name": "code-assist-test", "base_url": CODE_ASSIST_BASE, "request_url": "",
            "api_key": credential, "model": "gemini-3.1-pro-preview", "format": "gemini-code-assist",
            "context_window": 128000, "inline_think_in_text": false, "skip_ssl_verify": false,
            "custom_headers": if antigravity {
                json!({"user-agent": "antigravity/test", "client-metadata": json!({"ideType": "ANTIGRAVITY", "platform": "PLATFORM_UNSPECIFIED", "pluginType": "GEMINI"}).to_string()})
            } else { json!({}) }
        })).unwrap())
    }

    async fn serve(app: Router) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (base, server)
    }

    #[tokio::test]
    async fn lists_account_wire_ids_with_only_the_matching_cached_project() {
        let bodies = Arc::new(Mutex::new(Vec::new()));
        let captured = bodies.clone();
        let app = Router::new().route(AVAILABLE_MODELS_ENDPOINT, post(move |headers: HeaderMap, Json(body): Json<Value>| {
            let captured = captured.clone();
            async move {
                assert_eq!(headers["user-agent"], "antigravity/test");
                assert!(headers["authorization"].to_str().unwrap().starts_with("Bearer catalog-"));
                captured.lock().await.push(body);
                Json(json!({"models": {
                    "Future-Model-preview-high": {"displayName": "Future model", "quotaInfo": {"remainingFraction": 0}},
                    "gemini-3.1-pro-high": {"displayName": "Gemini Pro (High)"},
                    "other-model": {}
                }}))
            }
        }));
        let (base, server) = serve(app).await;
        let first = client("catalog-first", true);
        let other = client("catalog-other", true);
        let models = list_antigravity_models(&first, &base).await.unwrap();
        remember_project(&first, "account-project".to_string()).await;
        list_antigravity_models(&first, &base).await.unwrap();
        list_antigravity_models(&other, &base).await.unwrap();
        assert_eq!(project_for(&client("catalog-first", false)).await, None);
        server.abort();
        assert_eq!(
            *bodies.lock().await,
            vec![json!({}), json!({"project": "account-project"}), json!({})]
        );
        assert_eq!(
            models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            [
                "Future-Model-preview-high",
                "gemini-3.1-pro-high",
                "other-model"
            ]
        );
        assert_eq!(models[0].display_name.as_deref(), Some("Future model"));
        assert_eq!(models[2].display_name, None);
        for model in models {
            assert_eq!(resolve_antigravity_model(&model.id, &json!({})), model.id);
        }
    }

    #[tokio::test]
    async fn reports_catalog_failures_without_static_models() {
        for (status, body, expected) in [
            (StatusCode::OK, json!({"models": {}}), "no available models"),
            (
                StatusCode::OK,
                json!({}),
                "parse Antigravity account model catalog",
            ),
            (
                StatusCode::BAD_REQUEST,
                json!({"error": "INVALID_ARGUMENT"}),
                "INVALID_ARGUMENT",
            ),
        ] {
            let app = Router::new().route(
                AVAILABLE_MODELS_ENDPOINT,
                post(move || {
                    let body = body.clone();
                    async move { (status, Json(body)) }
                }),
            );
            let (base, server) = serve(app).await;
            let error = list_antigravity_models(&client("catalog-error", true), &base)
                .await
                .unwrap_err();
            server.abort();
            assert!(format!("{error:#}").contains(expected), "{error:#}");
        }
    }

    #[tokio::test]
    async fn sends_valid_metadata_and_onboards_the_account_default_tier() {
        let app = Router::new()
            .route(LOAD_CODE_ASSIST_ENDPOINT, post(|Json(body): Json<Value>| async move {
                assert_eq!(body, json!({"metadata": {
                    "ideType": "ANTIGRAVITY", "platform": "PLATFORM_UNSPECIFIED", "pluginType": "GEMINI"
                }}));
                Json(json!({"allowedTiers": [{"id": "other-tier"}, {"id": "account-tier", "isDefault": true}]}))
            }))
            .route(ONBOARD_USER_ENDPOINT, post(|Json(body): Json<Value>| async move {
                assert_eq!(body["tierId"], "account-tier");
                assert_eq!(body["metadata"]["platform"], "PLATFORM_UNSPECIFIED");
                assert!(body.get("cloudaicompanionProject").is_none());
                assert!(body["metadata"].get("duetProject").is_none());
                Json(json!({"done": true, "response": {"cloudaicompanionProject": {"id": "managed-project"}}}))
            }));
        let (base, server) = serve(app).await;
        let project = load_project(&client("initialization-test", true), &base)
            .await
            .unwrap();
        server.abort();
        assert_eq!(project, "managed-project");
    }

    #[tokio::test]
    async fn preserves_initialization_parameter_errors() {
        let app = Router::new().route(LOAD_CODE_ASSIST_ENDPOINT, post(|| async {
            (StatusCode::BAD_REQUEST, Json(json!({"error": {"status": "INVALID_ARGUMENT", "message": "metadata.platform rejected"}})))
        }));
        let (base, server) = serve(app).await;
        let error = load_project(&client("initialization-error", true), &base)
            .await
            .unwrap_err();
        server.abort();
        let message = format!("{error:#}");
        assert!(
            message.contains("400")
                && message.contains("INVALID_ARGUMENT")
                && message.contains("metadata.platform")
        );
    }

    #[test]
    fn accepts_legacy_and_object_project_responses() {
        for (payload, expected) in [
            (
                json!({"cloudaicompanionProject": "legacy-project"}),
                Some("legacy-project"),
            ),
            (
                json!({"cloudaicompanionProject": {"id": "object-project"}, "allowedTiers": null}),
                Some("object-project"),
            ),
            (json!({"cloudaicompanionProject": null}), None),
        ] {
            let load: LoadCodeAssistResponse = serde_json::from_value(payload).unwrap();
            assert_eq!(
                extract_project(load.cloudaicompanion_project.as_ref()).as_deref(),
                expected
            );
        }
    }

    #[test]
    fn maps_only_known_legacy_preview_aliases() {
        let plain = json!({});
        for (alias, wire) in [
            ("gemini-3-pro-preview", "gemini-3-pro-low"),
            ("gemini-3.1-pro-preview", "gemini-3.1-pro-low"),
            ("gemini-3.1-pro-preview-customtools", "gemini-3.1-pro-low"),
            ("gemini-3-flash-preview", "gemini-3-flash"),
        ] {
            assert_eq!(resolve_antigravity_model(alias, &plain), wire);
        }
        let high = json!({"generationConfig": {"thinkingConfig": {"thinkingLevel": "HIGH"}}});
        assert_eq!(
            resolve_antigravity_model("gemini-3.1-pro-preview", &high),
            "gemini-3.1-pro-high"
        );
    }

    #[tokio::test]
    async fn keeps_ordinary_code_assist_defaults() {
        let ordinary = client("ordinary-test", false);
        assert_eq!(client_metadata(&ordinary)["ideType"], "IDE_UNSPECIFIED");
        let models = list_models(&ordinary).await.unwrap();
        assert!(models
            .iter()
            .any(|model| model.id == "gemini-3.1-pro-preview"));
    }

    #[tokio::test]
    async fn completes_pending_onboarding_and_preserves_operation_failures() {
        for (operation, expected) in [
            (
                json!({"done": false, "name": "operations/account-setup"}),
                "managed-project",
            ),
            (json!({"done": false}), "no operation name"),
            (
                json!({"done": true, "error": {"message": "account is ineligible"}}),
                "account is ineligible",
            ),
        ] {
            let app = Router::new()
                .route(LOAD_CODE_ASSIST_ENDPOINT, post(|| async { Json(json!({"allowedTiers": [{"id": "account-tier", "isDefault": true}]})) }))
                .route(ONBOARD_USER_ENDPOINT, post(move || {
                    let operation = operation.clone();
                    async move { Json(operation) }
                }))
                .route("/v1internal/operations/account-setup", get(|headers: HeaderMap| async move {
                    assert!(headers["authorization"].to_str().unwrap().starts_with("Bearer "));
                    Json(json!({"done": true, "response": {"cloudaicompanionProject": {"id": "managed-project"}}}))
                }));
            let (base, server) = serve(app).await;
            let result = load_project(&client("pending-project", true), &base).await;
            server.abort();
            let actual = match result {
                Ok(project) => project,
                Err(error) => format!("{error:#}"),
            };
            assert!(actual.contains(expected), "{actual}");
        }
    }

    #[test]
    fn compiles_subscription_presets_and_preserves_ordinary_request_configuration() {
        use crate::types::{ReasoningPresetAction, ReasoningPresetDescriptor};
        let preset = |action| ReasoningPresetDescriptor {
            id: "selected".into(),
            label: "Selected".into(),
            order: 0,
            actions: vec![action],
            source: bitfun_core_types::ReasoningPresetSource::ModelConfig,
            execution_provider: None,
            execution_model: None,
        };
        for (model, action, expected) in [
            (
                "gemini-3.1-pro-preview",
                ReasoningPresetAction::Effort {
                    value: "high".into(),
                },
                json!({"includeThoughts": true, "thinkingLevel": "HIGH"}),
            ),
            (
                "claude-opus-4-6-thinking",
                ReasoningPresetAction::BudgetTokens { value: 4096 },
                json!({"include_thoughts": true, "thinking_budget": 4096}),
            ),
            (
                "claude-opus-4-6-thinking",
                ReasoningPresetAction::Toggle { enabled: false },
                json!({"include_thoughts": false}),
            ),
        ] {
            let mut subscription = client("reasoning", true);
            subscription.config.model = model.into();
            subscription.config.max_tokens = Some(16384);
            subscription = subscription.with_reasoning_preset(&preset(action));
            let (body, _) = build_request_body(
                &subscription,
                vec![Message::user("Hello".into())],
                None,
                None,
            )
            .unwrap();
            assert_eq!(
                body["request"]["generationConfig"]["thinkingConfig"],
                expected
            );
            assert_eq!(
                body["request"]["generationConfig"]["maxOutputTokens"],
                16384
            );
            if model.starts_with("gemini") {
                assert_eq!(body["model"], "gemini-3.1-pro-high");
            }
        }
        let mut ordinary = client("ordinary-reasoning", false);
        ordinary.config.model = "gemini-2.5-flash".into();
        ordinary = ordinary
            .with_reasoning_preset(&preset(ReasoningPresetAction::Toggle { enabled: false }));
        let messages = vec![Message::user("Hello".into())];
        let (_, contents) =
            GeminiMessageConverter::convert_messages(messages.clone(), &ordinary.config.model);
        let expected =
            gemini_request::try_build_request_body(&ordinary, None, contents, None, None).unwrap();
        let (body, empty_tools) = build_request_body(&ordinary, messages, None, None).unwrap();
        assert_eq!(body["request"], expected);
        assert!(body.get("userAgent").is_none() && empty_tools.is_empty());
    }

    #[tokio::test]
    async fn streams_plain_and_wrapped_events_through_multiple_tool_rounds() {
        for (model, antigravity) in [
            ("gemini-2.5-flash", false),
            ("gemini-3.1-pro-high", true),
            ("claude-opus-4-6-thinking", true),
        ] {
            let bodies = Arc::new(Mutex::new(Vec::new()));
            let captured = bodies.clone();
            let app = Router::new().route("/stream", post(move |headers: HeaderMap, Json(body): Json<Value>| {
                let captured = captured.clone();
                async move {
                    assert!(headers["authorization"].to_str().unwrap().starts_with("Bearer "));
                    assert!(!headers.contains_key("x-goog-api-key"));
                    let tool_round = body["request"]["contents"].as_array().unwrap().iter()
                        .any(|content| content["parts"].as_array().is_some_and(|parts| parts.iter().any(|part| part.get("functionResponse").is_some())));
                    captured.lock().await.push(body);
                    let mut payload = if tool_round {
                        json!({"candidates": [{"content": {"parts": [{"text": "Done"}]}, "finishReason": "STOP"}]})
                    } else {
                        let arguments = if model.starts_with("claude") { json!({super::super::antigravity::EMPTY_PARAMETER_NAME: true}) } else { json!({}) };
                        json!({"candidates": [{"content": {"parts": [
                            {"thought": true, "text": "Plan", "thoughtSignature": "test-signature"},
                            {"functionCall": {"name": "list", "args": arguments}, "thoughtSignature": "test-signature"},
                            {"functionCall": {"name": "configure", "args": {super::super::antigravity::EMPTY_PARAMETER_NAME: true}}},
                            {"text": "Ready"}
                        ]}, "finishReason": "STOP"}], "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 6, "thoughtsTokenCount": 2, "totalTokenCount": 18}})
                    };
                    if antigravity { payload = json!({"response": payload, "traceId": "test"}); }
                    ([("content-type", "text/event-stream")], format!("data: {payload}\n\n"))
                }
            }));
            let (base, server) = serve(app).await;
            let mut subscription = client("stream-test", antigravity);
            subscription.config.model = model.into();
            let tools = vec![
                ToolDefinition {
                    name: "list".into(),
                    description: "List entries".into(),
                    parameters: json!({"type": "object", "properties": {}}),
                },
                ToolDefinition {
                    name: "configure".into(),
                    description: "Configure".into(),
                    parameters: json!({"type": "object", "properties": {super::super::antigravity::EMPTY_PARAMETER_NAME: {"type": "boolean"}}}),
                },
            ];
            let mut messages = vec![Message::user("List and configure".into())];
            let (mut body, empty_tools) =
                build_request_body(&subscription, messages.clone(), Some(tools.clone()), None)
                    .unwrap();
            body["project"] = json!("account-project");
            let urls = vec![format!("{base}/stream")];
            let mut response = stream_from_urls(&subscription, &body, &urls, 1, None, empty_tools)
                .await
                .unwrap();
            let mut chunks = Vec::new();
            while let Some(chunk) = response.stream.next().await {
                chunks.push(chunk.unwrap());
            }
            assert!(chunks
                .iter()
                .any(|chunk| chunk.reasoning_content.as_deref() == Some("Plan")));
            assert!(chunks
                .iter()
                .any(|chunk| chunk.text.as_deref() == Some("Ready")));
            assert_eq!(
                chunks
                    .iter()
                    .find_map(|chunk| chunk.usage.as_ref())
                    .unwrap()
                    .prompt_token_count,
                10
            );
            assert_eq!(
                chunks.last().unwrap().finish_reason.as_deref(),
                Some("STOP")
            );
            let mut calls = Vec::new();
            for call in chunks.iter().filter_map(|chunk| chunk.tool_call.as_ref()) {
                let arguments: Value =
                    serde_json::from_str(call.arguments.as_deref().unwrap()).unwrap();
                if call.name.as_deref() == Some("list") {
                    assert_eq!(arguments, json!({}));
                } else {
                    assert_eq!(
                        arguments,
                        json!({super::super::antigravity::EMPTY_PARAMETER_NAME: true})
                    );
                }
                calls.push(
                    serde_json::from_value(
                        json!({"id": call.id, "name": call.name, "arguments": arguments}),
                    )
                    .unwrap(),
                );
            }
            assert_eq!(calls.len(), 2);
            let mut assistant = Message::assistant_with_tools(calls);
            assistant.thinking_signature = Some("test-signature".into());
            messages.push(assistant);
            for name in ["list", "configure"] {
                messages.push(
                    serde_json::from_value(
                        json!({"role": "tool", "name": name, "content": "{\"ok\":true}"}),
                    )
                    .unwrap(),
                );
            }
            let (mut followup, empty_tools) =
                build_request_body(&subscription, messages, Some(tools), None).unwrap();
            followup["project"] = json!("account-project");
            assert_eq!(
                followup["request"]["contents"][1]["parts"][0]["functionCall"]["args"],
                json!({})
            );
            assert_eq!(
                followup["request"]["contents"][1]["parts"][0]["thoughtSignature"],
                "test-signature"
            );
            let mut response =
                stream_from_urls(&subscription, &followup, &urls, 1, None, empty_tools)
                    .await
                    .unwrap();
            assert_eq!(
                response
                    .stream
                    .next()
                    .await
                    .unwrap()
                    .unwrap()
                    .text
                    .as_deref(),
                Some("Done")
            );
            assert!(response.stream.next().await.is_none());
            assert_eq!(bodies.lock().await.len(), 2);
            server.abort();
        }
    }

    #[tokio::test]
    async fn falls_back_only_for_compatible_http_and_connection_failures() {
        for (status, should_fallback) in [
            (Some(400), false),
            (Some(401), false),
            (Some(429), false),
            (Some(403), true),
            (Some(404), true),
            (Some(500), true),
            (Some(503), true),
            (None, true),
        ] {
            let requests = Arc::new(Mutex::new(Vec::new()));
            let failed = requests.clone();
            let success = requests.clone();
            let app = Router::new()
                .route("/first", post(move || {
                    let requests = failed.clone();
                    async move {
                        requests.lock().await.push("first");
                        (StatusCode::from_u16(status.unwrap_or(503)).unwrap(), Json(json!({"error": {"message": "request rejected"}})))
                    }
                }))
                .route("/second", post(move || {
                    let requests = success.clone();
                    async move {
                        requests.lock().await.push("second");
                        ([("content-type", "text/event-stream")], "data: {\"response\":{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"OK\"}]},\"finishReason\":\"STOP\"}]}}\n\n")
                    }
                }));
            let (base, server) = serve(app).await;
            let first_url = if status.is_some() {
                format!("{base}/first")
            } else {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let url = format!("http://{}/stream", listener.local_addr().unwrap());
                drop(listener);
                url
            };
            let urls = vec![first_url, format!("{base}/second")];
            let result = stream_from_urls(
                &client("fallback-test", true),
                &json!({}),
                &urls,
                1,
                None,
                Vec::new(),
            )
            .await;
            if should_fallback {
                let mut response = result.unwrap();
                assert_eq!(
                    response
                        .stream
                        .next()
                        .await
                        .unwrap()
                        .unwrap()
                        .text
                        .as_deref(),
                    Some("OK")
                );
                let expected = if status.is_some() {
                    vec!["first", "second"]
                } else {
                    vec!["second"]
                };
                assert_eq!(*requests.lock().await, expected);
            } else {
                let error = match result {
                    Err(error) => error,
                    Ok(_) => panic!("parameter, auth, and quota failures must stop"),
                };
                assert_eq!(
                    error
                        .downcast_ref::<bitfun_core_types::errors::AiProviderError>()
                        .unwrap()
                        .http_status,
                    status
                );
                assert_eq!(*requests.lock().await, ["first"]);
            }
            server.abort();
        }
    }

    #[test]
    fn endpoint_fallback_preserves_explicit_custom_urls_and_ordinary_routes() {
        for url in [
            "https://example.com/v1internal:streamGenerateContent?alt=sse",
            "http://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse",
            "https://cloudcode-pa.googleapis.com:8443/v1internal:streamGenerateContent?alt=sse",
        ] {
            assert_eq!(endpoint_urls(url, true), [url]);
        }
        let primary = format!("{CODE_ASSIST_BASE}{STREAM_ENDPOINT}");
        assert_eq!(endpoint_urls(&primary, false), [primary.clone()]);
        let urls = endpoint_urls(&primary, true);
        assert_eq!(urls.len(), 3);
        assert_eq!(urls[0], primary);
        assert!(urls.iter().all(|url| url.ends_with(STREAM_ENDPOINT)));
    }

    #[tokio::test]
    async fn surfaces_embedded_stream_errors_without_replaying_the_request() {
        let app = Router::new().route("/stream", post(|| async {
            ([("content-type", "text/event-stream")], "data: {\"response\":{\"error\":{\"status\":\"INVALID_ARGUMENT\",\"message\":\"invalid tool parameters\"}}}\n\n")
        }));
        let (base, server) = serve(app).await;
        let urls = vec![format!("{base}/stream"), "http://127.0.0.1:1/unused".into()];
        let mut response = stream_from_urls(
            &client("embedded-error", true),
            &json!({}),
            &urls,
            1,
            None,
            Vec::new(),
        )
        .await
        .unwrap();
        let error = response.stream.next().await.unwrap().unwrap_err();
        let provider_error = error
            .downcast_ref::<bitfun_core_types::errors::AiProviderError>()
            .unwrap();
        assert_eq!(
            provider_error.provider_code.as_deref(),
            Some("INVALID_ARGUMENT")
        );
        assert!(provider_error.message.contains("invalid tool parameters"));
        assert!(response.stream.next().await.is_none());
        server.abort();
    }
}
