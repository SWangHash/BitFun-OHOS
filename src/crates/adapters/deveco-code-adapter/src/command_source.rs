use crate::local_source_paths::{
    find_project_root, local_source_plan, local_source_watch_roots, DevEcoCodeLocalConfigOptions,
    LocalConfigDirectoryKind, LocalConfigDocument, LocalConfigDocumentKind, LocalSourcePlanItem,
};
use bitfun_product_domains::external_sources::{
    EcosystemId, ExternalSourceAssetKind, ExternalSourceContext, ExternalSourceDiagnostic,
    ExternalSourceHealth, ExternalSourceProviderError, ExternalSourceRecord, ExternalSourceScope,
    ExternalWatchRoot, PromptCommandAvailability, PromptCommandDefinition,
    PromptCommandExecutionTarget, PromptCommandExpansion, PromptCommandProviderIdentity,
    PromptCommandProviderSnapshot, PromptCommandShellExpansion, PromptCommandShellInvocation,
    PromptCommandShellPreference, PromptCommandSourceProvider, SourceKey, SourceQualifiedCommandId,
};
pub(crate) use bitfun_services_core::jsonc::strip_jsonc;
use bitfun_services_core::markdown::{
    parse_prompt_shell_directives, prompt_template_expansion_upper_bound, FrontMatterMarkdown,
};
use bitfun_services_core::workspace_text::normalize_workspace_relative_path;
use bitfun_static_hook_support::{
    collect_bounded_regular_files, read_bounded_text, BoundedDirectoryWalkError,
    BoundedDirectoryWalkLimits, BoundedTextRead,
};
use regex::Regex;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const PROVIDER_ID: &str = "deveco-code.commands";
const ECOSYSTEM_ID: &str = "deveco-code";
const MAX_COMMAND_FILES: usize = 2048;
const MAX_COMMAND_FILE_BYTES: usize = 256 * 1024;
const MAX_COMMAND_TEMPLATE_BYTES: usize = 8 * 1024 * 1024;
const MAX_CONFIG_FILE_BYTES: usize = 1024 * 1024;
const MAX_EXPANDED_COMMAND_BYTES: usize = 1024 * 1024;

pub type DevEcoCodeCommandProviderOptions = DevEcoCodeLocalConfigOptions;

pub struct DevEcoCodeCommandProvider {
    options: DevEcoCodeCommandProviderOptions,
}

impl DevEcoCodeCommandProvider {
    pub fn new(options: DevEcoCodeCommandProviderOptions) -> Self {
        Self { options }
    }

    fn discover_layers(&self, workspace_root: Option<&Path>) -> Vec<SourceLayer> {
        let mut layers = Vec::new();
        for item in local_source_plan(&self.options, workspace_root, None) {
            let LocalSourcePlanItem::Directory(directory) = item else {
                if let LocalSourcePlanItem::Config(document) = item {
                    push_config_document_layer(&mut layers, document);
                }
                continue;
            };
            match directory.kind {
                LocalConfigDirectoryKind::User => push_command_directory_layer(
                    &mut layers,
                    &directory.path,
                    directory.scope,
                    "DevEco Code user command directory",
                ),
                LocalConfigDirectoryKind::Project => {
                    push_command_directory_layer(
                        &mut layers,
                        &directory.path,
                        directory.scope,
                        "DevEco Code project command directory",
                    );
                }
                LocalConfigDirectoryKind::Legacy => push_command_directory_layer(
                    &mut layers,
                    &directory.path,
                    directory.scope,
                    "DevEco Code home configuration",
                ),
                LocalConfigDirectoryKind::Explicit => push_command_directory_layer(
                    &mut layers,
                    &directory.path,
                    directory.scope,
                    "DevEco Code DEVECO_CONFIG_DIR",
                ),
            }
        }
        deduplicate_layers_keep_last(layers)
    }
}

impl Default for DevEcoCodeCommandProvider {
    fn default() -> Self {
        Self::new(DevEcoCodeCommandProviderOptions::default())
    }
}

impl PromptCommandSourceProvider for DevEcoCodeCommandProvider {
    fn identity(&self) -> PromptCommandProviderIdentity {
        PromptCommandProviderIdentity::new(PROVIDER_ID, ECOSYSTEM_ID, "DevEco Code")
            .expect("static DevEco Code provider identity must be valid")
    }

    fn discover(
        &self,
        context: &ExternalSourceContext,
    ) -> Result<PromptCommandProviderSnapshot, ExternalSourceProviderError> {
        if !self.options.ordinary_cli_sources_enabled {
            return Ok(PromptCommandProviderSnapshot {
                provider: self.identity(),
                sources: Vec::new(),
                commands: Vec::new(),
                unavailable_command_ids: Vec::new(),
                diagnostics: vec![ExternalSourceDiagnostic::warning(
                    "deveco.runtime_unsupported",
                    crate::local_source_paths::UNSUPPORTED_RUNTIME,
                    None,
                )
                .with_asset_kind(ExternalSourceAssetKind::Command)],
            });
        }
        if context
            .workspace_root
            .as_ref()
            .is_some_and(|workspace_root| !workspace_root.is_absolute())
        {
            return Err(ExternalSourceProviderError::new(
                "deveco.command.workspace_invalid",
                "workspace root must be absolute",
                false,
            ));
        }

        let mut sources = Vec::new();
        let mut diagnostics = Vec::new();
        let mut command_candidates = Vec::new();
        let mut unavailable_command_ids = Vec::new();
        let mut provider_template_bytes = 0usize;

        let parsed_layers = self
            .discover_layers(context.workspace_root.as_deref())
            .into_iter()
            .map(|layer| {
                let parsed = match &layer.kind {
                    SourceLayerKind::Config(document) => parse_config_document_layer(document),
                    SourceLayerKind::CommandDirectory(path) => parse_command_directory(path),
                };
                (layer, parsed)
            })
            .collect::<Vec<_>>();
        let configured_shell = parsed_layers
            .iter()
            .filter_map(|(_, parsed)| parsed.configured_shell.as_deref())
            .last()
            .map(str::to_string);

        for (layer, parsed) in parsed_layers {
            let source_key = source_key(&layer);
            let ParsedLayer {
                commands,
                unavailable_command_names,
                diagnostics: parsed_diagnostics,
                content_version,
                mut fatal,
                configured_shell: _,
            } = parsed;
            let mut layer_diagnostics = parsed_diagnostics
                .into_iter()
                .map(|diagnostic| ExternalSourceDiagnostic {
                    source: Some(source_key.clone()),
                    ..diagnostic
                })
                .collect::<Vec<_>>();
            let layer_template_bytes = commands
                .values()
                .map(|command| command.template.len())
                .sum::<usize>();
            if !fatal
                && provider_template_bytes.saturating_add(layer_template_bytes)
                    > MAX_COMMAND_TEMPLATE_BYTES
            {
                fatal = true;
                layer_diagnostics.push(ExternalSourceDiagnostic::warning(
                    "deveco.command.provider_template_bytes_limit",
                    "DevEco Code command templates exceed the 8 MiB provider limit",
                    Some(source_key.clone()),
                ));
            } else if !fatal {
                provider_template_bytes += layer_template_bytes;
            }
            let mut has_restricted_commands = false;
            if !fatal {
                unavailable_command_ids.extend(unavailable_command_names.into_iter().filter_map(
                    |name| SourceQualifiedCommandId::new(source_key.clone(), name).ok(),
                ));
                for (name, input) in commands {
                    match command_definition(
                        source_key.clone(),
                        name.clone(),
                        input,
                        configured_shell.as_deref(),
                    ) {
                        Ok(definition) => {
                            has_restricted_commands |= !matches!(
                                definition.availability,
                                PromptCommandAvailability::Available
                            );
                            command_candidates.push(definition);
                        }
                        Err(error) => {
                            if let Ok(command_id) =
                                SourceQualifiedCommandId::new(source_key.clone(), name)
                            {
                                unavailable_command_ids.push(command_id);
                            }
                            layer_diagnostics.push(ExternalSourceDiagnostic::warning(
                                error.code,
                                error.message,
                                Some(source_key.clone()),
                            ));
                        }
                    }
                }
            }
            let source_health = if fatal {
                ExternalSourceHealth::Unavailable
            } else if !layer_diagnostics.is_empty() {
                ExternalSourceHealth::Degraded
            } else if has_restricted_commands {
                ExternalSourceHealth::Partial
            } else {
                ExternalSourceHealth::Available
            };
            diagnostics.extend(layer_diagnostics.clone());
            sources.push(ExternalSourceRecord {
                key: source_key.clone(),
                ecosystem_id: EcosystemId::new(ECOSYSTEM_ID)
                    .expect("static ecosystem id must be valid"),
                display_name: layer.display_name,
                source_kind: layer.source_kind.to_string(),
                scope: layer.scope,
                location: layer.location,
                execution_domain_id: context.execution_domain_id.clone(),
                health: source_health,
                content_version,
                diagnostics: layer_diagnostics,
            });
        }

        for diagnostic in &mut diagnostics {
            diagnostic.asset_kind = ExternalSourceAssetKind::Command;
        }
        for source in &mut sources {
            for diagnostic in &mut source.diagnostics {
                diagnostic.asset_kind = ExternalSourceAssetKind::Command;
            }
        }
        Ok(PromptCommandProviderSnapshot {
            provider: self.identity(),
            sources,
            commands: command_candidates,
            unavailable_command_ids,
            diagnostics,
        })
    }

    fn expand(
        &self,
        context: &ExternalSourceContext,
        command: &PromptCommandDefinition,
        arguments: &str,
    ) -> Result<PromptCommandExpansion, ExternalSourceProviderError> {
        if command.id.source.provider_id.as_str() != PROVIDER_ID {
            return Err(ExternalSourceProviderError::new(
                "deveco.command.identity_mismatch",
                "command is not owned by the DevEco Code command provider",
                false,
            ));
        }
        match &command.availability {
            PromptCommandAvailability::Available => {
                if prompt_template_expansion_upper_bound(&command.template, arguments)
                    .is_none_or(|size| size > MAX_EXPANDED_COMMAND_BYTES)
                {
                    return Err(ExternalSourceProviderError::new(
                        "deveco.command.expansion_too_large",
                        "expanded command would exceed the 1048576 byte limit",
                        false,
                    ));
                }
                let expanded = expand_template(&command.template, arguments);
                let parsed = parse_prompt_shell_directives(&command.template, &expanded).map_err(
                    |error| {
                        ExternalSourceProviderError::new(
                            "deveco.command.shell_structure_invalid",
                            error,
                            false,
                        )
                    },
                )?;
                let shell = if parsed.directives.is_empty() {
                    None
                } else {
                    let workspace = context.workspace_root.as_deref().ok_or_else(|| {
                        ExternalSourceProviderError::new(
                            "deveco.command.shell_workspace_required",
                            "DevEco Code shell-backed commands require a local workspace",
                            false,
                        )
                    })?;
                    Some(PromptCommandShellExpansion {
                        working_directory: find_project_root(workspace),
                        preference: command
                            .shell_preference
                            .clone()
                            .unwrap_or(PromptCommandShellPreference::HostDefault),
                        invocations: parsed
                            .directives
                            .iter()
                            .map(|directive| PromptCommandShellInvocation {
                                range_start: directive.range.start,
                                range_end: directive.range.end,
                                command: directive.command.clone(),
                                can_remember: directive.can_remember,
                            })
                            .collect(),
                    })
                };
                Ok(PromptCommandExpansion {
                    content: parsed.content,
                    workspace_file_references: literal_file_references(
                        &parsed.template_without_directives,
                    ),
                    shell,
                })
            }
            PromptCommandAvailability::Restricted { reason, .. }
            | PromptCommandAvailability::Invalid { reason } => {
                Err(ExternalSourceProviderError::new(
                    "deveco.command.restricted",
                    reason.clone(),
                    false,
                ))
            }
            _ => Err(ExternalSourceProviderError::new(
                "deveco.command.availability_unknown",
                "command availability is not supported by this adapter version",
                false,
            )),
        }
    }

    fn resolve_commands(
        &self,
        snapshot: &PromptCommandProviderSnapshot,
        enabled_sources: &BTreeSet<SourceKey>,
    ) -> Result<Vec<PromptCommandDefinition>, ExternalSourceProviderError> {
        let mut effective = BTreeMap::<String, Option<PromptCommandDefinition>>::new();
        for source in snapshot
            .sources
            .iter()
            .filter(|source| enabled_sources.contains(&source.key))
        {
            for command in snapshot
                .commands
                .iter()
                .filter(|command| command.id.source == source.key)
            {
                // Discovery preserves DevEcoCode's low-to-high source order. A
                // later candidate replaces an earlier same-name definition.
                effective.insert(command.name.to_ascii_lowercase(), Some(command.clone()));
            }
            for unavailable in snapshot
                .unavailable_command_ids
                .iter()
                .filter(|command| command.source == source.key)
            {
                let retained = snapshot
                    .commands
                    .iter()
                    .any(|command| command.id == *unavailable);
                if !retained {
                    effective.insert(unavailable.local_id.as_str().to_ascii_lowercase(), None);
                }
            }
        }
        Ok(effective.into_values().flatten().collect())
    }

    fn watch_roots(&self, context: &ExternalSourceContext) -> Vec<ExternalWatchRoot> {
        local_source_watch_roots(&self.options, context.workspace_root.as_deref(), None)
    }
}

#[derive(Debug)]
struct SourceLayer {
    kind: SourceLayerKind,
    location: String,
    identity: String,
    scope: ExternalSourceScope,
    display_name: String,
    source_kind: &'static str,
}

#[derive(Debug)]
enum SourceLayerKind {
    Config(LocalConfigDocument),
    CommandDirectory(PathBuf),
}

fn push_command_directory_layer(
    layers: &mut Vec<SourceLayer>,
    directory: &Path,
    scope: ExternalSourceScope,
    display_name: &str,
) {
    let command_roots = [directory.join("command"), directory.join("commands")];
    if command_roots
        .iter()
        .any(|path| match fs::symlink_metadata(path) {
            Ok(_) => true,
            Err(error) => error.kind() != std::io::ErrorKind::NotFound,
        })
    {
        layers.push(SourceLayer {
            kind: SourceLayerKind::CommandDirectory(directory.to_path_buf()),
            location: directory.to_string_lossy().into_owned(),
            identity: dunce::canonicalize(directory)
                .unwrap_or_else(|_| directory.to_path_buf())
                .to_string_lossy()
                .into_owned(),
            scope,
            display_name: display_name.to_string(),
            source_kind: "deveco_command_directory",
        });
    }
}

fn push_config_document_layer(layers: &mut Vec<SourceLayer>, document: LocalConfigDocument) {
    let display_name = match document.kind {
        LocalConfigDocumentKind::User => "DevEco Code user configuration",
        LocalConfigDocumentKind::ExplicitFile => "DevEco Code DEVECO_CONFIG",
        LocalConfigDocumentKind::Project
        | LocalConfigDocumentKind::Directory(LocalConfigDirectoryKind::Project) => {
            "DevEco Code project configuration"
        }
        LocalConfigDocumentKind::Directory(LocalConfigDirectoryKind::Legacy) => {
            "DevEco Code home configuration"
        }
        LocalConfigDocumentKind::Directory(LocalConfigDirectoryKind::Explicit) => {
            "DevEco Code DEVECO_CONFIG_DIR"
        }
        LocalConfigDocumentKind::Directory(LocalConfigDirectoryKind::User) => {
            "DevEco Code user configuration"
        }
        LocalConfigDocumentKind::Inline => "DevEco Code DEVECO_CONFIG_CONTENT",
    };
    let location = document.location();
    let identity = document.identity();
    layers.push(SourceLayer {
        scope: document.scope,
        kind: SourceLayerKind::Config(document),
        location,
        identity,
        display_name: display_name.to_string(),
        source_kind: "deveco_config",
    });
}

fn source_key(layer: &SourceLayer) -> SourceKey {
    let mut hasher = Sha256::new();
    hasher.update(layer.source_kind.as_bytes());
    hasher.update([0]);
    hasher.update(layer.identity.as_bytes());
    let digest = hex::encode(hasher.finalize());
    SourceKey::new(
        PROVIDER_ID,
        format!("{}-{}", layer.source_kind, &digest[..24]),
    )
    .expect("hashed DevEco Code source id must be valid")
}

fn deduplicate_layers_keep_last(layers: Vec<SourceLayer>) -> Vec<SourceLayer> {
    let mut seen = BTreeSet::new();
    let mut unique = layers
        .into_iter()
        .rev()
        .filter(|layer| seen.insert(source_key(layer)))
        .collect::<Vec<_>>();
    unique.reverse();
    unique
}

#[derive(Debug, Default, Deserialize)]
struct DevEcoCodeConfigDocument {
    #[serde(default)]
    shell: Option<String>,
    #[serde(default, rename = "command")]
    commands: BTreeMap<String, DevEcoCodeCommandInput>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct DevEcoCodeCommandInput {
    template: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    agent: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    variant: Option<String>,
    #[serde(default)]
    subtask: Option<bool>,
}

struct ParsedLayer {
    commands: BTreeMap<String, DevEcoCodeCommandInput>,
    unavailable_command_names: BTreeSet<String>,
    diagnostics: Vec<ExternalSourceDiagnostic>,
    content_version: String,
    fatal: bool,
    configured_shell: Option<String>,
}

fn parse_config_document_layer(document: &LocalConfigDocument) -> ParsedLayer {
    match document.read_bounded(MAX_CONFIG_FILE_BYTES) {
        Ok(BoundedTextRead::Content(content)) => {
            let identity = document.identity();
            let content_version = content_version([(Path::new(&identity), content.as_bytes())]);
            match parse_config_document(&content) {
                Ok(document) => ParsedLayer {
                    commands: document.commands,
                    unavailable_command_names: BTreeSet::new(),
                    diagnostics: Vec::new(),
                    content_version,
                    fatal: false,
                    configured_shell: document
                        .shell
                        .map(|shell| shell.trim().to_string())
                        .filter(|shell| !shell.is_empty()),
                },
                Err(error) => ParsedLayer {
                    commands: BTreeMap::new(),
                    unavailable_command_names: BTreeSet::new(),
                    diagnostics: vec![ExternalSourceDiagnostic::error(
                        "deveco.command.config_invalid",
                        format!("Failed to parse DevEco Code command config: {error}"),
                        None,
                    )],
                    content_version,
                    fatal: true,
                    configured_shell: None,
                },
            }
        }
        Ok(BoundedTextRead::TooLarge) => ParsedLayer {
            commands: BTreeMap::new(),
            unavailable_command_names: BTreeSet::new(),
            diagnostics: vec![ExternalSourceDiagnostic::error(
                "deveco.command.config_too_large",
                "DevEco Code config exceeds the 1 MiB compatibility limit",
                None,
            )],
            content_version: "too-large".to_string(),
            fatal: true,
            configured_shell: None,
        },
        Ok(BoundedTextRead::InvalidUtf8) => ParsedLayer {
            commands: BTreeMap::new(),
            unavailable_command_names: BTreeSet::new(),
            diagnostics: vec![ExternalSourceDiagnostic::error(
                "deveco.command.config_invalid_utf8",
                "DevEco Code command config must be valid UTF-8",
                None,
            )],
            content_version: "invalid-utf8".to_string(),
            fatal: true,
            configured_shell: None,
        },
        Err(error) => ParsedLayer {
            commands: BTreeMap::new(),
            unavailable_command_names: BTreeSet::new(),
            diagnostics: vec![ExternalSourceDiagnostic::error(
                "deveco.command.config_unreadable",
                format!("Failed to read DevEco Code command config: {error}"),
                None,
            )],
            content_version: "unreadable".to_string(),
            fatal: true,
            configured_shell: None,
        },
    }
}

fn parse_command_directory(directory: &Path) -> ParsedLayer {
    let mut files = Vec::new();
    let mut scan_diagnostics = Vec::new();
    let mut scan_failed = false;
    for name in ["command", "commands"] {
        let root = directory.join(name);
        match fs::symlink_metadata(&root) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                scan_failed = true;
                scan_diagnostics.push(ExternalSourceDiagnostic::error(
                    "deveco.command.directory_unreadable",
                    format!("Failed to inspect an DevEco Code command directory: {error}"),
                    None,
                ));
                break;
            }
            Ok(metadata) if !metadata.is_dir() || metadata.file_type().is_symlink() => {
                scan_failed = true;
                scan_diagnostics.push(ExternalSourceDiagnostic::error(
                    "deveco.command.directory_invalid",
                    "An DevEco Code command directory path is not a regular directory",
                    None,
                ));
                break;
            }
            Ok(_) => {}
        }
        let remaining = MAX_COMMAND_FILES.saturating_sub(files.len());
        match collect_bounded_regular_files(
            &root,
            BoundedDirectoryWalkLimits::for_file_limit(remaining),
            |path| {
                path.extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
            },
        ) {
            Ok(mut discovered) => files.append(&mut discovered),
            Err(error) => {
                scan_failed = true;
                let code = if matches!(error, BoundedDirectoryWalkError::LimitExceeded(_)) {
                    "deveco.command.file_limit"
                } else {
                    "deveco.command.directory_unreadable"
                };
                scan_diagnostics.push(ExternalSourceDiagnostic::error(
                    code,
                    format!("Failed to safely scan an DevEco Code command directory: {error}"),
                    None,
                ));
                break;
            }
        }
    }
    files.sort();

    let mut commands = BTreeMap::new();
    let mut unavailable_command_names = BTreeSet::new();
    let mut diagnostics = scan_diagnostics;
    let mut version_hasher = Sha256::new();
    let mut total_template_bytes = 0usize;
    let mut template_budget_exhausted = false;
    for path in &files {
        let Some(name) = command_name(directory, path) else {
            continue;
        };
        if template_budget_exhausted {
            unavailable_command_names.insert(name);
            continue;
        }
        let content = match read_bounded_text(path, MAX_COMMAND_FILE_BYTES) {
            Ok(BoundedTextRead::Content(content)) => content,
            Ok(BoundedTextRead::TooLarge) => {
                commands.remove(&name);
                unavailable_command_names.insert(name);
                diagnostics.push(ExternalSourceDiagnostic::warning(
                    "deveco.command.file_too_large",
                    "DevEco Code command file exceeds the 256 KiB compatibility limit",
                    None,
                ));
                continue;
            }
            Ok(BoundedTextRead::InvalidUtf8) => {
                commands.remove(&name);
                unavailable_command_names.insert(name);
                diagnostics.push(ExternalSourceDiagnostic::warning(
                    "deveco.command.file_invalid_utf8",
                    "DevEco Code command files must be valid UTF-8",
                    None,
                ));
                continue;
            }
            Err(error) => {
                commands.remove(&name);
                unavailable_command_names.insert(name);
                diagnostics.push(ExternalSourceDiagnostic::warning(
                    "deveco.command.file_unreadable",
                    format!("Failed to read command file: {error}"),
                    None,
                ));
                continue;
            }
        };
        version_hasher.update(path.to_string_lossy().as_bytes());
        version_hasher.update([0]);
        version_hasher.update(content.as_bytes());
        version_hasher.update([0]);
        if total_template_bytes.saturating_add(content.len()) > MAX_COMMAND_TEMPLATE_BYTES {
            commands.remove(&name);
            unavailable_command_names.insert(name);
            template_budget_exhausted = true;
            diagnostics.push(ExternalSourceDiagnostic::warning(
                "deveco.command.total_template_bytes_limit",
                "DevEco Code command templates exceed the 8 MiB collection limit",
                None,
            ));
            continue;
        }
        total_template_bytes += content.len();
        match parse_markdown_command(&content) {
            Ok(input) => {
                unavailable_command_names.remove(&name);
                commands.insert(name, input);
            }
            Err(error) => {
                commands.remove(&name);
                unavailable_command_names.insert(name);
                diagnostics.push(ExternalSourceDiagnostic::warning(
                    "deveco.command.markdown_invalid",
                    format!("Failed to parse DevEco Code command Markdown: {error}"),
                    None,
                ));
            }
        }
    }
    ParsedLayer {
        commands,
        unavailable_command_names,
        diagnostics,
        content_version: format!("sha256:{}", hex::encode(version_hasher.finalize())),
        fatal: scan_failed || template_budget_exhausted,
        configured_shell: None,
    }
}

fn command_name(directory: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(directory).ok()?;
    let mut components = relative.components();
    let first = components.next()?.as_os_str().to_str()?;
    if first != "command" && first != "commands" {
        return None;
    }
    let tail = components.collect::<PathBuf>();
    let mut name = tail.to_string_lossy().replace('\\', "/");
    if name.to_ascii_lowercase().ends_with(".md") {
        name.truncate(name.len() - 3);
    }
    (!name.is_empty()).then_some(name)
}

fn parse_markdown_command(content: &str) -> Result<DevEcoCodeCommandInput, String> {
    let (metadata, body) = if content.starts_with("---\n") || content.starts_with("---\r\n") {
        let (metadata, body) = FrontMatterMarkdown::load_str(content).or_else(|first_error| {
            let sanitized = sanitize_deveco_frontmatter(content);
            if sanitized == content {
                return Err(first_error);
            }
            FrontMatterMarkdown::load_str(&sanitized).map_err(|retry_error| {
                format!(
                    "{first_error}; DevEco Code-compatible front matter retry failed: {retry_error}"
                )
            })
        })?;
        (Some(metadata), body)
    } else {
        (None, content.to_string())
    };
    let mut input = DevEcoCodeCommandInput {
        template: body.trim().to_string(),
        ..DevEcoCodeCommandInput::default()
    };
    if let Some(metadata) = metadata {
        let optional_string = |key: &str| -> Result<Option<String>, String> {
            match metadata.get(key) {
                None => Ok(None),
                Some(value) => value.as_str().map(str::to_string).map(Some).ok_or_else(|| {
                    format!("DevEco Code command front matter field '{key}' must be a string")
                }),
            }
        };
        input.description = optional_string("description")?;
        input.agent = optional_string("agent")?;
        input.model = optional_string("model")?;
        input.variant = optional_string("variant")?;
        input.subtask = match metadata.get("subtask") {
            None => None,
            Some(value) => Some(value.as_bool().ok_or_else(|| {
                "DevEco Code command front matter field 'subtask' must be a boolean".to_string()
            })?),
        };
    }
    if input.template.is_empty() {
        return Err("command template is empty".to_string());
    }
    Ok(input)
}

fn sanitize_deveco_frontmatter(content: &str) -> String {
    let Some(captures) = markdown_frontmatter_regex().captures(content) else {
        return content.to_string();
    };
    let Some(frontmatter) = captures.get(1) else {
        return content.to_string();
    };
    let mut changed = false;
    let sanitized = frontmatter
        .as_str()
        .lines()
        .flat_map(|line| {
            if line.trim().starts_with('#')
                || line.trim().is_empty()
                || line.chars().next().is_some_and(char::is_whitespace)
            {
                return vec![line.to_string()];
            }
            let Some(entry) = markdown_frontmatter_entry_regex().captures(line) else {
                return vec![line.to_string()];
            };
            let key = entry.get(1).map(|value| value.as_str()).unwrap_or_default();
            let value = entry
                .get(2)
                .map(|value| value.as_str().trim())
                .unwrap_or_default();
            if value.is_empty()
                || value == ">"
                || value == "|"
                || value.starts_with('"')
                || value.starts_with('\'')
                || !value.contains(':')
            {
                return vec![line.to_string()];
            }
            changed = true;
            vec![format!("{key}: |-"), format!("  {value}")]
        })
        .collect::<Vec<_>>()
        .join("\n");
    if !changed {
        return content.to_string();
    }
    let mut result = String::with_capacity(content.len() + sanitized.len());
    result.push_str(&content[..frontmatter.start()]);
    result.push_str(&sanitized);
    result.push_str(&content[frontmatter.end()..]);
    result
}

fn command_definition(
    source: SourceKey,
    name: String,
    input: DevEcoCodeCommandInput,
    configured_shell: Option<&str>,
) -> Result<PromptCommandDefinition, ExternalSourceProviderError> {
    let mut required_capabilities = Vec::new();
    let shell_preference = shell_regex().is_match(&input.template).then(|| {
        configured_shell.map_or(PromptCommandShellPreference::HostDefault, |executable| {
            PromptCommandShellPreference::Preferred {
                executable: executable.to_string(),
            }
        })
    });
    let content_version = command_content_version(&name, &input, shell_preference.as_ref());
    let execution_target = match (
        input.agent.as_deref(),
        input.subtask,
        input.model.as_ref(),
        input.variant.as_ref(),
    ) {
        (Some(agent), None | Some(true), None, None) => {
            PromptCommandExecutionTarget::FreshExternalSubagent {
                ecosystem_id: EcosystemId::new(ECOSYSTEM_ID).map_err(|error| {
                    ExternalSourceProviderError::new(
                        "deveco.command.ecosystem_invalid",
                        error.to_string(),
                        false,
                    )
                })?,
                logical_id: agent.to_string(),
            }
        }
        _ => PromptCommandExecutionTarget::Inline,
    };
    if input.agent.is_some() && execution_target.is_inline() {
        required_capabilities.push("command.agent".to_string());
    }
    if input.model.is_some() {
        required_capabilities.push("command.model".to_string());
    }
    if input.variant.is_some() {
        required_capabilities.push("command.variant".to_string());
    }
    if input.subtask.is_some() && execution_target.is_inline() {
        required_capabilities.push("command.subtask".to_string());
    }
    if !execution_target.is_inline() && shell_preference.is_some() {
        required_capabilities.push("command.external_subagent.shell".to_string());
    }
    if config_variable_regex().is_match(&input.template) {
        required_capabilities.push("command.config_variable".to_string());
    }
    required_capabilities.extend(file_reference_capabilities(&input.template));
    required_capabilities.sort();
    required_capabilities.dedup();
    let availability = if required_capabilities.is_empty() {
        PromptCommandAvailability::Available
    } else {
        PromptCommandAvailability::Restricted {
            reason: format!(
                "DevEco Code command requires capabilities not available in this release: {}",
                required_capabilities.join(", ")
            ),
            required_capabilities,
        }
    };
    let definition = PromptCommandDefinition {
        id: SourceQualifiedCommandId::new(source, name.clone()).map_err(|error| {
            ExternalSourceProviderError::new(
                "deveco.command.name_invalid",
                error.to_string(),
                false,
            )
        })?,
        name: name.clone(),
        description: input
            .description
            .unwrap_or_else(|| format!("DevEco Code command /{name}")),
        template: input.template,
        shell_preference,
        execution_target,
        availability,
        content_version,
    };
    definition.validate().map_err(|error| {
        ExternalSourceProviderError::new(
            "deveco.command.definition_invalid",
            error.to_string(),
            false,
        )
    })?;
    Ok(definition)
}

fn parse_config_document(input: &str) -> Result<DevEcoCodeConfigDocument, String> {
    let value = serde_json::from_str::<serde_json::Value>(&strip_jsonc(input))
        .map_err(|error| error.to_string())?;
    if value.get("commands").is_some() && value.get("command").is_none() {
        return Err("unsupported top-level 'commands'; DevEco Code uses 'command'".to_string());
    }
    serde_json::from_value(value).map_err(|error| error.to_string())
}

fn command_content_version(
    name: &str,
    input: &DevEcoCodeCommandInput,
    shell_preference: Option<&PromptCommandShellPreference>,
) -> String {
    let mut hasher = Sha256::new();
    for value in [
        Some(name),
        Some(input.template.as_str()),
        input.description.as_deref(),
        input.agent.as_deref(),
        input.model.as_deref(),
        input.variant.as_deref(),
    ] {
        match value {
            Some(value) => {
                hasher.update(value.len().to_le_bytes());
                hasher.update(value.as_bytes());
            }
            None => hasher.update(usize::MAX.to_le_bytes()),
        }
    }
    hasher.update([u8::from(input.subtask.unwrap_or(false))]);
    hasher.update([u8::from(input.subtask.is_some())]);
    hasher.update(
        serde_json::to_vec(&shell_preference)
            .expect("prompt command shell preference is serializable"),
    );
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

fn expand_template(template: &str, arguments: &str) -> String {
    let args = argument_regex()
        .find_iter(arguments)
        .map(|item| {
            let value = item.as_str();
            if value.len() >= 2
                && ((value.starts_with('"') && value.ends_with('"'))
                    || (value.starts_with('\'') && value.ends_with('\'')))
            {
                value[1..value.len() - 1].to_string()
            } else {
                value.to_string()
            }
        })
        .collect::<Vec<_>>();
    let placeholders = placeholder_regex()
        .captures_iter(template)
        .filter_map(|capture| capture[1].parse::<usize>().ok())
        .collect::<Vec<_>>();
    let last = placeholders.iter().copied().max().unwrap_or(0);
    let with_positions =
        placeholder_regex().replace_all(template, |capture: &regex::Captures<'_>| {
            let position = capture[1].parse::<usize>().unwrap_or(0);
            let argument_index = position.saturating_sub(1);
            if argument_index >= args.len() {
                String::new()
            } else if position == last {
                args[argument_index..].join(" ")
            } else {
                args[argument_index].clone()
            }
        });
    let uses_arguments = template.contains("$ARGUMENTS");
    let mut expanded = with_positions.replace("$ARGUMENTS", arguments);
    if placeholders.is_empty() && !uses_arguments && !arguments.trim().is_empty() {
        expanded.push_str("\n\n");
        expanded.push_str(arguments);
    }
    expanded.trim().to_string()
}

fn argument_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)"#)
            .expect("static DevEco Code argument regex must compile")
    })
}

fn placeholder_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"\$(\d+)").expect("static placeholder regex must compile"))
}

fn shell_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"!`[^`]+`").expect("static shell regex must compile"))
}

fn file_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?:^|[^\w`])@(\.?[^\s`,.]*(?:\.[^\s`,.]+)*)")
            .expect("static file reference regex must compile")
    })
}

fn literal_file_references(template: &str) -> Vec<String> {
    let mut seen = BTreeSet::new();
    file_regex()
        .captures_iter(template)
        .filter_map(|capture| capture.get(1).map(|value| value.as_str()))
        .filter(|path| !is_dynamic_file_reference(path))
        .filter_map(|path| normalize_workspace_relative_path(path).ok())
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

fn file_reference_capabilities(template: &str) -> Vec<String> {
    let mut capabilities = Vec::new();
    for path in file_regex()
        .captures_iter(template)
        .filter_map(|capture| capture.get(1).map(|value| value.as_str()))
    {
        if is_dynamic_file_reference(path) {
            capabilities.push("command.file_reference.dynamic".to_string());
        } else if normalize_workspace_relative_path(path).is_err() {
            capabilities.push("command.file_reference.unsafe_path".to_string());
        }
    }
    capabilities
}

fn is_dynamic_file_reference(path: &str) -> bool {
    path.contains('$') || path.contains('{') || path.contains('}')
}

fn config_variable_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX
        .get_or_init(|| Regex::new(r"\{(?:env|file):[^}]+\}").expect("valid config variable regex"))
}

fn markdown_frontmatter_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?s)^---\r?\n(.*?)\r?\n---")
            .expect("static Markdown front matter regex must compile")
    })
}

fn markdown_frontmatter_entry_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$")
            .expect("static Markdown front matter entry regex must compile")
    })
}

fn content_version<'a>(entries: impl IntoIterator<Item = (&'a Path, &'a [u8])>) -> String {
    let mut hasher = Sha256::new();
    for (path, content) in entries {
        hasher.update(path.to_string_lossy().as_bytes());
        hasher.update([0]);
        hasher.update(content);
        hasher.update([0]);
    }
    format!("sha256:{}", hex::encode(hasher.finalize()))
}
