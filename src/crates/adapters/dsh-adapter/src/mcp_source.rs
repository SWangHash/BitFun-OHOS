//! Reuse explicit DSH MCP declarations without evaluating Cordis or selecting a
//! native profile. Each file is an independent source; patches requiring another
//! layer remain unsupported rather than silently producing a partial server.
use openbitfun_product_domains::external_sources::*;
use openbitfun_static_hook_support::{
    read_bounded_text, redacted_executable_preview, resolve_bounded_regular_file, BoundedTextRead,
};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

const PROVIDER: &str = "deepseek-harness.mcp";
const ECOSYSTEM: &str = "deepseek-harness";
const MAX_BYTES: usize = 1024 * 1024;
const MAX_FILES: usize = 128;
const MAX_SERVERS: usize = 256;
const DEFAULT_CALL_TIMEOUT: u64 = 60_000;

#[derive(Clone, Debug)]
pub struct DshMcpProviderOptions {
    pub dsh_home: PathBuf,
}

impl Default for DshMcpProviderOptions {
    fn default() -> Self {
        Self {
            dsh_home: crate::DshHookProviderOptions::default().dsh_home,
        }
    }
}

#[derive(Default)]
pub struct DshMcpProvider {
    options: DshMcpProviderOptions,
}

struct SourceFile {
    path: PathBuf,
    root: PathBuf,
    scope: ExternalSourceScope,
}

struct Materialized {
    snapshot: ExternalMcpProviderSnapshot,
    transports: BTreeMap<String, PreparedExternalMcpTransport>,
}

#[derive(Clone)]
struct Declaration {
    identity: String,
    config: Value,
    disabled: bool,
    unsupported: Option<String>,
}

impl DshMcpProvider {
    pub fn new(options: DshMcpProviderOptions) -> Self {
        Self { options }
    }

    fn files(
        &self,
        context: &ExternalSourceContext,
    ) -> Result<Vec<SourceFile>, ExternalSourceProviderError> {
        let mut files = Vec::new();
        let mut add = |root: &Path, scope| {
            for name in ["cordis.yml", "cordis.patch.yml"] {
                files.push(SourceFile {
                    path: root.join(name),
                    root: root.to_path_buf(),
                    scope,
                });
            }
        };
        add(&self.options.dsh_home, ExternalSourceScope::UserGlobal);
        let profiles = self.options.dsh_home.join("profiles");
        match std::fs::read_dir(&profiles) {
            Ok(entries) => {
                let mut paths = Vec::new();
                for (index, entry) in entries.enumerate() {
                    if index >= MAX_FILES {
                        return Err(error(
                            "source_limit",
                            "DSH MCP profile directory limit reached",
                            false,
                        ));
                    }
                    let entry = entry.map_err(|_| {
                        error("profiles_unreadable", "Could not list DSH profiles", true)
                    })?;
                    let kind = entry.file_type().map_err(|_| {
                        error(
                            "profiles_unreadable",
                            "Could not inspect DSH profiles",
                            true,
                        )
                    })?;
                    if kind.is_dir() && entry.file_name() != "node_modules" {
                        paths.push(entry.path());
                    }
                    if paths.len() > MAX_FILES / 2 - 2 {
                        return Err(error(
                            "source_limit",
                            "DSH MCP profile limit reached",
                            false,
                        ));
                    }
                }
                paths.sort();
                for path in paths {
                    add(&path, ExternalSourceScope::UserGlobal);
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => {
                return Err(error(
                    "profiles_unreadable",
                    "Could not list DSH profiles",
                    true,
                ))
            }
        }
        if let Some(workspace) = &context.workspace_root {
            add(workspace, ExternalSourceScope::Project);
        }
        Ok(files)
    }

    fn materialize(
        &self,
        input: &ExternalMcpDiscoveryInput,
        for_import: bool,
    ) -> Result<Materialized, ExternalSourceProviderError> {
        if !self.options.dsh_home.is_absolute()
            || input
                .context
                .workspace_root
                .as_ref()
                .is_some_and(|p| !p.is_absolute())
        {
            return Err(error(
                "path_invalid",
                "DSH home and workspace paths must be absolute",
                false,
            ));
        }
        let mut snapshot = ExternalMcpProviderSnapshot {
            provider: self.identity(),
            sources: vec![],
            servers: vec![],
            diagnostics: vec![],
        };
        let mut transports = BTreeMap::new();
        let mut seen = BTreeSet::new();
        for file in self.files(&input.context)? {
            match std::fs::symlink_metadata(&file.path) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => {
                    return Err(error(
                        "config_unreadable",
                        "Could not inspect DSH MCP configuration",
                        true,
                    ))
                }
                Ok(_) => {}
            }
            let path = resolve_bounded_regular_file(&file.path, &file.root).map_err(|_| {
                error(
                    "config_unreadable",
                    "DSH MCP source must resolve to a regular file inside its source root",
                    false,
                )
            })?;
            if !seen.insert(path.clone()) {
                continue;
            }
            let text = match read_bounded_text(&path, MAX_BYTES) {
                Ok(BoundedTextRead::Content(text)) => text,
                _ => {
                    return Err(error(
                        "config_unreadable",
                        "DSH MCP source must be readable UTF-8 within 1 MiB",
                        false,
                    ))
                }
            };
            let key = source_key(&path);
            let suppressed = input.suppressed_sources.contains(&key);
            let yaml: serde_yaml::Value = serde_yaml::from_str(&text)
                .map_err(|_| error("config_invalid", "DSH MCP source is not valid YAML", false))?;
            let mut declarations = Vec::new();
            let mut incomplete = false;
            collect_rows(
                &yaml,
                "",
                false,
                None,
                0,
                &mut 0,
                &mut declarations,
                &mut incomplete,
            )?;
            let mut diagnostics = vec![];
            if incomplete {
                diagnostics.push(diagnostic(&key, "composition_required", "DSH patches require profile composition; declarations in this source cannot be activated from a partial configuration"));
            }
            if !declarations.is_empty() {
                diagnostics.push(diagnostic(&key, "declaration_scope", "Explicit MCP declarations are reused independently in OpenBitFun; native DSH profile selection, bundle overlays and reconnect lifecycle are not imported"));
            }
            let mut identities = BTreeSet::new();
            let mut names = BTreeSet::new();
            let duplicate = declarations.iter().any(|d| {
                !identities.insert(d.identity.clone())
                    || d.config
                        .get("serverName")
                        .and_then(Value::as_str)
                        .is_some_and(|n| !names.insert(n.to_string()))
            });
            for mut declaration in declarations.into_iter().filter(|_| !suppressed) {
                if snapshot.servers.len() >= MAX_SERVERS {
                    return Err(error("server_limit", "DSH MCP server limit reached", false));
                }
                if incomplete || duplicate {
                    declaration.unsupported = Some("DSH patch composition or duplicate declarations must be resolved before this source can be used".into());
                }
                let (definition, transport) =
                    materialize_server(input, &key, declaration, for_import)?;
                transports.insert(definition.id.stable_key(), transport);
                snapshot.servers.push(definition);
            }
            snapshot.sources.push(ExternalSourceRecord {
                key: key.clone(),
                ecosystem_id: EcosystemId::new(ECOSYSTEM).expect("static id"),
                display_name: "DeepSeek Harness MCP declarations".into(),
                source_kind: "dsh_mcp_config".into(),
                scope: file.scope,
                location: path.to_string_lossy().into_owned(),
                execution_domain_id: input.context.execution_domain_id.clone(),
                health: if incomplete || duplicate {
                    ExternalSourceHealth::Degraded
                } else {
                    ExternalSourceHealth::Available
                },
                content_version: input
                    .revision_key
                    .opaque_revision("dsh.mcp.content.v1", [text.as_bytes()]),
                diagnostics: diagnostics.clone(),
            });
            snapshot.diagnostics.extend(diagnostics);
        }
        snapshot.validate().map_err(|_| {
            error(
                "snapshot_invalid",
                "DSH MCP catalog could not be validated",
                false,
            )
        })?;
        Ok(Materialized {
            snapshot,
            transports,
        })
    }

    fn current(
        &self,
        input: &ExternalMcpDiscoveryInput,
        id: &SourceQualifiedMcpServerId,
        version: &str,
        for_import: bool,
    ) -> Result<
        (ExternalMcpServerDefinition, PreparedExternalMcpTransport),
        ExternalSourceProviderError,
    > {
        if id.source.provider_id.as_str() != PROVIDER {
            return Err(error(
                "identity_mismatch",
                "MCP server is not owned by DSH",
                false,
            ));
        }
        let mut materialized = self.materialize(input, for_import)?;
        let definition = materialized
            .snapshot
            .servers
            .into_iter()
            .find(|d| &d.id == id)
            .ok_or_else(|| {
                error(
                    "stale_revision",
                    "DSH MCP declaration is no longer available",
                    true,
                )
            })?;
        if definition.behavior_version != version {
            return Err(error(
                "stale_revision",
                "DSH MCP declaration changed before preparation",
                true,
            ));
        }
        if (!for_import && !definition.source_enabled)
            || !matches!(
                definition.static_status,
                ExternalMcpStaticStatus::Ready | ExternalMcpStaticStatus::DisabledBySource
            )
        {
            return Err(error(
                "not_activatable",
                "DSH MCP declaration is disabled or unsupported",
                false,
            ));
        }
        let transport = materialized
            .transports
            .remove(&id.stable_key())
            .ok_or_else(|| {
                error(
                    "preparation_missing",
                    "DSH MCP preparation is unavailable",
                    false,
                )
            })?;
        Ok((definition, transport))
    }
}

impl ExternalMcpSourceProvider for DshMcpProvider {
    fn identity(&self) -> ExternalMcpProviderIdentity {
        ExternalMcpProviderIdentity::new(PROVIDER, ECOSYSTEM, "DeepSeek Harness")
            .expect("static id")
    }
    fn discover(
        &self,
        input: &ExternalMcpDiscoveryInput,
    ) -> Result<ExternalMcpProviderSnapshot, ExternalSourceProviderError> {
        self.materialize(input, false).map(|m| m.snapshot)
    }
    fn prepare_server(
        &self,
        input: &ExternalMcpDiscoveryInput,
        id: &SourceQualifiedMcpServerId,
        version: &str,
    ) -> Result<PreparedExternalMcpServer, ExternalSourceProviderError> {
        let (definition, transport) = self.current(input, id, version, false)?;
        Ok(PreparedExternalMcpServer {
            id: id.clone(),
            behavior_version: version.into(),
            timeouts: definition.timeouts,
            transport,
        })
    }
    fn prepare_import(
        &self,
        input: &ExternalMcpDiscoveryInput,
        id: &SourceQualifiedMcpServerId,
        version: &str,
    ) -> Result<PreparedExternalMcpImportServer, ExternalSourceProviderError> {
        let (definition, transport) = self.current(input, id, version, true)?;
        let (transport, working_directory, oauth_enabled, environment, headers) = match transport {
            PreparedExternalMcpTransport::Local {
                command,
                args,
                environment,
                working_directory,
            } => (
                PreparedExternalMcpImportTransport::Local { command, args },
                working_directory,
                None,
                environment
                    .into_iter()
                    .map(|(key, value)| (key, value.expose().to_owned()))
                    .collect(),
                BTreeMap::new(),
            ),
            PreparedExternalMcpTransport::Remote {
                url,
                headers,
                oauth_enabled,
            } => (
                PreparedExternalMcpImportTransport::Remote { url },
                None,
                Some(oauth_enabled),
                BTreeMap::new(),
                headers
                    .into_iter()
                    .map(|(key, value)| (key, value.expose().to_owned()))
                    .collect(),
            ),
        };
        let prepared = PreparedExternalMcpImportServer {
            id: id.clone(),
            behavior_version: version.into(),
            transport,
            working_directory,
            timeouts: definition.timeouts,
            oauth_enabled,
            environment,
            headers,
        };
        prepared.validate().map_err(|_| {
            import_setup("DSH declaration cannot be represented by the current MCP import contract")
        })?;
        Ok(prepared)
    }
    fn watch_roots(&self, context: &ExternalSourceContext) -> Vec<ExternalWatchRoot> {
        let mut roots = vec![ExternalWatchRoot {
            path: self.options.dsh_home.clone(),
            recursive: true,
        }];
        if let Some(path) = &context.workspace_root {
            roots.push(ExternalWatchRoot {
                path: path.clone(),
                recursive: false,
            });
        }
        roots
    }
}

#[allow(clippy::too_many_arguments)]
fn collect_rows(
    value: &serde_yaml::Value,
    prefix: &str,
    parent_disabled: bool,
    parent_reason: Option<&str>,
    depth: usize,
    count: &mut usize,
    declarations: &mut Vec<Declaration>,
    incomplete: &mut bool,
) -> Result<(), ExternalSourceProviderError> {
    if depth > 16 {
        return Err(error(
            "depth_limit",
            "DSH MCP source nesting limit reached",
            false,
        ));
    }
    let serde_yaml::Value::Sequence(rows) = value else {
        return Err(error(
            "config_invalid",
            "DSH Cordis source must contain a list of rows",
            false,
        ));
    };
    for (index, raw) in rows.iter().enumerate() {
        *count += 1;
        if *count > 2048 {
            return Err(error(
                "row_limit",
                "DSH MCP source row limit reached",
                false,
            ));
        }
        if matches!(raw, serde_yaml::Value::Tagged(_)) {
            *incomplete = true;
            continue;
        }
        let Some(map) = raw.as_mapping() else {
            *incomplete = true;
            continue;
        };
        let get = |key: &str| map.get(serde_yaml::Value::String(key.into()));
        let named = get("name").and_then(plain_string).unwrap_or_default();
        let row_id = get("id")
            .and_then(plain_string)
            .map(str::to_owned)
            .unwrap_or_else(|| index.to_string());
        let identity = format!("{prefix}/{row_id}");
        let disabled =
            parent_disabled || matches!(get("disabled"), Some(serde_yaml::Value::Bool(true)));
        let mut reason = parent_reason.map(str::to_owned);
        if get("disabled").is_some_and(|v| !matches!(v, serde_yaml::Value::Bool(_))) {
            reason = Some("DSH disabled state must be a literal boolean".into());
        }
        if let Some(insert) = get("insert") {
            // An unqualified append is self-contained. Targeted insert/move/patch
            // operations need the owning native profile and cannot be guessed.
            if map.len() != 1 {
                *incomplete = true;
            }
            collect_rows(
                insert,
                &identity,
                disabled,
                reason.as_deref(),
                depth + 1,
                count,
                declarations,
                incomplete,
            )?;
            continue;
        }
        if matches!(get("group"), Some(serde_yaml::Value::Bool(true))) {
            if map.keys().any(|k| {
                !plain_string(k).is_some_and(|s| ["id", "group", "config", "disabled"].contains(&s))
            }) {
                reason = Some("DSH scoped groups require native Cordis composition".into());
            }
            if let Some(config) = get("config") {
                collect_rows(
                    config,
                    &identity,
                    disabled,
                    reason.as_deref(),
                    depth + 1,
                    count,
                    declarations,
                    incomplete,
                )?;
            } else {
                *incomplete = true;
            }
            continue;
        }
        if named.is_empty() {
            *incomplete = true;
            continue;
        }
        if !["@deepseek-ai/dsh-mcp-client", "dsh-mcp-client"].contains(&named) {
            continue;
        }
        if map.keys().any(|k| {
            !plain_string(k).is_some_and(|s| ["id", "name", "config", "disabled"].contains(&s))
        }) {
            reason =
                Some("DSH MCP row contains unsupported Cordis lifecycle or scope fields".into());
        }
        let config = get("config").unwrap_or(&serde_yaml::Value::Null);
        if contains_tag(raw, 0) {
            reason = Some("Dynamic Cordis YAML tags are not evaluated during MCP discovery".into());
        }
        let config = serde_json::to_value(config).unwrap_or(Value::Null);
        declarations.push(Declaration {
            identity,
            config,
            disabled,
            unsupported: reason,
        });
    }
    Ok(())
}

fn plain_string(value: &serde_yaml::Value) -> Option<&str> {
    match value {
        serde_yaml::Value::String(s) => Some(s),
        _ => None,
    }
}
fn contains_tag(value: &serde_yaml::Value, depth: usize) -> bool {
    if depth > 32 {
        return true;
    }
    match value {
        serde_yaml::Value::Tagged(_) => true,
        serde_yaml::Value::Sequence(items) => items.iter().any(|v| contains_tag(v, depth + 1)),
        serde_yaml::Value::Mapping(map) => map
            .iter()
            .any(|(k, v)| contains_tag(k, depth + 1) || contains_tag(v, depth + 1)),
        _ => false,
    }
}

fn materialize_server(
    input: &ExternalMcpDiscoveryInput,
    source: &SourceKey,
    declaration: Declaration,
    for_import: bool,
) -> Result<(ExternalMcpServerDefinition, PreparedExternalMcpTransport), ExternalSourceProviderError>
{
    // The established V1 revision includes compatibility status. Import relaxes
    // lifecycle compatibility only; keep the discovery revision for stale-plan checks.
    let discovery_version = if for_import {
        Some(
            materialize_server(input, source, declaration.clone(), false)?
                .0
                .behavior_version,
        )
    } else {
        None
    };
    let mut reason = declaration.unsupported;
    let empty = Map::new();
    let config = declaration.config.as_object().unwrap_or_else(|| {
        reason.get_or_insert("DSH MCP config must be an object".into());
        &empty
    });
    let raw_name = config
        .get("serverName")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let valid_name = !raw_name.is_empty()
        && raw_name.len() <= 32
        && raw_name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    let name = if valid_name {
        raw_name.to_string()
    } else {
        reason.get_or_insert(
            "DSH serverName must contain 1 to 32 ASCII letters, numbers, underscores or hyphens"
                .into(),
        );
        format!("invalid-{}", digest(declaration.identity.as_bytes()))
    };
    let id = SourceQualifiedMcpServerId::new(
        source.clone(),
        format!("mcp-{}", digest(declaration.identity.as_bytes())),
    )
    .expect("hashed id");
    let remote = config.get("transport").and_then(Value::as_str) == Some("streamable-http");
    let allowed: &[&str] = if remote {
        &[
            "transport",
            "serverName",
            "url",
            "headers",
            "toolCallTimeoutMs",
            "failOnStartupError",
        ]
    } else {
        &[
            "transport",
            "serverName",
            "command",
            "args",
            "env",
            "cwd",
            "toolCallTimeoutMs",
            "failOnStartupError",
        ]
    };
    if config
        .keys()
        .any(|k| !allowed.contains(&k.as_str()) && !(for_import && k == "reconnect"))
    {
        reason.get_or_insert(
            "DSH MCP configuration has unsupported fields (including explicit reconnect policies)"
                .into(),
        );
    }
    if config
        .get("failOnStartupError")
        .is_some_and(|v| !v.is_boolean() || (!for_import && v != &Value::Bool(false)))
    {
        reason.get_or_insert("DSH failOnStartupError must be false; native profile startup cannot be controlled by an imported MCP server".into());
    }
    if for_import
        && config.get("reconnect").is_some_and(|value| {
            let Some(policy) = value.as_object() else {
                return true;
            };
            policy.iter().any(|(key, value)| match key.as_str() {
                "enabled" => !value.is_boolean(),
                "initialDelayMs" | "maxDelayMs" => !value
                    .as_f64()
                    .is_some_and(|n| (1.0..=2_147_483_647.0).contains(&n)),
                "maxAttempts" => !value
                    .as_u64()
                    .is_some_and(|n| (1..=9_007_199_254_740_991).contains(&n)),
                _ => true,
            })
        })
    {
        reason.get_or_insert(
            "DSH reconnect policy must contain valid literal lifecycle settings".into(),
        );
    }
    let timeout = match config.get("toolCallTimeoutMs") {
        None => DEFAULT_CALL_TIMEOUT,
        Some(v) => match v.as_u64().filter(|n| (1..=2_147_483_647).contains(n)) {
            Some(n) => n,
            None => {
                reason.get_or_insert(
                    "DSH toolCallTimeoutMs must be a positive bounded integer".into(),
                );
                DEFAULT_CALL_TIMEOUT
            }
        },
    };
    if declaration.config.to_string().len() > 64 * 1024 {
        reason.get_or_insert("DSH MCP declaration exceeds the 64 KiB runtime limit".into());
    }
    let mut definition = ExternalMcpServerDefinition {
        id,
        provenance: vec![source.clone()],
        name,
        transport: if remote {
            ExternalMcpTransportKind::StreamableHttp
        } else {
            ExternalMcpTransportKind::LocalStdio
        },
        command_preview: None,
        argument_count: 0,
        working_directory: None,
        environment_keys: vec![],
        environment_reference_names: vec![],
        remote_url_preview: None,
        header_names: vec![],
        timeouts: ExternalMcpTimeouts {
            execution_ms: Some(timeout),
            ..Default::default()
        },
        source_enabled: !declaration.disabled,
        behavior_version: String::new(),
        static_status: ExternalMcpStaticStatus::Ready,
    };
    let transport = if remote {
        let raw_url = text(config.get("url"), &mut reason).unwrap_or_default();
        let mut headers = string_map(config.get("headers"), &mut reason);
        let mut keys = BTreeSet::new();
        if headers.keys().any(|k| !keys.insert(k.to_ascii_lowercase())) {
            reason.get_or_insert("DSH MCP header names must be unique ignoring case".into());
            headers.clear();
        }
        let preview = url::Url::parse(&raw_url)
            .ok()
            .filter(|url| url.scheme() == "https" && url.host_str().is_some());
        definition.remote_url_preview = Some(if let Some(mut url) = preview {
            if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
                reason.get_or_insert(
                    "DSH MCP URL must not contain user information or a fragment".into(),
                );
            }
            let _ = url.set_username("");
            let _ = url.set_password(None);
            url.set_path("/");
            url.set_query(None);
            url.set_fragment(None);
            url.to_string()
        } else {
            reason.get_or_insert("DSH remote MCP requires a valid HTTPS endpoint".into());
            "https://unsupported.invalid/".into()
        });
        definition.header_names = headers.keys().cloned().collect();
        PreparedExternalMcpTransport::Remote {
            url: raw_url,
            headers: headers
                .into_iter()
                .map(|(k, v)| (k, SecretValue::new(v)))
                .collect(),
            oauth_enabled: false,
        }
    } else {
        if config.get("transport").and_then(Value::as_str) != Some("stdio") {
            reason.get_or_insert("DSH transport must be stdio or streamable-http".into());
        }
        let command = text(config.get("command"), &mut reason)
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| {
                reason.get_or_insert("DSH MCP command must be a non-empty string".into());
                String::new()
            });
        let args = match config.get("args") {
            None => vec![],
            Some(Value::Array(args)) if args.len() <= 256 => args
                .iter()
                .filter_map(|v| text(Some(v), &mut reason))
                .collect(),
            _ => {
                reason.get_or_insert("DSH MCP args must be an array of at most 256 strings".into());
                vec![]
            }
        };
        let environment = string_map(config.get("env"), &mut reason);
        let cwd = match config.get("cwd") {
            None => None,
            value => text(value, &mut reason).filter(|s| !s.is_empty()),
        };
        // cwd in DSH's MCP SDK is launch-relative, never relative to the profile
        // YAML directory. A selected workspace supplies that launch context.
        let working_directory = match cwd.map(PathBuf::from) {
            Some(path) if path.is_absolute() => Some(path),
            Some(path) => input
                .context
                .workspace_root
                .as_ref()
                .map(|root| root.join(path))
                .or_else(|| {
                    reason.get_or_insert(
                        "Relative DSH MCP cwd requires a selected launch workspace".into(),
                    );
                    None
                }),
            None => input.context.workspace_root.clone(),
        };
        definition.command_preview = Some(redacted_executable_preview(&command));
        definition.argument_count = args.len();
        definition.working_directory = working_directory
            .as_ref()
            .map(|_| "<launch workspace or configured directory>".into());
        definition.environment_keys = environment.keys().cloned().collect();
        PreparedExternalMcpTransport::Local {
            command,
            args,
            environment: environment
                .into_iter()
                .map(|(k, v)| (k, SecretValue::new(v)))
                .collect(),
            working_directory,
        }
    };
    definition.static_status = if let Some(reason) = reason {
        ExternalMcpStaticStatus::Unsupported { reason }
    } else if declaration.disabled {
        ExternalMcpStaticStatus::DisabledBySource
    } else {
        ExternalMcpStaticStatus::Ready
    };
    let encoded = declaration.config.to_string();
    let cwd = match &transport {
        PreparedExternalMcpTransport::Local {
            working_directory, ..
        } => working_directory
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
        _ => String::new(),
    };
    let status = serde_json::to_string(&definition.static_status).unwrap_or_default();
    definition.behavior_version = input.revision_key.opaque_revision(
        "dsh.mcp.behavior.v1",
        [encoded.as_bytes(), cwd.as_bytes(), status.as_bytes()],
    );
    if let Some(version) = discovery_version {
        definition.behavior_version = version;
    }
    Ok((definition, transport))
}

fn text(value: Option<&Value>, reason: &mut Option<String>) -> Option<String> {
    match value {
        Some(Value::String(s)) if !s.contains('\0') && s.len() <= 64 * 1024 => Some(s.clone()),
        _ => {
            reason.get_or_insert("DSH MCP values must be bounded literal strings".into());
            None
        }
    }
}
fn string_map(value: Option<&Value>, reason: &mut Option<String>) -> BTreeMap<String, String> {
    let Some(value) = value else {
        return BTreeMap::new();
    };
    let Some(map) = value.as_object().filter(|m| m.len() <= 128) else {
        reason.get_or_insert(
            "DSH MCP environment and headers must be objects with at most 128 entries".into(),
        );
        return BTreeMap::new();
    };
    map.iter()
        .filter_map(|(k, v)| {
            if k.is_empty() || k.len() > 128 || k.chars().any(char::is_control) {
                reason.get_or_insert("DSH MCP environment or header name is invalid".into());
                return None;
            }
            text(Some(v), reason).map(|v| (k.clone(), v))
        })
        .collect()
}
fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))[..24].to_string()
}
fn source_key(path: &Path) -> SourceKey {
    SourceKey::new(
        PROVIDER,
        format!("dsh_mcp-{}", digest(path.to_string_lossy().as_bytes())),
    )
    .expect("hashed id")
}
fn error(suffix: &str, message: &str, transient: bool) -> ExternalSourceProviderError {
    ExternalSourceProviderError::new(format!("dsh.mcp.{suffix}"), message, transient)
}
fn import_setup(message: &str) -> ExternalSourceProviderError {
    ExternalSourceProviderError::new("external_mcp.import_setup_required", message, false)
}
fn diagnostic(source: &SourceKey, suffix: &str, message: &str) -> ExternalSourceDiagnostic {
    ExternalSourceDiagnostic::warning(format!("dsh.mcp.{suffix}"), message, Some(source.clone()))
        .with_asset_kind(ExternalSourceAssetKind::Mcp)
}

#[cfg(test)]
#[path = "mcp_source_tests.rs"]
mod tests;
