//! Skill Management API

use crate::api::app_state::RemoteWorkspace;
use crate::api::skill_market_downloader::install_skill_from_market;
use log::info;
use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::State;
use tokio::sync::RwLock;
use tokio::task::JoinSet;
use tokio::time::{timeout, Duration};

use crate::api::app_state::AppState;
use bitfun_core::agentic::tools::implementations::skills::mode_overrides::{
    clear_user_mode_skill_overrides, load_globally_disabled_user_skills,
    load_project_mode_skills_document_local, project_mode_skills_path_for_remote,
    save_project_mode_skills_document_local, set_disabled_mode_skills_in_document,
    set_global_user_skill_disabled, set_mode_skill_disabled_in_document, set_user_mode_skill_state,
};
use bitfun_core::agentic::tools::implementations::skills::{
    resolver::resolve_skill_default_enabled_for_mode, ModeSkillInfo, SkillData, SkillInfo,
    SkillLocation, SkillRegistry,
};
use bitfun_core::agentic::workspace::RemoteWorkspaceFs;
use bitfun_core::infrastructure::get_path_manager_arc;
use bitfun_core::service::config::agent_profile_project_store::{
    deserialize_project_agent_profiles_document, serialize_project_agent_profiles_document,
};
use bitfun_core::service::config::types::ProxyConfig;
use bitfun_core::service::remote_ssh::workspace_state::is_remote_path;
use bitfun_core::service::remote_ssh::{get_remote_workspace_manager, RemoteWorkspaceEntry};

const SKILLS_SEARCH_API_BASE: &str = "https://skills.sh";
const DEFAULT_MARKET_QUERY: &str = "skill";
const DEFAULT_MARKET_LIMIT: u32 = 12;
const MAX_MARKET_LIMIT: u32 = 500;
const MARKET_DESC_FETCH_TIMEOUT_SECS: u64 = 4;
const MARKET_DESC_FETCH_CONCURRENCY: usize = 12;
const MARKET_DESC_MAX_LEN: usize = 220;
const MARKET_DESC_FETCH_DEADLINE_SECS: u64 = 15;

static MARKET_DESCRIPTION_CACHE: OnceLock<RwLock<HashMap<String, String>>> = OnceLock::new();

/// Build a per-call HTTP client for the skill market listing/description
/// paths. Uses BitFun's configured `ProxyConfig` when enabled (read live so
/// changing the AI proxy takes effect without restart), falling back to the
/// standard HTTPS_PROXY/HTTP_PROXY/ALL_PROXY env vars (reqwest default), then
/// direct. No aggressive connect/overall timeout is set here: skills.sh is an
/// international domain and a slow-but-reachable direct connection can take
/// 8-20s; a tight connect_timeout would cut it off and turn "works" into
/// "timed out". The per-skill description fetch keeps its own per-page bound
/// in fetch_description_from_skill_page.
fn build_market_client(proxy: Option<&ProxyConfig>) -> Result<Client, String> {
    let mut builder = Client::builder()
        .user_agent(concat!("BitFun/", env!("CARGO_PKG_VERSION")));
    if let Some(proxy_url) = resolve_proxy_url(proxy) {
        match reqwest::Proxy::all(&proxy_url) {
            Ok(p) => builder = builder.proxy(p),
            Err(e) => log::warn!("Failed to apply skill market proxy: {}", e),
        }
    }
    builder
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

/// Resolve the proxy URL: BitFun's `ProxyConfig` if enabled, else startup env.
fn resolve_proxy_url(proxy: Option<&ProxyConfig>) -> Option<String> {
    if let Some(p) = proxy {
        if p.enabled {
            let url = p.url.trim();
            if !url.is_empty() {
                return Some(normalize_proxy_url(url));
            }
        }
    }
    read_startup_proxy_env()
}

/// Prefix `http://` to bare `host:port` proxy URLs (mirrors the AI adapter).
fn normalize_proxy_url(url: &str) -> String {
    if url.contains("://") {
        url.to_string()
    } else {
        format!("http://{}", url)
    }
}

/// Read a proxy URL from the standard env vars (HTTPS_PROXY / HTTP_PROXY /
/// ALL_PROXY, case-insensitive). Returns the first one set.
fn read_startup_proxy_env() -> Option<String> {
    for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"] {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn can_delete_owned_skill(source_id: &str, source_slot: &str, is_builtin: bool) -> bool {
    if is_builtin {
        return false;
    }

    let source_id = source_id.trim().to_ascii_lowercase();
    if !source_id.is_empty() {
        return matches!(
            source_id.as_str(),
            "bitfun" | "bitfun-system" | "matrix"
        );
    }

    let source_slot = source_slot.trim().to_ascii_lowercase();
    source_slot.starts_with("bitfun")
}

fn ensure_skill_can_be_deleted(skill: &SkillInfo) -> Result<(), String> {
    if can_delete_owned_skill(&skill.source_id, &skill.source_slot, skill.is_builtin) {
        Ok(())
    } else {
        Err("Only BitFun-owned, non-built-in Skills can be deleted from BitFun".to_string())
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SkillValidationResult {
    pub valid: bool,
    pub name: Option<String>,
    pub description: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMarketListRequest {
    pub query: Option<String>,
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMarketSearchRequest {
    pub query: String,
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMarketDownloadRequest {
    pub package: String,
    pub level: Option<SkillLocation>,
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMarketDownloadResponse {
    pub package: String,
    pub level: SkillLocation,
    pub installed_skills: Vec<String>,
    pub output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceModeSkillSelectionRequest {
    pub mode_id: String,
    pub enabled_skill_keys: Vec<String>,
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetModeSkillSelectionRequest {
    pub mode_id: String,
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetGlobalSkillDisabledRequest {
    pub skill_key: String,
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSkillSettingsResponse {
    pub globally_disabled_user_skill_keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMarketItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source: String,
    pub installs: u64,
    pub url: String,
    pub install_id: String,
}

#[derive(Debug, Clone, Deserialize)]
struct SkillSearchApiResponse {
    #[serde(default)]
    skills: Vec<SkillSearchApiItem>,
}

#[derive(Debug, Clone, Deserialize)]
struct SkillSearchApiItem {
    id: String,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    source: String,
    #[serde(default)]
    installs: u64,
}

fn workspace_root_from_input(workspace_path: Option<&str>) -> Option<PathBuf> {
    workspace_path
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
}

fn trim_workspace_path(workspace_path: Option<&str>) -> Option<String> {
    workspace_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(str::to_string)
}

async fn lookup_remote_entry_for_path(
    state: &State<'_, AppState>,
    path: &str,
) -> Option<RemoteWorkspaceEntry> {
    let manager = get_remote_workspace_manager()?;
    let preferred = state
        .get_remote_workspace_async()
        .await
        .map(|workspace: RemoteWorkspace| workspace.connection_id);
    manager.lookup_connection(path, preferred.as_deref()).await
}

async fn resolve_remote_workspace(
    state: &State<'_, AppState>,
    workspace_path: Option<&str>,
) -> Result<Option<(String, RemoteWorkspaceEntry)>, String> {
    let Some(path) = trim_workspace_path(workspace_path) else {
        return Ok(None);
    };

    if !is_remote_path(&path).await {
        return Ok(None);
    }

    let entry = lookup_remote_entry_for_path(state, &path)
        .await
        .ok_or_else(|| format!("Remote workspace connection not found for '{}'", path))?;
    Ok(Some((path, entry)))
}

async fn get_all_skills_for_workspace_input(
    state: &State<'_, AppState>,
    registry: &SkillRegistry,
    workspace_path: Option<&str>,
) -> Result<Vec<SkillInfo>, String> {
    if let Some((remote_root, entry)) = resolve_remote_workspace(state, workspace_path).await? {
        let remote_fs = state
            .get_remote_file_service_async()
            .await
            .map_err(|e| format!("Remote file service not available: {}", e))?;
        let remote_workspace_fs = RemoteWorkspaceFs::new(entry.connection_id, remote_fs);
        Ok(registry
            .get_all_skills_for_remote_workspace(&remote_workspace_fs, &remote_root)
            .await)
    } else {
        Ok(registry
            .get_all_skills_for_workspace(workspace_root_from_input(workspace_path).as_deref())
            .await)
    }
}

async fn get_mode_skill_infos_for_workspace_input(
    state: &State<'_, AppState>,
    registry: &SkillRegistry,
    mode_id: &str,
    workspace_path: Option<&str>,
) -> Result<Vec<ModeSkillInfo>, String> {
    if let Some((remote_root, entry)) = resolve_remote_workspace(state, workspace_path).await? {
        let remote_fs = state
            .get_remote_file_service_async()
            .await
            .map_err(|e| format!("Remote file service not available: {}", e))?;
        let remote_workspace_fs =
            RemoteWorkspaceFs::new(entry.connection_id.clone(), remote_fs.clone());
        Ok(registry
            .get_mode_skill_infos_for_remote_workspace(&remote_workspace_fs, &remote_root, mode_id)
            .await)
    } else if let Some(workspace_root) = workspace_root_from_input(workspace_path) {
        Ok(registry
            .get_mode_skill_infos_for_workspace(Some(&workspace_root), mode_id)
            .await)
    } else {
        // Mode-scoped built-in and user-level skills should still be available even
        // when no project workspace is open. In that case there are simply no
        // project-level overrides to apply.
        Ok(registry
            .get_mode_skill_infos_for_workspace(None, mode_id)
            .await)
    }
}

fn normalize_skill_key_list(keys: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();

    for key in keys {
        let trimmed = key.trim();
        if trimmed.is_empty() {
            continue;
        }

        let owned = trimmed.to_string();
        if seen.insert(owned.clone()) {
            normalized.push(owned);
        }
    }

    normalized
}

async fn persist_user_mode_skill_selection(
    mode_id: &str,
    all_skills: &[SkillInfo],
    enabled_keys: &HashSet<String>,
) -> Result<(), String> {
    let mut disabled_user_skills = Vec::new();
    let mut enabled_user_skills = Vec::new();

    for skill in all_skills
        .iter()
        .filter(|skill| skill.level == SkillLocation::User)
    {
        let should_enable = enabled_keys.contains(&skill.key);
        let default_enabled = resolve_skill_default_enabled_for_mode(skill, mode_id);

        if default_enabled && !should_enable {
            disabled_user_skills.push(skill.key.clone());
        } else if !default_enabled && should_enable {
            enabled_user_skills.push(skill.key.clone());
        }
    }

    bitfun_core::service::config::mode_config_canonicalizer::persist_agent_profile_from_value(
        mode_id,
        serde_json::json!({
            "disabled_user_skills": normalize_skill_key_list(disabled_user_skills),
            "enabled_user_skills": normalize_skill_key_list(enabled_user_skills),
        }),
    )
    .await
    .map_err(|e| format!("Failed to update user skill overrides: {}", e))
}

fn build_disabled_project_skill_keys(
    all_skills: &[SkillInfo],
    enabled_keys: &HashSet<String>,
) -> Vec<String> {
    all_skills
        .iter()
        .filter(|skill| skill.level == SkillLocation::Project)
        .filter(|skill| !enabled_keys.contains(&skill.key))
        .map(|skill| skill.key.clone())
        .collect()
}

async fn persist_project_mode_skill_selection_local(
    mode_id: &str,
    workspace_root: &Path,
    disabled_project_skills: Vec<String>,
) -> Result<(), String> {
    let mut document = load_project_mode_skills_document_local(workspace_root)
        .await
        .map_err(|e| format!("Failed to load project mode skills: {}", e))?;
    set_disabled_mode_skills_in_document(&mut document, mode_id, disabled_project_skills)
        .map_err(|e| format!("Failed to update project skill overrides: {}", e))?;
    save_project_mode_skills_document_local(workspace_root, &document)
        .await
        .map_err(|e| format!("Failed to save project mode skills: {}", e))
}

async fn persist_project_mode_skill_selection_remote(
    state: &State<'_, AppState>,
    remote_root: &str,
    entry: &RemoteWorkspaceEntry,
    mode_id: &str,
    disabled_project_skills: Vec<String>,
) -> Result<(), String> {
    let remote_fs = state
        .get_remote_file_service_async()
        .await
        .map_err(|e| format!("Remote file service not available: {}", e))?;
    let config_path = project_mode_skills_path_for_remote(remote_root);
    let mut document = if remote_fs
        .exists(&entry.connection_id, &config_path)
        .await
        .map_err(|e| format!("Failed to check remote project skill overrides: {}", e))?
    {
        let content = remote_fs
            .read_file(&entry.connection_id, &config_path)
            .await
            .map_err(|e| format!("Failed to read remote project skill overrides: {}", e))?;
        let content = String::from_utf8(content)
            .map_err(|e| format!("Remote project skill overrides are not valid UTF-8: {}", e))?;
        deserialize_project_agent_profiles_document(&content)
            .map_err(|e| format!("Invalid remote project skill overrides JSON: {}", e))?
    } else {
        Default::default()
    };

    set_disabled_mode_skills_in_document(&mut document, mode_id, disabled_project_skills)
        .map_err(|e| format!("Failed to update remote project skill overrides: {}", e))?;

    let config_dir = config_path
        .rsplit_once('/')
        .map(|(dir, _)| dir.to_string())
        .ok_or_else(|| format!("Invalid remote project config path '{}'", config_path))?;

    remote_fs
        .create_dir_all(&entry.connection_id, &config_dir)
        .await
        .map_err(|e| {
            format!(
                "Failed to create remote project skill overrides directory: {}",
                e
            )
        })?;
    remote_fs
        .write_file(
            &entry.connection_id,
            &config_path,
            serialize_project_agent_profiles_document(&document)
                .map_err(|e| format!("Failed to serialize remote project skill overrides: {}", e))?
                .as_slice(),
        )
        .await
        .map_err(|e| format!("Failed to write remote project skill overrides: {}", e))?;

    Ok(())
}

async fn clear_project_mode_skill_selection_local(
    mode_id: &str,
    workspace_root: &Path,
) -> Result<(), String> {
    let path = get_path_manager_arc().project_agent_profiles_file(workspace_root);
    let exists = tokio::fs::try_exists(&path)
        .await
        .map_err(|e| format!("Failed to check project mode skills file: {}", e))?;
    if !exists {
        return Ok(());
    }

    let mut document = load_project_mode_skills_document_local(workspace_root)
        .await
        .map_err(|e| format!("Failed to load project mode skills: {}", e))?;
    set_disabled_mode_skills_in_document(&mut document, mode_id, Vec::new())
        .map_err(|e| format!("Failed to clear project skill overrides: {}", e))?;

    let document_is_empty = document.is_empty();

    if document_is_empty {
        match tokio::fs::remove_file(&path).await {
            Ok(_) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!(
                "Failed to remove project mode skills file: {}",
                error
            )),
        }
    } else {
        save_project_mode_skills_document_local(workspace_root, &document)
            .await
            .map_err(|e| format!("Failed to save project mode skills: {}", e))
    }
}

async fn clear_project_mode_skill_selection_remote(
    state: &State<'_, AppState>,
    remote_root: &str,
    entry: &RemoteWorkspaceEntry,
    mode_id: &str,
) -> Result<(), String> {
    let remote_fs = state
        .get_remote_file_service_async()
        .await
        .map_err(|e| format!("Remote file service not available: {}", e))?;
    let config_path = project_mode_skills_path_for_remote(remote_root);
    let exists = remote_fs
        .exists(&entry.connection_id, &config_path)
        .await
        .map_err(|e| format!("Failed to check remote project skill overrides: {}", e))?;
    if !exists {
        return Ok(());
    }

    let content = remote_fs
        .read_file(&entry.connection_id, &config_path)
        .await
        .map_err(|e| format!("Failed to read remote project skill overrides: {}", e))?;
    let content = String::from_utf8(content)
        .map_err(|e| format!("Remote project skill overrides are not valid UTF-8: {}", e))?;
    let mut document = deserialize_project_agent_profiles_document(&content)
        .map_err(|e| format!("Invalid remote project skill overrides JSON: {}", e))?;

    set_disabled_mode_skills_in_document(&mut document, mode_id, Vec::new())
        .map_err(|e| format!("Failed to clear remote project skill overrides: {}", e))?;

    let document_is_empty = document.is_empty();

    if document_is_empty {
        remote_fs
            .remove_file(&entry.connection_id, &config_path)
            .await
            .map_err(|e| format!("Failed to remove remote project skill overrides: {}", e))?;
    } else {
        remote_fs
            .write_file(
                &entry.connection_id,
                &config_path,
                serialize_project_agent_profiles_document(&document)
                    .map_err(|e| {
                        format!("Failed to serialize remote project skill overrides: {}", e)
                    })?
                    .as_slice(),
            )
            .await
            .map_err(|e| format!("Failed to write remote project skill overrides: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn get_skill_configs(
    state: State<'_, AppState>,
    force_refresh: Option<bool>,
    workspace_path: Option<String>,
) -> Result<Value, String> {
    let registry = SkillRegistry::global();

    if force_refresh.unwrap_or(false) {
        registry.refresh().await;
    }

    let all_skills =
        get_all_skills_for_workspace_input(&state, registry, workspace_path.as_deref()).await?;

    serde_json::to_value(all_skills)
        .map_err(|e| format!("Failed to serialize skill configs: {}", e))
}

#[tauri::command]
pub async fn get_global_skill_settings() -> Result<GlobalSkillSettingsResponse, String> {
    let globally_disabled_user_skill_keys = load_globally_disabled_user_skills()
        .await
        .map_err(|error| format!("Failed to load global Skill settings: {}", error))?;
    Ok(GlobalSkillSettingsResponse {
        globally_disabled_user_skill_keys,
    })
}

#[tauri::command]
pub async fn set_global_skill_disabled(
    request: SetGlobalSkillDisabledRequest,
) -> Result<GlobalSkillSettingsResponse, String> {
    let skill_key = request.skill_key.trim();
    if !skill_key.starts_with("user::") {
        return Err("Global Skill availability only applies to user-level Skills".to_string());
    }

    let known_skill = SkillRegistry::global()
        .get_all_skills()
        .await
        .into_iter()
        .any(|skill| skill.key == skill_key && skill.level == SkillLocation::User);
    if !known_skill {
        return Err(format!("User-level Skill '{}' was not found", skill_key));
    }

    let globally_disabled_user_skill_keys =
        set_global_user_skill_disabled(skill_key, request.disabled)
            .await
            .map_err(|error| format!("Failed to update global Skill settings: {}", error))?;
    if let Err(error) = bitfun_core::service::config::reload_global_config().await {
        log::warn!(
            "Failed to reload global configuration after Skill availability update: skill_key={}, error={}",
            skill_key,
            error
        );
    }

    Ok(GlobalSkillSettingsResponse {
        globally_disabled_user_skill_keys,
    })
}

#[tauri::command]
pub async fn get_mode_skill_configs(
    state: State<'_, AppState>,
    mode_id: String,
    force_refresh: Option<bool>,
    workspace_path: Option<String>,
) -> Result<Value, String> {
    let registry = SkillRegistry::global();

    if force_refresh.unwrap_or(false) {
        registry.refresh().await;
    }

    let mode_skill_infos = get_mode_skill_infos_for_workspace_input(
        &state,
        registry,
        &mode_id,
        workspace_path.as_deref(),
    )
    .await?;

    serde_json::to_value(mode_skill_infos)
        .map_err(|e| format!("Failed to serialize mode skill configs: {}", e))
}

#[tauri::command]
pub async fn set_mode_skill_disabled(
    state: State<'_, AppState>,
    mode_id: String,
    skill_key: String,
    disabled: bool,
    workspace_path: Option<String>,
) -> Result<String, String> {
    if skill_key.starts_with("user::") {
        let registry = SkillRegistry::global();
        let skill_info = if let Some((remote_root, entry)) =
            resolve_remote_workspace(&state, workspace_path.as_deref()).await?
        {
            let remote_fs = state
                .get_remote_file_service_async()
                .await
                .map_err(|e| format!("Remote file service not available: {}", e))?;
            let remote_workspace_fs = RemoteWorkspaceFs::new(entry.connection_id, remote_fs);
            registry
                .find_skill_by_key_for_remote_workspace(
                    &remote_workspace_fs,
                    &remote_root,
                    &skill_key,
                )
                .await
        } else {
            registry
                .find_skill_by_key_for_workspace(
                    &skill_key,
                    workspace_root_from_input(workspace_path.as_deref()).as_deref(),
                )
                .await
        }
        .ok_or_else(|| format!("Skill '{}' not found", skill_key))?;

        let default_enabled = resolve_skill_default_enabled_for_mode(&skill_info, &mode_id);
        set_user_mode_skill_state(&mode_id, &skill_key, !disabled, default_enabled)
            .await
            .map_err(|e| format!("Failed to update user skill override: {}", e))?;
        if let Err(e) = bitfun_core::service::config::reload_global_config().await {
            log::warn!(
                "Failed to reload global config after user skill override change: mode_id={}, skill_key={}, error={}",
                mode_id,
                skill_key,
                e
            );
        }
        return Ok(format!(
            "Mode '{}' skill '{}' updated successfully",
            mode_id, skill_key
        ));
    }

    if !skill_key.starts_with("project::") {
        return Err(format!("Unsupported skill key '{}'", skill_key));
    }

    if let Some((remote_root, entry)) =
        resolve_remote_workspace(&state, workspace_path.as_deref()).await?
    {
        let remote_fs = state
            .get_remote_file_service_async()
            .await
            .map_err(|e| format!("Remote file service not available: {}", e))?;
        let config_path = project_mode_skills_path_for_remote(&remote_root);
        let mut document = if remote_fs
            .exists(&entry.connection_id, &config_path)
            .await
            .map_err(|e| format!("Failed to check remote project skill overrides: {}", e))?
        {
            let content = remote_fs
                .read_file(&entry.connection_id, &config_path)
                .await
                .map_err(|e| format!("Failed to read remote project skill overrides: {}", e))?;
            let content = String::from_utf8(content).map_err(|e| {
                format!("Remote project skill overrides are not valid UTF-8: {}", e)
            })?;
            deserialize_project_agent_profiles_document(&content)
                .map_err(|e| format!("Invalid remote project skill overrides JSON: {}", e))?
        } else {
            Default::default()
        };

        set_mode_skill_disabled_in_document(&mut document, &mode_id, &skill_key, disabled)
            .map_err(|e| format!("Failed to update remote project skill override: {}", e))?;

        let config_dir = config_path
            .rsplit_once('/')
            .map(|(dir, _)| dir.to_string())
            .ok_or_else(|| format!("Invalid remote project config path '{}'", config_path))?;

        remote_fs
            .create_dir_all(&entry.connection_id, &config_dir)
            .await
            .map_err(|e| {
                format!(
                    "Failed to create remote project skill overrides directory: {}",
                    e
                )
            })?;
        remote_fs
            .write_file(
                &entry.connection_id,
                &config_path,
                serialize_project_agent_profiles_document(&document)
                    .map_err(|e| {
                        format!("Failed to serialize remote project skill overrides: {}", e)
                    })?
                    .as_slice(),
            )
            .await
            .map_err(|e| format!("Failed to write remote project skill overrides: {}", e))?;
    } else {
        let workspace_root = workspace_root_from_input(workspace_path.as_deref())
            .ok_or_else(|| "Project-level skill overrides require an open workspace".to_string())?;
        let mut document = load_project_mode_skills_document_local(&workspace_root)
            .await
            .map_err(|e| format!("Failed to load project mode skills: {}", e))?;
        set_mode_skill_disabled_in_document(&mut document, &mode_id, &skill_key, disabled)
            .map_err(|e| format!("Failed to update project skill override: {}", e))?;
        save_project_mode_skills_document_local(&workspace_root, &document)
            .await
            .map_err(|e| format!("Failed to save project mode skills: {}", e))?;
    }

    Ok(format!(
        "Mode '{}' skill '{}' updated successfully",
        mode_id, skill_key
    ))
}

#[tauri::command]
pub async fn replace_mode_skill_selection(
    state: State<'_, AppState>,
    request: ReplaceModeSkillSelectionRequest,
) -> Result<String, String> {
    let registry = SkillRegistry::global();
    let all_skills =
        get_all_skills_for_workspace_input(&state, registry, request.workspace_path.as_deref())
            .await?;

    let enabled_skill_keys = normalize_skill_key_list(request.enabled_skill_keys);
    let enabled_keys: HashSet<String> = enabled_skill_keys.iter().cloned().collect();
    let known_keys: HashSet<String> = all_skills.iter().map(|skill| skill.key.clone()).collect();
    let unknown_keys: Vec<String> = enabled_skill_keys
        .iter()
        .filter(|key| !known_keys.contains(*key))
        .cloned()
        .collect();
    if !unknown_keys.is_empty() {
        return Err(format!(
            "Unknown skill keys for mode '{}': {}",
            request.mode_id,
            unknown_keys.join(", ")
        ));
    }

    persist_user_mode_skill_selection(&request.mode_id, &all_skills, &enabled_keys).await?;

    let disabled_project_skills = normalize_skill_key_list(build_disabled_project_skill_keys(
        &all_skills,
        &enabled_keys,
    ));

    if let Some((remote_root, entry)) =
        resolve_remote_workspace(&state, request.workspace_path.as_deref()).await?
    {
        persist_project_mode_skill_selection_remote(
            &state,
            &remote_root,
            &entry,
            &request.mode_id,
            disabled_project_skills,
        )
        .await?;
    } else if let Some(workspace_root) =
        workspace_root_from_input(request.workspace_path.as_deref())
    {
        persist_project_mode_skill_selection_local(
            &request.mode_id,
            &workspace_root,
            disabled_project_skills,
        )
        .await?;
    }

    if let Err(e) = bitfun_core::service::config::reload_global_config().await {
        log::warn!(
            "Failed to reload global config after batch skill update: mode_id={}, error={}",
            request.mode_id,
            e
        );
    }

    Ok(format!(
        "Mode '{}' skill selection updated successfully",
        request.mode_id
    ))
}

#[tauri::command]
pub async fn reset_mode_skill_selection(
    state: State<'_, AppState>,
    request: ResetModeSkillSelectionRequest,
) -> Result<String, String> {
    clear_user_mode_skill_overrides(&request.mode_id)
        .await
        .map_err(|e| format!("Failed to reset user skill overrides: {}", e))?;

    if let Some((remote_root, entry)) =
        resolve_remote_workspace(&state, request.workspace_path.as_deref()).await?
    {
        clear_project_mode_skill_selection_remote(&state, &remote_root, &entry, &request.mode_id)
            .await?;
    } else if let Some(workspace_root) =
        workspace_root_from_input(request.workspace_path.as_deref())
    {
        clear_project_mode_skill_selection_local(&request.mode_id, &workspace_root).await?;
    }

    if let Err(e) = bitfun_core::service::config::reload_global_config().await {
        log::warn!(
            "Failed to reload global config after resetting skill selection: mode_id={}, error={}",
            request.mode_id,
            e
        );
    }

    Ok(format!(
        "Mode '{}' skill selection reset successfully",
        request.mode_id
    ))
}

#[tauri::command]
pub async fn validate_skill_path(path: String) -> Result<SkillValidationResult, String> {
    use std::path::Path;

    let skill_path = Path::new(&path);

    if !skill_path.exists() {
        return Ok(SkillValidationResult {
            valid: false,
            name: None,
            description: None,
            error: Some("Path does not exist".to_string()),
        });
    }

    if !skill_path.is_dir() {
        return Ok(SkillValidationResult {
            valid: false,
            name: None,
            description: None,
            error: Some("Path is not a directory".to_string()),
        });
    }

    let skill_md_path = skill_path.join("SKILL.md");
    if !skill_md_path.exists() {
        return Ok(SkillValidationResult {
            valid: false,
            name: None,
            description: None,
            error: Some("Directory is missing SKILL.md file".to_string()),
        });
    }

    match tokio::fs::read_to_string(&skill_md_path).await {
        Ok(content) => {
            match SkillData::from_markdown(path.clone(), &content, SkillLocation::User, false) {
                Ok(data) => Ok(SkillValidationResult {
                    valid: true,
                    name: Some(data.name),
                    description: Some(data.description),
                    error: None,
                }),
                Err(e) => Ok(SkillValidationResult {
                    valid: false,
                    name: None,
                    description: None,
                    error: Some(e.to_string()),
                }),
            }
        }
        Err(e) => Ok(SkillValidationResult {
            valid: false,
            name: None,
            description: None,
            error: Some(format!("Failed to read SKILL.md: {}", e)),
        }),
    }
}

#[tauri::command]
pub async fn add_skill(
    _state: State<'_, AppState>,
    source_path: String,
    level: String,
    workspace_path: Option<String>,
) -> Result<String, String> {
    let validation = validate_skill_path(source_path.clone()).await?;
    if !validation.valid {
        return Err(validation.error.unwrap_or("Invalid skill path".to_string()));
    }

    let skill_name = validation
        .name
        .as_ref()
        .ok_or_else(|| "Skill name missing after validation".to_string())?;
    let source = Path::new(&source_path);

    let target_dir = if level == "project" {
        if let Some(workspace_root) = workspace_root_from_input(workspace_path.as_deref()) {
            if is_remote_path(&workspace_root.to_string_lossy()).await {
                return Err(
                    "Installing project skills into remote workspaces is not supported yet"
                        .to_string(),
                );
            }
            workspace_root.join(".bitfun").join("skills")
        } else {
            return Err("No workspace open, cannot add project-level Skill".to_string());
        }
    } else {
        get_path_manager_arc().user_skills_dir()
    };

    if let Err(e) = tokio::fs::create_dir_all(&target_dir).await {
        return Err(format!("Failed to create skills directory: {}", e));
    }

    let folder_name = source
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Unable to get folder name")?;

    let target_path = target_dir.join(folder_name);

    if target_path.exists() {
        return Err(format!(
            "Skill '{}' already exists in {} level directory",
            folder_name,
            if level == "project" {
                "project"
            } else {
                "user"
            }
        ));
    }

    if let Err(e) = copy_dir_all(source, &target_path).await {
        return Err(format!("Failed to copy skill folder: {}", e));
    }

    SkillRegistry::global()
        .refresh_for_workspace(workspace_root_from_input(workspace_path.as_deref()).as_deref())
        .await;

    info!(
        "Skill added: name={}, level={}, path={}",
        skill_name,
        level,
        target_path.display()
    );
    Ok(format!("Skill '{}' added successfully", skill_name))
}

async fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    tokio::fs::create_dir_all(dst).await?;

    let mut entries = tokio::fs::read_dir(src).await?;
    while let Some(entry) = entries.next_entry().await? {
        let ty = entry.file_type().await?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if ty.is_dir() {
            Box::pin(copy_dir_all(&src_path, &dst_path)).await?;
        } else {
            tokio::fs::copy(&src_path, &dst_path).await?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_skill(
    state: State<'_, AppState>,
    skill_key: String,
    workspace_path: Option<String>,
) -> Result<String, String> {
    let registry = SkillRegistry::global();
    if let Some((remote_root, entry)) =
        resolve_remote_workspace(&state, workspace_path.as_deref()).await?
    {
        let remote_fs = state
            .get_remote_file_service_async()
            .await
            .map_err(|e| format!("Remote file service not available: {}", e))?;
        let remote_workspace_fs =
            RemoteWorkspaceFs::new(entry.connection_id.clone(), remote_fs.clone());
        let skill_info = registry
            .find_skill_by_key_for_remote_workspace(&remote_workspace_fs, &remote_root, &skill_key)
            .await
            .ok_or_else(|| format!("Skill '{}' not found", skill_key))?;
        ensure_skill_can_be_deleted(&skill_info)?;

        match skill_info.level {
            SkillLocation::Project => {
                remote_fs
                    .remove_dir_all(&entry.connection_id, &skill_info.path)
                    .await
                    .map_err(|e| format!("Failed to delete remote skill folder: {}", e))?;
                info!(
                    "Remote project skill deleted: key={}, path={}",
                    skill_key, skill_info.path
                );
            }
            SkillLocation::User => {
                let skill_path = std::path::PathBuf::from(&skill_info.path);
                if skill_path.exists() {
                    tokio::fs::remove_dir_all(&skill_path)
                        .await
                        .map_err(|e| format!("Failed to delete local skill folder: {}", e))?;
                }
                info!(
                    "Local user skill deleted in remote workspace context: key={}, path={}",
                    skill_key,
                    skill_path.display()
                );
            }
        }

        registry.refresh().await;

        return Ok(format!("Skill '{}' deleted successfully", skill_info.name));
    }

    let workspace_root = workspace_root_from_input(workspace_path.as_deref());
    let skill_info = registry
        .find_skill_by_key_for_workspace(&skill_key, workspace_root.as_deref())
        .await
        .ok_or_else(|| format!("Skill '{}' not found", skill_key))?;
    ensure_skill_can_be_deleted(&skill_info)?;

    let skill_path = std::path::PathBuf::from(&skill_info.path);

    if skill_path.exists() {
        if let Err(e) = tokio::fs::remove_dir_all(&skill_path).await {
            return Err(format!("Failed to delete skill folder: {}", e));
        }
    }

    registry
        .refresh_for_workspace(workspace_root.as_deref())
        .await;

    info!(
        "Skill deleted: key={}, path={}",
        skill_key,
        skill_path.display()
    );
    Ok(format!("Skill '{}' deleted successfully", skill_info.name))
}

#[cfg(test)]
mod skill_delete_policy_tests {
    use super::can_delete_owned_skill;

    #[test]
    fn only_bitfun_owned_non_builtin_skills_are_deletable() {
        assert!(can_delete_owned_skill("bitfun", "bitfun", false));
        assert!(can_delete_owned_skill("", "bitfun", false));
        assert!(can_delete_owned_skill(
            "bitfun-system",
            "bitfun-system",
            false
        ));
        assert!(can_delete_owned_skill("matrix", "bitfun", false));
        assert!(!can_delete_owned_skill(
            "bitfun-system",
            "bitfun-system",
            true
        ));
        assert!(!can_delete_owned_skill("opencode", "home.opencode", false));
        assert!(!can_delete_owned_skill("codex", "home.codex", false));
        assert!(!can_delete_owned_skill("future-ecosystem", "future", false));
        assert!(!can_delete_owned_skill("", "future", false));
        assert!(!can_delete_owned_skill("", "", false));
    }
}

#[tauri::command]
pub async fn list_skill_market(
    state: State<'_, AppState>,
    request: SkillMarketListRequest,
) -> Result<Vec<SkillMarketItem>, String> {
    let query = request
        .query
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(DEFAULT_MARKET_QUERY);
    let limit = normalize_market_limit(request.limit);
    let offset = normalize_market_offset(request.offset);
    let proxy = configured_proxy_for_skills(&state).await?;
    fetch_skill_market(query, limit, offset, proxy.as_ref()).await
}

#[tauri::command]
pub async fn search_skill_market(
    state: State<'_, AppState>,
    request: SkillMarketSearchRequest,
) -> Result<Vec<SkillMarketItem>, String> {
    let query = request.query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let limit = normalize_market_limit(request.limit);
    let offset = normalize_market_offset(request.offset);
    let proxy = configured_proxy_for_skills(&state).await?;
    fetch_skill_market(query, limit, offset, proxy.as_ref()).await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDescriptionRequest {
    pub ids: Vec<String>,
}

/// Lazily fetch skill descriptions for a set of skill ids. The listing path no
/// longer blocks on description scraping; the frontend calls this after the
/// list renders so the marketplace appears immediately and descriptions fill
/// in progressively. Returns whatever could be fetched (including from the
/// process-level cache) when the overall deadline elapses.
#[tauri::command]
pub async fn get_skill_descriptions(
    state: State<'_, AppState>,
    request: SkillDescriptionRequest,
) -> Result<HashMap<String, String>, String> {
    if request.ids.is_empty() {
        return Ok(HashMap::new());
    }

    let api_base =
        std::env::var("SKILLS_API_URL").unwrap_or_else(|_| SKILLS_SEARCH_API_BASE.into());
    let base_url = api_base.trim_end_matches('/').to_string();
    let proxy = configured_proxy_for_skills(&state).await?;

    let fetched = timeout(
        Duration::from_secs(MARKET_DESC_FETCH_DEADLINE_SECS),
        fetch_descriptions_for_ids(&request.ids, &base_url, proxy.as_ref()),
    )
    .await;
    Ok(fetched.unwrap_or_default())
}

#[tauri::command]
pub async fn download_skill_market(
    state: State<'_, AppState>,
    request: SkillMarketDownloadRequest,
) -> Result<SkillMarketDownloadResponse, String> {
    let package = request.package.trim().to_string();
    if package.is_empty() {
        return Err("Skill package cannot be empty".to_string());
    }

    let level = request.level.unwrap_or(SkillLocation::Project);
    let workspace_path = if level == SkillLocation::Project {
        let path = trim_workspace_path(request.workspace_path.as_deref())
            .ok_or_else(|| "No workspace open, cannot add project-level Skill".to_string())?;
        if is_remote_path(&path).await {
            return Err(
                "Downloading project skills into remote workspaces is not supported yet"
                    .to_string(),
            );
        }
        Some(PathBuf::from(path))
    } else {
        None
    };

    let registry = SkillRegistry::global();
    let before_names: HashSet<String> = registry
        .get_all_skills_for_workspace(workspace_path.as_deref())
        .await
        .into_iter()
        .map(|skill| skill.name)
        .collect();

    let proxy = configured_proxy_for_skills(&state).await?;
    let outcome = install_skill_from_market(
        &package,
        level,
        workspace_path.as_deref(),
        proxy.as_ref(),
    )
    .await?;
    let install_summary = format!(
        "Installed skill '{}' to {}",
        package,
        outcome.target_dir.display()
    );

    registry
        .refresh_for_workspace(workspace_path.as_deref())
        .await;
    let mut installed_skills: Vec<String> = registry
        .get_all_skills_for_workspace(workspace_path.as_deref())
        .await
        .into_iter()
        .map(|skill| skill.name)
        .filter(|name| !before_names.contains(name))
        .collect();
    installed_skills.sort();
    installed_skills.dedup();

    info!(
        "Skill market download completed: package={}, level={}, installed_count={}",
        package,
        level.as_str(),
        installed_skills.len()
    );

    Ok(SkillMarketDownloadResponse {
        package,
        level,
        installed_skills,
        output: install_summary,
    })
}

/// Read the BitFun AI proxy config (`global_config.ai.proxy`) for use by the
/// native skill downloader. Mirrors `commands.rs::configured_ai_proxy` inline
/// to keep the skill market download path self-contained; the duplication is a
/// known follow-up cleanup (extract to a shared `api::proxy` module).
async fn configured_proxy_for_skills(
    state: &State<'_, AppState>,
) -> Result<Option<ProxyConfig>, String> {
    let global_config: bitfun_core::service::config::GlobalConfig = state
        .config_service
        .get_config(None)
        .await
        .map_err(|e| format!("Failed to get configuration: {}", e))?;
    Ok(global_config.ai.proxy.enabled.then_some(global_config.ai.proxy))
}

fn normalize_market_limit(value: Option<u32>) -> u32 {
    value
        .unwrap_or(DEFAULT_MARKET_LIMIT)
        .clamp(1, MAX_MARKET_LIMIT)
}

fn normalize_market_offset(value: Option<u32>) -> u32 {
    value.unwrap_or(0)
}

async fn fetch_skill_market(
    query: &str,
    limit: u32,
    offset: u32,
    proxy: Option<&ProxyConfig>,
) -> Result<Vec<SkillMarketItem>, String> {
    let api_base =
        std::env::var("SKILLS_API_URL").unwrap_or_else(|_| SKILLS_SEARCH_API_BASE.into());
    let base_url = api_base.trim_end_matches('/');
    let endpoint = format!("{}/api/search", base_url);

    // Over-fetch by `offset` so we can slice the requested page out of the
    // prefix without depending on whether skills.sh's legacy /api/search
    // honors an `offset`/`page` parameter. The legacy endpoint does not
    // document one, so requesting `limit + offset` and slicing locally is the
    // safe, correct fallback.
    let fetch_limit = offset
        .saturating_add(limit)
        .min(MAX_MARKET_LIMIT);

    let client = build_market_client(proxy)?;
    let response = client
        .get(&endpoint)
        .query(&[("q", query), ("limit", &fetch_limit.to_string())])
        .send()
        .await
        .map_err(|e| format!("Failed to query skill market: {}", e))?;

    if !response.status().is_success() {
        if response.status().is_client_error() {
            return Ok(Vec::new());
        }
        return Err(format!(
            "Skill market request failed with status {}",
            response.status()
        ));
    }

    let payload: SkillSearchApiResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to decode skill market response: {}", e))?;

    let mut seen_install_ids: HashSet<String> = HashSet::new();
    let mut items = Vec::new();

    for raw in payload.skills {
        let source = raw.source.trim().to_string();
        let install_id = if source.is_empty() {
            if raw.id.contains('@') {
                raw.id.clone()
            } else {
                format!("{}@{}", raw.id, raw.name)
            }
        } else {
            format!("{}@{}", source, raw.name)
        };

        if !seen_install_ids.insert(install_id.clone()) {
            continue;
        }

        items.push(SkillMarketItem {
            id: raw.id.clone(),
            name: raw.name,
            description: raw.description,
            source,
            installs: raw.installs,
            url: format!("{}/{}", base_url, raw.id.trim_start_matches('/')),
            install_id,
        });
    }

    // Slice the requested page.
    let start = (offset as usize).min(items.len());
    let end = (start.saturating_add(limit as usize)).min(items.len());
    let mut page: Vec<SkillMarketItem> = items.into_iter().skip(start).take(end - start).collect();

    // Block on description fill so cards appear WITH their descriptions (no
    // title-only placeholders that pop in later). skills.sh's legacy search has
    // no description field and its v1 API needs Vercel OIDC auth, so per-skill
    // HTML scrape is the only no-auth source — this is the unavoidable
    // ~few-second cost of a cold page (the process cache speeds up repeat
    // views of the same skills). Each per-skill fetch is bounded by
    // MARKET_DESC_FETCH_TIMEOUT_SECS, so this cannot hang indefinitely.
    if !page.is_empty() {
        let ids: Vec<String> = page.iter().map(|i| i.id.clone()).collect();
        let descs = fetch_descriptions_for_ids(&ids, base_url, proxy).await;
        for item in page.iter_mut() {
            if item.description.trim().is_empty() {
                if let Some(desc) = descs.get(&item.id) {
                    item.description = desc.clone();
                }
            }
        }
    }

    Ok(page)
}

fn market_description_cache() -> &'static RwLock<HashMap<String, String>> {
    MARKET_DESCRIPTION_CACHE.get_or_init(|| RwLock::new(HashMap::new()))
}

async fn fetch_descriptions_for_ids(
    ids: &[String],
    base_url: &str,
    proxy: Option<&ProxyConfig>,
) -> HashMap<String, String> {
    let cache = market_description_cache();
    let mut result: HashMap<String, String> = HashMap::new();

    // 1. Serve whatever is already in the process-level cache.
    {
        let reader = cache.read().await;
        for id in ids {
            if let Some(cached) = reader.get(id) {
                result.insert(id.clone(), cached.clone());
            }
        }
    }

    let missing: Vec<String> = ids
        .iter()
        .filter(|id| !result.contains_key(*id))
        .cloned()
        .collect();

    if missing.is_empty() {
        return result;
    }

    // 2. Concurrent HTML scrape for uncached ids. Concurrency and per-page
    //    timeout are bounded by MARKET_DESC_FETCH_CONCURRENCY and
    //    MARKET_DESC_FETCH_TIMEOUT_SECS respectively; the caller also wraps
    //    the whole call in an overall deadline.
    let client = build_market_client(proxy).unwrap_or_else(|_| Client::new());
    let mut join_set = JoinSet::new();
    let mut fetched = HashMap::new();

    for skill_id in missing {
        let client_clone = client.clone();
        let page_url = format!("{}/{}", base_url, skill_id.trim_start_matches('/'));

        join_set.spawn(async move {
            let description = fetch_description_from_skill_page(&client_clone, &page_url).await;
            (skill_id, description)
        });

        if join_set.len() >= MARKET_DESC_FETCH_CONCURRENCY {
            if let Some(Ok((skill_id, Some(desc)))) = join_set.join_next().await {
                fetched.insert(skill_id, desc);
            }
        }
    }

    while let Some(result_entry) = join_set.join_next().await {
        if let Ok((skill_id, Some(desc))) = result_entry {
            fetched.insert(skill_id, desc);
        }
    }

    // 3. Write back to cache and merge into the result map.
    if !fetched.is_empty() {
        let mut writer = cache.write().await;
        for (skill_id, desc) in &fetched {
            writer.insert(skill_id.clone(), desc.clone());
        }
    }
    for (id, desc) in fetched {
        result.insert(id, desc);
    }

    result
}

async fn fetch_description_from_skill_page(client: &Client, page_url: &str) -> Option<String> {
    let response = timeout(
        Duration::from_secs(MARKET_DESC_FETCH_TIMEOUT_SECS),
        client.get(page_url).send(),
    )
    .await
    .ok()?
    .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let html = timeout(
        Duration::from_secs(MARKET_DESC_FETCH_TIMEOUT_SECS),
        response.text(),
    )
    .await
    .ok()?
    .ok()?;

    extract_description_from_html(&html)
}

fn extract_description_from_html(html: &str) -> Option<String> {
    if let Some(prose_index) = html.find("class=\"prose") {
        let scope = &html[prose_index..];
        if let Some(p_start) = scope.find("<p>") {
            let content = &scope[p_start + 3..];
            if let Some(p_end) = content.find("</p>") {
                let raw = &content[..p_end];
                let normalized = normalize_html_text(raw);
                if !normalized.is_empty() {
                    return Some(limit_text_len(&normalized, MARKET_DESC_MAX_LEN));
                }
            }
        }
    }

    if let Some(twitter_desc) = extract_meta_content(html, "twitter:description") {
        let normalized = normalize_html_text(&twitter_desc);
        if is_meaningful_meta_description(&normalized) {
            return Some(limit_text_len(&normalized, MARKET_DESC_MAX_LEN));
        }
    }

    None
}

fn extract_meta_content(html: &str, key: &str) -> Option<String> {
    let pattern = format!(r#"<meta name="{}" content="([^"]+)""#, regex::escape(key));
    let re = Regex::new(&pattern).ok()?;
    let caps = re.captures(html)?;
    Some(caps.get(1)?.as_str().to_string())
}

fn normalize_html_text(raw: &str) -> String {
    let without_tags = if let Ok(re) = Regex::new(r"<[^>]+>") {
        re.replace_all(raw, " ").into_owned()
    } else {
        raw.to_string()
    };

    without_tags
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn is_meaningful_meta_description(text: &str) -> bool {
    let lower = text.to_lowercase();
    if lower.is_empty() {
        return false;
    }

    if lower == "discover and install skills for ai agents." {
        return false;
    }

    !lower.starts_with("install the ")
}

fn limit_text_len(text: &str, max_len: usize) -> String {
    if text.chars().count() <= max_len {
        return text.to_string();
    }

    let mut truncated: String = text.chars().take(max_len).collect();
    truncated.push_str("...");
    truncated
}
