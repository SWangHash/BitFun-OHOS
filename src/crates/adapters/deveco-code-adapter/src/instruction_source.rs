use bitfun_services_core::bounded_fs::{
    collect_bounded_regular_files_with_prune, BoundedDirectoryWalkError, BoundedDirectoryWalkLimits,
};
use bitfun_services_core::local_instructions::{
    local_instruction_path_exists, read_local_instruction_file, LocalInstructionFile,
    LocalInstructionFiles, MAX_LOCAL_INSTRUCTION_FILES,
};
use globset::{GlobBuilder, GlobMatcher};
use serde_json::Value;
use std::path::{Component, Path, PathBuf};

use crate::local_source_paths::{
    find_project_root, local_source_plan, project_asset_directories, DevEcoCodeLocalConfigOptions,
    LocalConfigDocument, LocalConfigDocumentKind, LocalSourcePlanItem,
};
use bitfun_services_core::bounded_fs::BoundedTextRead;
use bitfun_services_core::jsonc::strip_jsonc;

#[derive(Debug, Clone)]
pub struct DevEcoCodeInstructionSourceOptions {
    pub config: DevEcoCodeLocalConfigOptions,
    pub home_dir: Option<PathBuf>,
    pub workspace_root: Option<PathBuf>,
    pub display_root: String,
}

impl DevEcoCodeInstructionSourceOptions {
    pub fn from_environment() -> Self {
        let home_dir = dirs::home_dir().filter(|path| path.is_absolute());
        let display_root = match std::env::var_os("XDG_CONFIG_HOME") {
            Some(value) => {
                let path = PathBuf::from(value);
                if path.is_absolute() {
                    "$XDG_CONFIG_HOME/deveco".to_string()
                } else {
                    ".config/deveco".to_string()
                }
            }
            None => "~/.config/deveco".to_string(),
        };
        Self {
            config: DevEcoCodeLocalConfigOptions::from_environment(),
            home_dir,
            workspace_root: None,
            display_root,
        }
    }
}

impl Default for DevEcoCodeInstructionSourceOptions {
    fn default() -> Self {
        Self::from_environment()
    }
}

pub fn load_deveco_user_instructions(
    options: &DevEcoCodeInstructionSourceOptions,
) -> Result<Vec<LocalInstructionFile>, String> {
    if !options.config.ordinary_cli_sources_enabled {
        return Err(crate::local_source_paths::UNSUPPORTED_RUNTIME.into());
    }
    let config_dir = &options.config.user_config_dir;
    if !config_dir.is_absolute() {
        return Ok(Vec::new());
    }
    let mut files = LocalInstructionFiles::default();
    let agents_path = config_dir.join("AGENTS.md");
    if local_instruction_path_exists(&agents_path)? {
        files.extend(read_local_instruction_file(
            &agents_path,
            config_dir,
            format!("{}/AGENTS.md", options.display_root),
        )?);
    }

    let mut configured_instructions = None;
    for item in local_source_plan(&options.config, options.workspace_root.as_deref(), None) {
        let LocalSourcePlanItem::Config(document) = item else {
            continue;
        };
        let value = read_instruction_config(&document)?;
        if let Some(value) = value.get("instructions") {
            let instructions = value
                .as_array()
                .ok_or_else(|| "DevEco Code config instructions must be an array".to_string())?;
            let instructions = instructions
                .iter()
                .map(|value| {
                    value.as_str().map(str::to_string).ok_or_else(|| {
                        "DevEco Code config instructions must contain strings".to_string()
                    })
                })
                .collect::<Result<Vec<_>, _>>()?;
            if document.kind == LocalConfigDocumentKind::User {
                // DevEco Code's three global files form one layer, so a later
                // global file replaces this array. Subsequent local sources
                // use the cross-layer merge that appends unique instructions.
                configured_instructions = Some(instructions);
            } else {
                let effective = configured_instructions.get_or_insert_default();
                for instruction in instructions {
                    if !effective.contains(&instruction) {
                        effective.push(instruction);
                    }
                }
            }
        }
    }

    if let Some(configured_instructions) = configured_instructions {
        for raw in configured_instructions
            .into_iter()
            .take(MAX_LOCAL_INSTRUCTION_FILES)
        {
            if raw.starts_with("http://") || raw.starts_with("https://") {
                continue;
            }
            if let Some(relative) = raw.strip_prefix("~/") {
                let Some(home_dir) = options.home_dir.as_deref() else {
                    continue;
                };
                append_configured_path(&mut files, home_dir, relative, "~")?;
                continue;
            }
            let path = Path::new(&raw);
            if path.is_absolute() {
                if has_glob_meta(&raw) {
                    let Some((root, pattern)) = split_absolute_glob(path) else {
                        continue;
                    };
                    append_configured_path(&mut files, &root, &pattern, "<configured-path>")?;
                    continue;
                }
                let Some(parent) = path.parent() else {
                    continue;
                };
                let file_name = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("instruction");
                if let Some(file) = read_local_instruction_file(
                    path,
                    parent,
                    format!("<configured-path>/{file_name}"),
                )? {
                    files.push(file);
                }
                continue;
            }
            append_relative_configured_path(&mut files, options, &raw)?;
        }
    }
    Ok(files.into_files())
}

fn append_relative_configured_path(
    files: &mut LocalInstructionFiles,
    options: &DevEcoCodeInstructionSourceOptions,
    raw: &str,
) -> Result<(), String> {
    if !options.config.project_config_enabled {
        return append_configured_path(
            files,
            &options.config.user_config_dir,
            raw,
            &options.display_root,
        );
    }
    let Some(workspace_root) = options.workspace_root.as_deref() else {
        return Ok(());
    };
    let project_root = find_project_root(workspace_root);
    for directory in project_asset_directories(&project_root, workspace_root) {
        append_configured_path(files, &directory, raw, "<workspace>")?;
        if files.is_at_capacity() {
            break;
        }
    }
    Ok(())
}

fn read_instruction_config(document: &LocalConfigDocument) -> Result<Value, String> {
    let content = match document
        .read_bounded(bitfun_services_core::local_instructions::MAX_LOCAL_INSTRUCTION_FILE_BYTES)
        .map_err(|error| format!("Failed to read DevEco Code config: {error}"))?
    {
        BoundedTextRead::Content(content) => content,
        BoundedTextRead::TooLarge => {
            return Err("DevEco Code config exceeds the 1 MiB compatibility limit".to_string())
        }
        BoundedTextRead::InvalidUtf8 => {
            return Err("DevEco Code config must be valid UTF-8".to_string())
        }
    };
    serde_json::from_str::<Value>(&strip_jsonc(&content))
        .map_err(|error| format!("Failed to parse DevEco Code config: {error}"))
}

fn append_configured_path(
    files: &mut LocalInstructionFiles,
    root: &Path,
    raw: &str,
    display_root: &str,
) -> Result<(), String> {
    if files.is_at_capacity() {
        return Ok(());
    }
    let Some(normalized) = normalize_relative_pattern(raw) else {
        return Ok(());
    };
    if !has_glob_meta(&normalized) {
        if let Some(file) = read_local_instruction_file(
            &root.join(&normalized),
            root,
            format!("{display_root}/{}", normalized.replace('\\', "/")),
        )? {
            files.push(file);
        }
        return Ok(());
    }

    let matcher = GlobBuilder::new(&normalized.replace('\\', "/"))
        .literal_separator(true)
        .backslash_escape(false)
        .build()
        .map_err(|error| format!("Invalid DevEco Code instruction glob {raw}: {error}"))?
        .compile_matcher();
    let prefix = glob_static_prefix(&normalized);
    let scan_root = if prefix.as_os_str().is_empty() {
        root.to_path_buf()
    } else {
        root.join(prefix)
    };
    let directory_matchers = glob_directory_matchers(&normalized)
        .map_err(|error| format!("Invalid DevEco Code instruction glob {raw}: {error}"))?;
    let prune_root = root.to_path_buf();
    let matches = match collect_bounded_regular_files_with_prune(
        &scan_root,
        BoundedDirectoryWalkLimits {
            max_depth: 32,
            max_entries: 4096,
            max_directories: 1024,
            max_files: 4096,
        },
        |path| {
            should_descend_instruction_glob(path)
                && directory_matchers.as_ref().map_or(true, |matchers| {
                    path.strip_prefix(&prune_root).ok().is_some_and(|relative| {
                        let depth = relative.components().count();
                        matchers
                            .get(depth.saturating_sub(1))
                            .is_some_and(|matcher| {
                                matcher.is_match(relative.to_string_lossy().replace('\\', "/"))
                            })
                    })
                })
        },
        |path| {
            path.strip_prefix(root).ok().is_some_and(|relative| {
                matcher.is_match(relative.to_string_lossy().replace('\\', "/"))
            })
        },
    ) {
        Ok(matches) => matches,
        Err(BoundedDirectoryWalkError::LimitExceeded(_)) => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Failed to expand DevEco Code instruction glob {raw}: {error}"
            ));
        }
    };
    for path in matches {
        let relative = path
            .strip_prefix(root)
            .expect("bounded glob result stays below its root")
            .to_string_lossy()
            .replace('\\', "/");
        if let Some(file) =
            read_local_instruction_file(&path, root, format!("{display_root}/{relative}"))?
        {
            files.push(file);
        }
        if files.is_at_capacity() {
            break;
        }
    }
    Ok(())
}

fn should_descend_instruction_glob(path: &Path) -> bool {
    !path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| matches!(name, ".git" | ".hg" | ".svn" | "node_modules" | "target"))
}

fn split_absolute_glob(path: &Path) -> Option<(PathBuf, String)> {
    let mut root = PathBuf::new();
    let mut pattern = Vec::new();
    let mut found_glob = false;
    for component in path.components() {
        let value = component.as_os_str().to_string_lossy();
        if found_glob || has_glob_meta(&value) {
            found_glob = true;
            pattern.push(value.into_owned());
        } else {
            root.push(component.as_os_str());
        }
    }
    (found_glob && !root.as_os_str().is_empty()).then(|| (root, pattern.join("/")))
}

fn normalize_relative_pattern(raw: &str) -> Option<String> {
    let path = Path::new(raw.trim());
    if path.as_os_str().is_empty()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return None;
    }
    Some(
        path.components()
            .filter_map(|component| match component {
                Component::Normal(value) => Some(value.to_string_lossy()),
                Component::CurDir => None,
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("/"),
    )
}

fn has_glob_meta(value: &str) -> bool {
    value.contains(['*', '?', '[', '{'])
}

fn glob_static_prefix(pattern: &str) -> PathBuf {
    pattern
        .split('/')
        .take_while(|component| !has_glob_meta(component))
        .collect()
}

fn glob_directory_matchers(pattern: &str) -> Result<Option<Vec<GlobMatcher>>, globset::Error> {
    let components = pattern.split('/').collect::<Vec<_>>();
    let directory_components = &components[..components.len().saturating_sub(1)];
    if directory_components
        .iter()
        .any(|component| component.contains("**"))
    {
        return Ok(None);
    }
    let mut prefix = Vec::new();
    let mut matchers = Vec::with_capacity(directory_components.len());
    for component in directory_components {
        prefix.push(*component);
        matchers.push(
            GlobBuilder::new(&prefix.join("/"))
                .literal_separator(true)
                .backslash_escape(false)
                .build()?
                .compile_matcher(),
        );
    }
    Ok(Some(matchers))
}
