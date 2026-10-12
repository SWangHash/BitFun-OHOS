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
use crate::stream::handle_gemini_stream;
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
    let load_url = format!("{base_url}{LOAD_CODE_ASSIST_ENDPOINT}");
    let load_body = serde_json::json!({ "metadata": metadata });
    let load_resp = apply_headers(client, client.client.post(&load_url))
        .json(&load_body)
        .send()
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
    let onboard_url = format!("{base_url}{ONBOARD_USER_ENDPOINT}");
    let onboard_body = serde_json::json!({
        "tierId": tier,
        "metadata": metadata,
    });
    let onboard_resp = apply_headers(client, client.client.post(&onboard_url))
        .json(&onboard_body)
        .send()
        .await?;
    let onboard_status = onboard_resp.status();
    if !onboard_status.is_success() {
        let body = onboard_resp.text().await.unwrap_or_default();
        return Err(anyhow!("onboardUser failed: HTTP {onboard_status}: {body}"));
    }
    let parsed: OnboardOperation = onboard_resp.json().await?;
    if !parsed.done.unwrap_or(false) {
        return Err(anyhow!("onboardUser did not complete in a single call"));
    }
    let project = parsed
        .response
        .and_then(|r| r.cloudaicompanion_project)
        .and_then(|p| p.id)
        .filter(|project| !project.trim().is_empty())
        .ok_or_else(|| anyhow!("onboardUser response missing project id"))?;
    Ok(project)
}

pub(crate) async fn send_stream(
    client: &AIClient,
    messages: Vec<Message>,
    tools: Option<Vec<ToolDefinition>>,
    extra_body: Option<serde_json::Value>,
    max_tries: usize,
    trace: Option<ModelExchangeTraceConfig>,
) -> Result<StreamResponse> {
    let project = discover_project(client).await?;

    let (system_instruction, contents) =
        GeminiMessageConverter::convert_messages(messages, &client.config.model);
    let gemini_tools = GeminiMessageConverter::convert_tools(tools);
    let inner = gemini_request::try_build_request_body(
        client,
        system_instruction,
        contents,
        gemini_tools,
        extra_body,
    )?;

    let antigravity = is_antigravity(client);
    let model = if antigravity {
        resolve_antigravity_model(&client.config.model, &inner)
    } else {
        client.config.model.clone()
    };
    let mut request_body = serde_json::json!({
        "model": model,
        "project": project,
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

    let url = if client.config.request_url.is_empty() {
        format!("{}{}", CODE_ASSIST_BASE, STREAM_ENDPOINT)
    } else {
        client.config.request_url.clone()
    };

    debug!(
        "Gemini Code Assist config: model={}, request_url={}, project={}, max_tries={}",
        client.config.model, url, project, max_tries
    );

    let idle_timeout = client.stream_options.idle_timeout;
    let ttft_timeout = client.stream_options.ttft_timeout;
    execute_sse_request(
        "Gemini Code Assist Streaming API",
        &url,
        &request_body,
        max_tries,
        ttft_timeout,
        trace,
        || apply_headers(client, client.client.post(&url)),
        move |response, tx, tx_raw, remaining_ttft_timeout| {
            handle_gemini_stream(response, tx, tx_raw, remaining_ttft_timeout, idle_timeout)
        },
    )
    .await
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
    let response = apply_headers(
        client,
        client
            .client
            .post(format!("{base_url}{AVAILABLE_MODELS_ENDPOINT}")),
    )
    .timeout(std::time::Duration::from_secs(
        AIClient::STREAM_CONNECT_TIMEOUT_SECS,
    ))
    .json(&body)
    .send()
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
        routing::post,
        Json, Router,
    };
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
}
