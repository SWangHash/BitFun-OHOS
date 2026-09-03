use crate::client::quirks::{
    apply_openai_compatible_toggle, is_deepseek_reasoning_effort_model, is_deepseek_url,
    is_glm_52_reasoning_effort_model, is_zhipuai_url, normalize_deepseek_reasoning_effort,
    normalize_glm_52_reasoning_effort,
};
use crate::client::utils::{dedupe_remote_models, normalize_base_url_for_discovery};
use crate::client::AIClient;
use crate::providers::shared;
use crate::types::{
    ReasoningPresetAction, ReasoningPresetDescriptor, RemoteModelInfo, ToolDefinition,
};
use anyhow::{anyhow, Context, Result};
use log::warn;
use reqwest::RequestBuilder;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Deserialize)]
struct OpenAIModelsResponse {
    data: Vec<OpenAIModelEntry>,
}

#[derive(Debug, Deserialize)]
struct OpenAIModelEntry {
    id: String,
}

pub(crate) fn apply_headers(client: &AIClient, builder: RequestBuilder) -> RequestBuilder {
    shared::apply_header_policy(client, builder, |mut builder| {
        builder = builder.header("Content-Type", "application/json");

        // When the API key is empty or whitespace-only, do not set the
        // Authorization header. This allows local model services (e.g. Ollama)
        // that do not require authentication to work without a dummy key.
        let api_key = client.config.api_key.trim();
        if !api_key.is_empty() {
            builder = builder.header("Authorization", format!("Bearer {}", api_key));
        }

        if client.config.base_url.contains("openbitfun.com") {
            builder = builder.header("X-Verification-Code", "from_bitfun");
        }

        builder
    })
}

pub(crate) fn compile_chat_reasoning_action(
    preset: &ReasoningPresetDescriptor,
    action: &ReasoningPresetAction,
    request_body: &mut serde_json::Value,
    url: &str,
    configured_model: &str,
) -> Result<bool> {
    let execution_provider = preset.execution_provider.as_deref().unwrap_or("openai");
    let execution_model = preset
        .execution_model
        .as_deref()
        .unwrap_or(configured_model)
        .trim()
        .to_ascii_lowercase();
    let is_deepseek_reasoning_target = execution_provider.eq_ignore_ascii_case("deepseek")
        || is_deepseek_url(url)
        || is_deepseek_reasoning_effort_model(&execution_model);
    let is_glm_52_reasoning_target = is_glm_52_reasoning_effort_model(&execution_model)
        && (execution_provider.eq_ignore_ascii_case("zhipuai") || is_zhipuai_url(url));

    match action {
        ReasoningPresetAction::Toggle { enabled } if is_deepseek_reasoning_target => {
            request_body["thinking"] = serde_json::json!({
                "type": if *enabled { "enabled" } else { "disabled" }
            });
            if !enabled {
                request_body
                    .as_object_mut()
                    .map(|body| body.remove("reasoning_effort"));
            }
            Ok(true)
        }
        ReasoningPresetAction::Effort { value } if is_deepseek_reasoning_target => {
            let normalized = normalize_deepseek_reasoning_effort(&execution_model, value)
                .ok_or_else(|| {
                    anyhow!(
                        "DeepSeek reasoning effort '{}' is unsupported for model '{}'",
                        value,
                        execution_model
                    )
                })?;
            request_body["thinking"] = serde_json::json!({ "type": "enabled" });
            request_body["reasoning_effort"] = serde_json::json!(normalized);
            Ok(true)
        }
        ReasoningPresetAction::Toggle { enabled } if is_glm_52_reasoning_target => {
            request_body["thinking"] = serde_json::json!({
                "type": if *enabled { "enabled" } else { "disabled" }
            });
            if !enabled {
                request_body
                    .as_object_mut()
                    .map(|body| body.remove("reasoning_effort"));
            }
            Ok(true)
        }
        ReasoningPresetAction::Effort { value } if is_glm_52_reasoning_target => {
            let normalized = normalize_glm_52_reasoning_effort(value)
                .ok_or_else(|| anyhow!("GLM-5.2 reasoning effort '{}' is unsupported", value))?;
            request_body["thinking"] = serde_json::json!({ "type": "enabled" });
            request_body["reasoning_effort"] = serde_json::json!(normalized);
            Ok(true)
        }
        ReasoningPresetAction::Toggle { enabled } => {
            Ok(apply_openai_compatible_toggle(request_body, *enabled, url))
        }
        ReasoningPresetAction::Effort { .. } | ReasoningPresetAction::BudgetTokens { .. } => {
            Ok(false)
        }
        ReasoningPresetAction::RequestPatch { .. } => {
            unreachable!("patches are compiled by shared code")
        }
    }
}

pub(crate) fn resolve_models_url(client: &AIClient) -> String {
    let mut base = normalize_base_url_for_discovery(&client.config.base_url);

    for suffix in ["/chat/completions", "/responses", "/models"] {
        if base.ends_with(suffix) {
            base.truncate(base.len() - suffix.len());
            break;
        }
    }

    if base.is_empty() {
        return "models".to_string();
    }

    format!("{}/models", base)
}

pub(crate) async fn list_models(client: &AIClient) -> Result<Vec<RemoteModelInfo>> {
    let url = resolve_models_url(client);

    // Codex CLI's ChatGPT backend (`chatgpt.com/backend-api/codex`) hosts a
    // private, non-OpenAI-shaped `/models` endpoint that returns
    // `{ "models": [{ "slug": "...", "display_name": "..." }, ...] }`. Detect
    // and route it through a dedicated parser instead of the public OpenAI
    // schema (which would yield zero models because of the envelope mismatch).
    if url.contains("chatgpt.com/backend-api/codex") {
        return list_codex_chatgpt_models(client, &url).await;
    }

    let response = apply_headers(client, client.client.get(&url))
        .send()
        .await?
        .error_for_status()?;

    let payload: OpenAIModelsResponse = response.json().await?;
    Ok(dedupe_remote_models(
        payload
            .data
            .into_iter()
            .map(|model| RemoteModelInfo {
                id: model.id,
                display_name: None,
            })
            .collect(),
    ))
}

#[derive(Debug, Deserialize)]
struct CodexBackendModelsResponse {
    #[serde(default)]
    models: Vec<CodexBackendModelEntry>,
}

#[derive(Debug, Deserialize)]
struct CodexBackendModelEntry {
    slug: String,
    /// Returned by the backend but unused — see comment in the mapping below
    /// (display_name is dropped to avoid duplicate-looking entries).
    #[allow(dead_code)]
    #[serde(default)]
    display_name: Option<String>,
    /// Codex backend marks deprecated/internal slugs with `visibility = "hide"`.
    /// We only surface entries the CLI itself shows (`list`).
    #[serde(default)]
    visibility: Option<String>,
    #[serde(default)]
    supported_in_api: Option<bool>,
    #[serde(default)]
    priority: Option<i64>,
}

const DEFAULT_CODEX_MODELS: &[&str] = &[
    "gpt-5.6",
    "gpt-5.5",
    "gpt-5.4-mini",
    "gpt-5.4",
    "gpt-5.3-codex",
    "gpt-5.2-codex",
    "gpt-5.1-codex-max",
    "gpt-5.1-codex-mini",
];

pub(crate) fn is_known_codex_reasoning_model(model_id: &str) -> bool {
    let model_id = model_id.trim().to_ascii_lowercase();
    model_id == "gpt-5-codex" || DEFAULT_CODEX_MODELS.contains(&model_id.as_str())
}

const FORWARD_COMPAT_CODEX_MODELS: &[(&str, &[&str])] = &[
    ("gpt-5.6", &["gpt-5.5", "gpt-5.4"]),
    ("gpt-5.5", &["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex"]),
    ("gpt-5.4-mini", &["gpt-5.3-codex", "gpt-5.2-codex"]),
    ("gpt-5.4", &["gpt-5.3-codex", "gpt-5.2-codex"]),
    ("gpt-5.3-codex", &["gpt-5.2-codex"]),
];

const CODEX_MODEL_DISCOVERY_MAX_ATTEMPTS: usize = 2;
const CODEX_MODEL_DISCOVERY_ATTEMPT_TIMEOUT: Duration = Duration::from_secs(12);
const CODEX_MODEL_DISCOVERY_RETRY_DELAY: Duration = Duration::from_millis(250);

fn codex_home_dir() -> PathBuf {
    std::env::var("CODEX_HOME")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex")))
        .unwrap_or_else(|| PathBuf::from(".codex"))
}

fn add_unique_model_id(ordered: &mut Vec<String>, id: String) {
    if !id.trim().is_empty() && !ordered.iter().any(|existing| existing == &id) {
        ordered.push(id);
    }
}

fn add_forward_compat_codex_models(ordered: &mut Vec<String>) {
    for (synthetic, templates) in FORWARD_COMPAT_CODEX_MODELS {
        if ordered.iter().any(|model| model == synthetic) {
            continue;
        }
        if templates
            .iter()
            .any(|template| ordered.iter().any(|model| model == template))
        {
            ordered.push((*synthetic).to_string());
        }
    }
}

fn read_codex_config_model(codex_home: &Path) -> Option<String> {
    let config_path = codex_home.join("config.toml");
    let text = match std::fs::read_to_string(&config_path) {
        Ok(t) => t,
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                warn!(
                    "Failed to read Codex config from {}: {}",
                    config_path.display(),
                    e
                );
            }
            return None;
        }
    };
    text.lines().find_map(|line| {
        let line = line.trim();
        if line.starts_with('#') {
            return None;
        }
        let (key, value) = line.split_once('=')?;
        if key.trim() != "model" {
            return None;
        }
        let model = value.trim().trim_matches(|ch| ch == '"' || ch == '\'');
        (!model.is_empty()).then(|| model.to_string())
    })
}

fn read_codex_cached_models(codex_home: &Path) -> Vec<String> {
    let cache_path = codex_home.join("models_cache.json");
    let bytes = match std::fs::read(&cache_path) {
        Ok(b) => b,
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                warn!(
                    "Failed to read Codex models cache from {}: {}",
                    cache_path.display(),
                    e
                );
            }
            return Vec::new();
        }
    };
    let payload: CodexBackendModelsResponse = match serde_json::from_slice(&bytes) {
        Ok(p) => p,
        Err(e) => {
            warn!(
                "Failed to parse Codex models cache JSON from {}: {}",
                cache_path.display(),
                e
            );
            return Vec::new();
        }
    };
    codex_models_from_entries(payload.models)
}

fn codex_models_from_entries(entries: Vec<CodexBackendModelEntry>) -> Vec<String> {
    let mut sortable = Vec::new();
    for model in entries {
        if model.supported_in_api == Some(false) {
            continue;
        }
        if model
            .visibility
            .as_deref()
            .map(|v| {
                let normalized = v.trim().to_ascii_lowercase();
                normalized == "hide" || normalized == "hidden"
            })
            .unwrap_or(false)
        {
            continue;
        }
        sortable.push((model.priority.unwrap_or(10_000), model.slug));
    }
    sortable.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

    let mut ordered = Vec::new();
    for (_, slug) in sortable {
        add_unique_model_id(&mut ordered, slug);
    }
    ordered
}

fn codex_fallback_model_ids() -> Vec<String> {
    let codex_home = codex_home_dir();
    let mut ordered = Vec::new();
    if let Some(model) = read_codex_config_model(&codex_home) {
        add_unique_model_id(&mut ordered, model);
    }
    for model in read_codex_cached_models(&codex_home) {
        add_unique_model_id(&mut ordered, model);
    }
    for model in DEFAULT_CODEX_MODELS {
        add_unique_model_id(&mut ordered, (*model).to_string());
    }
    add_forward_compat_codex_models(&mut ordered);
    ordered
}

fn codex_model_infos(model_ids: Vec<String>) -> Vec<RemoteModelInfo> {
    dedupe_remote_models(
        model_ids
            .into_iter()
            .map(|id| RemoteModelInfo {
                id,
                display_name: None,
            })
            .collect(),
    )
}

/// `chatgpt.com/backend-api/codex/models` returns each model's
/// `minimal_client_version`, and only emits entries whose minimum is satisfied
/// by the `client_version` query param. Hermes-agent uses `client_version=1.0.0`
/// for discovery, which avoids accidentally hiding newer models when the local
/// CLI binary is old or unavailable.
fn codex_models_url(base_models_url: &str) -> String {
    let separator = if base_models_url.contains('?') {
        '&'
    } else {
        '?'
    };
    format!("{base_models_url}{separator}client_version=1.0.0")
}

fn is_retryable_codex_model_discovery_error(error: &anyhow::Error) -> bool {
    if error
        .downcast_ref::<tokio::time::error::Elapsed>()
        .is_some()
    {
        return true;
    }

    error.downcast_ref::<reqwest::Error>().is_some_and(|error| {
        error.is_connect()
            || error.is_timeout()
            || error.is_request()
            || error.is_body()
            || error.is_decode()
            || error.status().is_some_and(|status| {
                status.is_server_error() || matches!(status.as_u16(), 408 | 425 | 429)
            })
    })
}

async fn fetch_codex_chatgpt_model_ids(client: &AIClient, url: &str) -> Result<Vec<String>> {
    let response = apply_headers(client, client.client.get(url))
        .send()
        .await?
        .error_for_status()?;
    let payload: CodexBackendModelsResponse = response.json().await?;
    Ok(codex_models_from_entries(payload.models))
}

async fn fetch_codex_chatgpt_model_ids_with_retry(
    client: &AIClient,
    url: &str,
) -> Result<Vec<String>> {
    for attempt in 1..=CODEX_MODEL_DISCOVERY_MAX_ATTEMPTS {
        let result = tokio::time::timeout(
            CODEX_MODEL_DISCOVERY_ATTEMPT_TIMEOUT,
            fetch_codex_chatgpt_model_ids(client, url),
        )
        .await
        .context("Codex backend model discovery timed out")
        .and_then(|result| result);

        match result {
            Ok(models) => return Ok(models),
            Err(error)
                if attempt < CODEX_MODEL_DISCOVERY_MAX_ATTEMPTS
                    && is_retryable_codex_model_discovery_error(&error) =>
            {
                log::warn!(
                    "Codex backend model discovery attempt {attempt}/{} failed: {error:#}; retrying",
                    CODEX_MODEL_DISCOVERY_MAX_ATTEMPTS
                );
                tokio::time::sleep(CODEX_MODEL_DISCOVERY_RETRY_DELAY).await;
            }
            Err(error) => return Err(error),
        }
    }

    unreachable!("Codex model discovery retry loop always returns")
}

async fn list_codex_chatgpt_models(
    client: &AIClient,
    base_models_url: &str,
) -> Result<Vec<RemoteModelInfo>> {
    let url = codex_models_url(base_models_url);
    let live_models = fetch_codex_chatgpt_model_ids_with_retry(client, &url).await;

    let mut model_ids = match live_models {
        Ok(models) if !models.is_empty() => models,
        Ok(_) => {
            log::warn!(
                "Codex backend model discovery returned no models; using local fallback catalog"
            );
            codex_fallback_model_ids()
        }
        Err(error) => {
            log::warn!(
                "Codex backend model discovery failed: {:#}; using local fallback catalog",
                error
            );
            codex_fallback_model_ids()
        }
    };

    add_forward_compat_codex_models(&mut model_ids);
    Ok(codex_model_infos(model_ids))
}

pub(crate) fn extract_tool_name(tool: &serde_json::Value) -> String {
    tool.get("function")
        .and_then(|function| function.get("name"))
        .and_then(|name| name.as_str())
        .or_else(|| tool.get("name").and_then(|name| name.as_str()))
        .unwrap_or("unknown")
        .to_string()
}

pub(crate) fn attach_tools(
    request_body: &mut serde_json::Value,
    tools: Option<Vec<serde_json::Value>>,
    target: &str,
) {
    match tools {
        Some(tools) if !tools.is_empty() => {
            let tool_names = tools.iter().map(extract_tool_name).collect::<Vec<_>>();
            shared::log_tool_names(target, tool_names);
            request_body["tools"] = serde_json::Value::Array(tools);
            let has_tool_choice = request_body
                .get("tool_choice")
                .is_some_and(|value| !value.is_null());
            if !has_tool_choice {
                request_body["tool_choice"] = serde_json::Value::String("auto".to_string());
            }
        }
        _ => {
            if request_body
                .as_object_mut()
                .and_then(|object| object.remove("tool_choice"))
                .is_some()
            {
                log::debug!(
                    target: target,
                    "Removed tool_choice from OpenAI request because no tools are attached"
                );
            }
        }
    }
}

pub(crate) fn convert_tools_flat(
    tools: Option<Vec<ToolDefinition>>,
) -> Option<Vec<serde_json::Value>> {
    tools.map(|defs| {
        defs.into_iter()
            .map(|tool| {
                serde_json::json!({
                    "type": "function",
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                    "strict": false,
                })
            })
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::{
        add_forward_compat_codex_models, attach_tools, is_known_codex_reasoning_model,
        list_codex_chatgpt_models,
    };
    use crate::{client::AIClient, types::AIConfig};
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn codex_discovery_test_client(base_url: String) -> AIClient {
        AIClient::new(AIConfig {
            name: "codex-discovery-test".to_string(),
            request_url: format!("{base_url}/responses"),
            base_url,
            api_key: "test-token".to_string(),
            model: "gpt-5.5".to_string(),
            format: "responses".to_string(),
            context_window: 128_000,
            max_tokens: None,
            temperature: None,
            top_p: None,
            inline_think_in_text: false,
            custom_headers: None,
            custom_headers_mode: None,
            skip_ssl_verify: false,
            custom_request_body: None,
            custom_request_body_mode: None,
        })
    }

    #[tokio::test]
    async fn codex_model_discovery_retries_an_incomplete_first_response() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for attempt in 0..2 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = [0u8; 2048];
                let _ = stream.read(&mut request).await.unwrap();
                if attempt == 0 {
                    stream
                        .write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 200\r\nConnection: close\r\n\r\n{\"models\":[",
                        )
                        .await
                        .unwrap();
                    continue;
                }

                let body = json!({
                    "models": [
                        {
                            "slug": "gpt-5.6",
                            "visibility": "list",
                            "supported_in_api": true,
                            "priority": 1
                        }
                    ]
                })
                .to_string();
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                stream.write_all(response.as_bytes()).await.unwrap();
            }
        });
        let client = codex_discovery_test_client(format!("http://{address}"));

        let models = list_codex_chatgpt_models(&client, &format!("http://{address}/models"))
            .await
            .unwrap();

        server.await.unwrap();
        assert_eq!(
            models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            ["gpt-5.6"]
        );
    }

    #[test]
    fn attach_tools_removes_tool_choice_without_tools() {
        let mut request_body = json!({
            "model": "test-model",
            "messages": [],
            "stream": true,
            "tool_choice": "none"
        });

        attach_tools(&mut request_body, None, "test");

        assert!(request_body.get("tools").is_none());
        assert!(request_body.get("tool_choice").is_none());
    }

    #[test]
    fn codex_reasoning_model_table_is_exact_and_case_insensitive() {
        assert!(is_known_codex_reasoning_model("GPT-5.6"));
        assert!(is_known_codex_reasoning_model("GPT-5.5"));
        assert!(is_known_codex_reasoning_model("gpt-5-codex"));
        assert!(!is_known_codex_reasoning_model("gpt-9-unknown"));
        assert!(!is_known_codex_reasoning_model("gpt-5.5-proxy"));
    }

    #[test]
    fn codex_model_discovery_backfills_current_model_from_previous_generation() {
        let mut models = vec!["gpt-5.5".to_string()];

        add_forward_compat_codex_models(&mut models);

        assert_eq!(models, ["gpt-5.5", "gpt-5.6"]);
    }

    #[test]
    fn attach_tools_removes_tool_choice_for_empty_tools() {
        let mut request_body = json!({
            "model": "test-model",
            "messages": [],
            "stream": true,
            "tool_choice": "none"
        });

        attach_tools(&mut request_body, Some(vec![]), "test");

        assert!(request_body.get("tools").is_none());
        assert!(request_body.get("tool_choice").is_none());
    }

    #[test]
    fn attach_tools_preserves_explicit_tool_choice_with_tools() {
        let mut request_body = json!({
            "model": "test-model",
            "messages": [],
            "stream": true,
            "tool_choice": "none"
        });

        attach_tools(
            &mut request_body,
            Some(vec![json!({
                "type": "function",
                "function": {
                    "name": "example",
                    "description": "Example tool",
                    "parameters": { "type": "object" }
                }
            })]),
            "test",
        );

        assert_eq!(request_body["tool_choice"], json!("none"));
        assert_eq!(
            request_body["tools"][0]["function"]["name"],
            json!("example")
        );
    }
}
