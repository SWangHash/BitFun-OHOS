//! Atomic external MCP snapshot import into the existing user configuration.

use super::service::MCPConfigService;
use crate::mcp::{MCPRuntimeError, MCPRuntimeResult};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fmt;

const USER_CONFIG_KEY: &str = "mcp_servers";
const PROJECT_CONFIG_KEY: &str = "project.mcp_servers";
const IMPORT_METADATA_KEY: &str = "_openbitfunImport";
const MAX_IMPORT_SERVERS: usize = 256;
const MAX_IMPORT_ID_BYTES: usize = 512;
const MAX_IMPORT_TEXT_BYTES: usize = 4096;
const USER_MUTATION_ATTEMPTS: usize = 3;

#[derive(Clone, PartialEq, Eq)]
pub enum MCPImportTransport {
    Local { command: String, args: Vec<String> },
    Remote { url: String },
}

impl fmt::Debug for MCPImportTransport {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Local { args, .. } => formatter
                .debug_struct("Local")
                .field("command", &"[REDACTED]")
                .field("argument_count", &args.len())
                .finish(),
            Self::Remote { .. } => formatter
                .debug_struct("Remote")
                .field("url", &"[REDACTED]")
                .finish(),
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct MCPImportServer {
    pub native_id: String,
    pub candidate_id: String,
    pub behavior_version: String,
    pub display_name: String,
    pub transport: MCPImportTransport,
}

impl fmt::Debug for MCPImportServer {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MCPImportServer")
            .field("native_id", &self.native_id)
            .field("candidate_id", &self.candidate_id)
            .field("behavior_version", &self.behavior_version)
            .field("display_name", &self.display_name)
            .field("transport", &self.transport)
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MCPImportedServerSummary {
    pub native_id: String,
    pub candidate_id: String,
    pub behavior_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MCPUserImportSnapshot {
    pub fingerprint: String,
    pub native_ids: BTreeSet<String>,
    pub imports: Vec<MCPImportedServerSummary>,
}

pub struct MCPUserJsonConfigSnapshot {
    pub json_config: String,
    pub fingerprint: String,
}

#[derive(Debug)]
pub enum MCPImportError {
    InvalidRequest(&'static str),
    UnsupportedTargetFormat,
    StaleConfiguration,
    TargetConflict { native_id: String },
    Store(MCPRuntimeError),
}

impl fmt::Display for MCPImportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRequest(label) => write!(formatter, "Invalid MCP import {label}"),
            Self::UnsupportedTargetFormat => {
                formatter.write_str("User MCP configuration is not an object")
            }
            Self::StaleConfiguration => {
                formatter.write_str("User MCP configuration changed before write")
            }
            Self::TargetConflict { native_id } => {
                write!(formatter, "MCP server id already exists: {native_id}")
            }
            Self::Store(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for MCPImportError {}

impl From<MCPRuntimeError> for MCPImportError {
    fn from(error: MCPRuntimeError) -> Self {
        Self::Store(error)
    }
}

impl MCPConfigService {
    pub async fn user_json_config_snapshot(
        &self,
    ) -> Result<MCPUserJsonConfigSnapshot, MCPImportError> {
        let user_value = self.config_store.get_config_value(USER_CONFIG_KEY).await?;
        let project_value = self.config_store.get_config_value(PROJECT_CONFIG_KEY).await?;

        let merged = merge_user_and_project_servers(user_value.as_ref(), project_value.as_ref());
        let json_config = super::format_mcp_json_config_value(Some(&merged)).map_err(|error| {
            MCPImportError::Store(MCPRuntimeError::configuration(error.to_string()))
        })?;

        let fingerprint = combined_fingerprint(&user_value, &project_value);

        Ok(MCPUserJsonConfigSnapshot {
            fingerprint,
            json_config,
        })
    }

    pub async fn replace_user_json_config(
        &self,
        expected_fingerprint: &str,
        replacement: Value,
    ) -> Result<(), MCPImportError> {
        validate_id(expected_fingerprint, "fingerprint")?;

        // Split the replacement by location: servers with location="project"
        // go to project.mcp_servers; everything else stays in mcp_servers.
        let (user_value, project_value) = split_by_location(&replacement);

        for _ in 0..USER_MUTATION_ATTEMPTS {
            let current_user = self.config_store.get_config_value(USER_CONFIG_KEY).await?;
            let current_project = self.config_store.get_config_value(PROJECT_CONFIG_KEY).await?;
            let current_fingerprint = combined_fingerprint(&current_user, &current_project);
            if current_fingerprint != expected_fingerprint {
                return Err(MCPImportError::StaleConfiguration);
            }
            if self
                .config_store
                .compare_and_set_config_value(USER_CONFIG_KEY, current_user, user_value.clone())
                .await?
            {
                // Only write project store when there are project servers.
                // Never clear it based on absence — duplicate JSON keys or
                // partial views could otherwise silently delete project data.
                // Stale project servers are surfaced in the merged JSON editor
                // view and can be removed explicitly by the user.
                if !project_value.is_null() {
                    self.config_store
                        .set_config_value(PROJECT_CONFIG_KEY, project_value.clone())
                        .await?;
                }
                return Ok(());
            }
            // CAS failed due to a concurrent write between our read and CAS;
            // re-read and retry up to USER_MUTATION_ATTEMPTS times.
        }
        Err(MCPImportError::StaleConfiguration)
    }

    pub async fn user_import_snapshot(&self) -> Result<MCPUserImportSnapshot, MCPImportError> {
        let current = self.config_store.get_config_value(USER_CONFIG_KEY).await?;
        let servers = cursor_servers(&current)?;
        let mut imports = servers
            .iter()
            .filter_map(|(native_id, server)| import_summary(native_id, server))
            .collect::<Vec<_>>();
        imports.sort_by(|left, right| left.native_id.cmp(&right.native_id));
        Ok(MCPUserImportSnapshot {
            fingerprint: config_fingerprint(&current),
            native_ids: servers.keys().cloned().collect(),
            imports,
        })
    }

    pub async fn apply_user_import(
        &self,
        expected_fingerprint: &str,
        imports: Vec<MCPImportServer>,
    ) -> Result<(), MCPImportError> {
        validate_id(expected_fingerprint, "fingerprint")?;
        if imports.is_empty() || imports.len() > MAX_IMPORT_SERVERS {
            return Err(MCPImportError::InvalidRequest("server count"));
        }
        let mut native_ids = BTreeSet::new();
        let mut candidate_ids = BTreeSet::new();
        for import in &imports {
            import.validate()?;
            if !native_ids.insert(import.native_id.as_str())
                || !candidate_ids.insert(import.candidate_id.as_str())
            {
                return Err(MCPImportError::InvalidRequest("server identity"));
            }
        }

        let current = self.config_store.get_config_value(USER_CONFIG_KEY).await?;
        if config_fingerprint(&current) != expected_fingerprint {
            return Err(MCPImportError::StaleConfiguration);
        }
        let mut replacement = cursor_root(&current)?;
        let servers = replacement
            .get_mut("mcpServers")
            .and_then(Value::as_object_mut)
            .expect("cursor_root always creates an MCP object");
        for import in &imports {
            if servers.contains_key(&import.native_id) {
                return Err(MCPImportError::TargetConflict {
                    native_id: import.native_id.clone(),
                });
            }
        }
        for import in imports {
            servers.insert(import.native_id.clone(), imported_server_value(import));
        }
        if !self
            .config_store
            .compare_and_set_config_value(USER_CONFIG_KEY, current, replacement)
            .await?
        {
            return Err(MCPImportError::StaleConfiguration);
        }
        Ok(())
    }

    pub(super) async fn mutate_user_config(
        &self,
        mut mutate: impl FnMut(&mut Map<String, Value>) -> MCPRuntimeResult<()>,
    ) -> MCPRuntimeResult<()> {
        for _ in 0..USER_MUTATION_ATTEMPTS {
            let current = self.config_store.get_config_value(USER_CONFIG_KEY).await?;
            let mut replacement = cursor_root(&current)
                .map_err(|error| MCPRuntimeError::configuration(error.to_string()))?;
            let servers = replacement
                .get_mut("mcpServers")
                .and_then(Value::as_object_mut)
                .expect("cursor_root always creates an MCP object");
            mutate(servers)?;
            if self
                .config_store
                .compare_and_set_config_value(USER_CONFIG_KEY, current, replacement)
                .await?
            {
                return Ok(());
            }
        }
        Err(MCPRuntimeError::configuration(
            "User MCP configuration changed repeatedly during update",
        ))
    }

    pub(super) async fn mutate_project_config(
        &self,
        mut mutate: impl FnMut(&mut Map<String, Value>) -> MCPRuntimeResult<()>,
    ) -> MCPRuntimeResult<()> {
        for _ in 0..USER_MUTATION_ATTEMPTS {
            let current = self.config_store.get_config_value(PROJECT_CONFIG_KEY).await?;
            let mut replacement = cursor_root(&current)
                .map_err(|error| MCPRuntimeError::configuration(error.to_string()))?;
            let servers = replacement
                .get_mut("mcpServers")
                .and_then(Value::as_object_mut)
                .expect("cursor_root always creates an MCP object");
            mutate(servers)?;
            if self
                .config_store
                .compare_and_set_config_value(PROJECT_CONFIG_KEY, current, replacement)
                .await?
            {
                return Ok(());
            }
        }
        Err(MCPRuntimeError::configuration(
            "Project MCP configuration changed repeatedly during update",
        ))
    }
}

impl MCPImportServer {
    fn validate(&self) -> Result<(), MCPImportError> {
        validate_id(&self.native_id, "native id")?;
        validate_id(&self.candidate_id, "candidate id")?;
        validate_id(&self.behavior_version, "behavior version")?;
        validate_text(&self.display_name, "display name")?;
        match &self.transport {
            MCPImportTransport::Local { command, args } => {
                validate_text(command, "command")?;
                if args.len() > MAX_IMPORT_SERVERS {
                    return Err(MCPImportError::InvalidRequest("argument count"));
                }
                for argument in args {
                    validate_text(argument, "argument")?;
                }
            }
            MCPImportTransport::Remote { url } => {
                validate_text(url, "URL")?;
                let parsed =
                    url::Url::parse(url).map_err(|_| MCPImportError::InvalidRequest("URL"))?;
                if parsed.scheme() != "https"
                    || parsed.host_str().is_none()
                    || !parsed.username().is_empty()
                    || parsed.password().is_some()
                    || parsed.query().is_some()
                    || parsed.fragment().is_some()
                {
                    return Err(MCPImportError::InvalidRequest("URL"));
                }
            }
        }
        Ok(())
    }
}

fn validate_id(value: &str, label: &'static str) -> Result<(), MCPImportError> {
    if value.is_empty()
        || value.len() > MAX_IMPORT_ID_BYTES
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(MCPImportError::InvalidRequest(label));
    }
    Ok(())
}

fn validate_text(value: &str, label: &'static str) -> Result<(), MCPImportError> {
    if value.is_empty()
        || value.len() > MAX_IMPORT_TEXT_BYTES
        || value.chars().any(char::is_control)
    {
        return Err(MCPImportError::InvalidRequest(label));
    }
    Ok(())
}

fn cursor_root(current: &Option<Value>) -> Result<Value, MCPImportError> {
    match current {
        None | Some(Value::Null) => Ok(serde_json::json!({ "mcpServers": {} })),
        Some(Value::Object(root)) if root.get("mcpServers").is_some_and(Value::is_object) => {
            Ok(Value::Object(root.clone()))
        }
        _ => Err(MCPImportError::UnsupportedTargetFormat),
    }
}

fn cursor_servers(current: &Option<Value>) -> Result<Map<String, Value>, MCPImportError> {
    Ok(cursor_root(current)?
        .get("mcpServers")
        .and_then(Value::as_object)
        .cloned()
        .expect("cursor_root always creates an MCP object"))
}

fn imported_server_value(import: MCPImportServer) -> Value {
    let mut server = Map::new();
    match import.transport {
        MCPImportTransport::Local { command, args } => {
            server.insert("type".to_string(), Value::String("stdio".to_string()));
            server.insert("command".to_string(), Value::String(command));
            if !args.is_empty() {
                server.insert("args".to_string(), serde_json::json!(args));
            }
            server.insert("inheritParentEnvironment".to_string(), Value::Bool(false));
        }
        MCPImportTransport::Remote { url } => {
            server.insert(
                "type".to_string(),
                Value::String("streamable-http".to_string()),
            );
            server.insert("url".to_string(), Value::String(url));
        }
    }
    if import.display_name != import.native_id {
        server.insert("name".to_string(), Value::String(import.display_name));
    }
    server.insert("enabled".to_string(), Value::Bool(false));
    server.insert("autoStart".to_string(), Value::Bool(false));
    server.insert(
        IMPORT_METADATA_KEY.to_string(),
        serde_json::json!({
            "sourceCandidateId": import.candidate_id,
            "behaviorVersion": import.behavior_version,
        }),
    );
    Value::Object(server)
}

fn import_summary(native_id: &str, value: &Value) -> Option<MCPImportedServerSummary> {
    let metadata = value.get(IMPORT_METADATA_KEY)?.as_object()?;
    let candidate_id = metadata.get("sourceCandidateId")?.as_str()?;
    let behavior_version = metadata.get("behaviorVersion")?.as_str()?;
    validate_id(candidate_id, "candidate id").ok()?;
    validate_id(behavior_version, "behavior version").ok()?;
    Some(MCPImportedServerSummary {
        native_id: native_id.to_string(),
        candidate_id: candidate_id.to_string(),
        behavior_version: behavior_version.to_string(),
    })
}

fn config_fingerprint(value: &Option<Value>) -> String {
    let bytes = serde_json::to_vec(value).expect("JSON value serialization cannot fail");
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

/// Splits a Cursor-format config `{ "mcpServers": { ... } }` by `location`:
/// servers with `location: "project"` go to the project value, everything else
/// stays in the user value. Both returned values are Cursor-format.
fn split_by_location(replacement: &Value) -> (Value, Value) {
    let empty = || serde_json::json!({ "mcpServers": {} });
    let servers = match replacement.get("mcpServers").and_then(|v| v.as_object()) {
        Some(s) => s,
        None => return (replacement.clone(), Value::Null),
    };

    let mut user_servers = serde_json::Map::new();
    let mut project_servers = serde_json::Map::new();

    for (id, server) in servers {
        let is_project = server
            .get("location")
            .and_then(|v| v.as_str())
            .is_some_and(|s| s == "project");

        let mut server = server.clone();
        // Strip the location field — it is set automatically on load.
        if let Some(obj) = server.as_object_mut() {
            obj.remove("location");
        }

        if is_project {
            project_servers.insert(id.clone(), server);
        } else {
            user_servers.insert(id.clone(), server);
        }
    }

    let user_value = if user_servers.is_empty() {
        empty()
    } else {
        serde_json::json!({ "mcpServers": user_servers })
    };
    let project_value = if project_servers.is_empty() {
        Value::Null
    } else {
        serde_json::json!({ "mcpServers": project_servers })
    };

    (user_value, project_value)
}

/// Merges servers from the user store and project store into a single
/// Cursor-format JSON value. Each server gets a `location` field indicating
/// its source (`"user"` or `"project"`).
fn merge_user_and_project_servers(
    user_value: Option<&Value>,
    project_value: Option<&Value>,
) -> Value {
    let mut merged = serde_json::Map::new();

    if let Some(servers) = user_value.and_then(|v| v.get("mcpServers")).and_then(|v| v.as_object()) {
        for (id, server) in servers {
            let mut server = server.clone();
            if let Some(obj) = server.as_object_mut() {
                obj.insert("location".to_string(), Value::String("user".to_string()));
            }
            merged.insert(id.clone(), server);
        }
    }

    if let Some(servers) = project_value.and_then(|v| v.get("mcpServers")).and_then(|v| v.as_object()) {
        for (id, server) in servers {
            let mut server = server.clone();
            if let Some(obj) = server.as_object_mut() {
                obj.insert("location".to_string(), Value::String("project".to_string()));
            }
            merged.insert(id.clone(), server);
        }
    }

    serde_json::json!({ "mcpServers": merged })
}

/// Computes a fingerprint covering both the user and project config stores.
fn combined_fingerprint(user: &Option<Value>, project: &Option<Value>) -> String {
    let user_bytes = serde_json::to_vec(user).expect("JSON serialization cannot fail");
    let project_bytes = serde_json::to_vec(project).expect("JSON serialization cannot fail");
    let mut hasher = Sha256::new();
    hasher.update(&user_bytes);
    hasher.update(&project_bytes);
    format!("sha256:{}", hex::encode(hasher.finalize()))
}
