//! External-source composition for local user instruction adapters.

use openbitfun_claude_code_adapter::{
    load_claude_code_user_instructions, ClaudeCodeInstructionSourceOptions,
};
use openbitfun_codex_adapter::{load_codex_user_instructions, CodexInstructionSourceOptions};
use openbitfun_opencode_adapter::{
    load_opencode_user_instructions, OpenCodeInstructionSourceOptions,
};
use openbitfun_services_core::local_instructions::{LocalInstructionFile, LocalInstructionFiles};
use std::path::Path;

pub(crate) struct LocalUserInstructionFiles {
    pub(crate) files: Vec<LocalInstructionFile>,
    pub(crate) cacheable: bool,
}

pub(crate) async fn load_local_user_instruction_files(
    workspace_root: &Path,
) -> LocalUserInstructionFiles {
    let mut sources = load_local_user_instruction_sources(workspace_root).await;
    sources.files.retain(|file| file.path_patterns.is_empty());
    sources
}

pub(crate) async fn load_local_user_instruction_sources(
    workspace_root: &Path,
) -> LocalUserInstructionFiles {
    load_user_sources(Some(workspace_root)).await.0
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstructionSourceEntry {
    pub ecosystem_id: String,
    pub name: String,
    pub path: String,
    pub scope: String,
    pub path_patterns: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstructionSourceCatalog {
    pub schema_version: u32,
    pub entries: Vec<InstructionSourceEntry>,
    pub failed_ecosystems: Vec<String>,
}

async fn load_user_sources(
    workspace_root: Option<&Path>,
) -> (LocalUserInstructionFiles, InstructionSourceCatalog) {
    let workspace_root = workspace_root.map(Path::to_path_buf);
    let result = tokio::task::spawn_blocking(move || {
        let mut files = Vec::new();
        let mut origins = std::collections::HashMap::new();
        let mut failed_ecosystems = Vec::new();
        let mut opencode_options = OpenCodeInstructionSourceOptions::from_environment();
        opencode_options.workspace_root = workspace_root.clone();
        let canonical_workspace = workspace_root.as_deref().and_then(|root| std::fs::canonicalize(root).ok());
        for (ecosystem, result) in [
            ("opencode", load_opencode_user_instructions(&opencode_options)),
            ("codex", load_codex_user_instructions(&CodexInstructionSourceOptions::from_environment())),
            ("claude-code", load_claude_code_user_instructions(&ClaudeCodeInstructionSourceOptions::from_environment())),
        ] {
            match result {
                Ok(source_files) => {
                    for file in &source_files {
                        origins.entry(file.canonical_path.clone()).or_insert(ecosystem);
                    }
                    files.extend(source_files);
                }
                Err(_) => {
                    failed_ecosystems.push(ecosystem.to_string());
                    log::warn!("Failed to load {ecosystem} user instructions; retrying on the next message");
                }
            }
        }
        deduplicate_user_instruction_files(&mut files);
        let entries = files.iter().map(|file| InstructionSourceEntry {
            ecosystem_id: origins[&file.canonical_path].into(),
            name: file.name.clone(),
            path: file.canonical_path.to_string_lossy().into_owned(),
            scope: if canonical_workspace.as_ref().is_some_and(|root| file.canonical_path.starts_with(root)) { "project" } else { "user" }.into(),
            path_patterns: file.path_patterns.clone(),
        }).collect();
        (LocalUserInstructionFiles { files, cacheable: failed_ecosystems.is_empty() },
            InstructionSourceCatalog { schema_version: 1, entries, failed_ecosystems })
    }).await;
    result.unwrap_or_else(|_| {
        log::warn!("Failed to join local instruction discovery; retrying on the next message");
        (
            LocalUserInstructionFiles {
                files: Vec::new(),
                cacheable: false,
            },
            InstructionSourceCatalog {
                schema_version: 1,
                entries: Vec::new(),
                failed_ecosystems: vec!["opencode".into(), "codex".into(), "claude-code".into()],
            },
        )
    })
}

/// Read-only inventory; it does not claim these documents were injected into a
/// particular session or turn. No instruction body crosses this boundary.
pub async fn instruction_source_catalog(workspace_root: Option<&Path>) -> InstructionSourceCatalog {
    let (user, mut catalog) = load_user_sources(workspace_root).await;
    if let Some(root) = workspace_root {
        match openbitfun_services_core::workspace_instructions::read_workspace_instruction_source_catalog(root).await {
            Ok(report) => {
                catalog.failed_ecosystems.extend(report.incomplete_ecosystems.into_iter().map(str::to_string));
                let mut seen = user.files.iter().map(|file| file.canonical_path.clone()).collect::<std::collections::HashSet<_>>();
                for source in report.sources {
                    let path = root.join(&source.file.name);
                    if let Ok(canonical) = std::fs::canonicalize(&path) {
                        if !seen.insert(canonical) { continue; }
                    }
                    catalog.entries.push(InstructionSourceEntry {
                        ecosystem_id: source.ecosystem_id.into(),
                        name: source.file.name,
                        path: path.to_string_lossy().into_owned(),
                        scope: "project".into(),
                        path_patterns: source.file.path_patterns,
                    });
                }
            }
            Err(_) => { catalog.failed_ecosystems.push("shared".into()); }
        }
    }
    catalog
}

pub(crate) async fn load_local_user_conditional_instruction_sources() -> Vec<LocalInstructionFile> {
    match tokio::task::spawn_blocking(|| {
        load_claude_code_user_instructions(&ClaudeCodeInstructionSourceOptions::from_environment())
            .map(|files| {
                files
                    .into_iter()
                    .filter(|file| !file.path_patterns.is_empty())
                    .collect()
            })
    })
    .await
    {
        Ok(Ok(files)) => files,
        Ok(Err(error)) => {
            log::warn!(
                "Failed to load Claude Code conditional instructions; retrying after a later matching read: {error}"
            );
            Vec::new()
        }
        Err(error) => {
            log::warn!(
                "Failed to join Claude Code conditional instruction discovery; retrying after a later matching read: {error}"
            );
            Vec::new()
        }
    }
}

fn deduplicate_user_instruction_files(files: &mut Vec<LocalInstructionFile>) {
    let mut bounded = LocalInstructionFiles::default();
    bounded.extend(std::mem::take(files));
    *files = bounded.into_files();
}

#[cfg(test)]
mod tests {
    use super::deduplicate_user_instruction_files;
    use openbitfun_services_core::local_instructions::LocalInstructionFile;
    use std::path::PathBuf;

    #[test]
    fn merged_user_sources_keep_first_identity_and_enforce_the_shared_file_budget() {
        let mut files = (0..257)
            .map(|index| LocalInstructionFile {
                canonical_path: PathBuf::from(format!("source-{index}.md")),
                name: format!("source-{index}.md"),
                content: format!("instruction {index}"),
                path_patterns: Vec::new(),
            })
            .collect::<Vec<_>>();
        files.insert(
            1,
            LocalInstructionFile {
                canonical_path: PathBuf::from("source-0.md"),
                name: "duplicate.md".to_string(),
                content: "duplicate must lose".to_string(),
                path_patterns: Vec::new(),
            },
        );

        deduplicate_user_instruction_files(&mut files);

        assert_eq!(files.len(), 256);
        assert_eq!(files[0].name, "source-0.md");
        assert!(!files.iter().any(|file| file.name == "duplicate.md"));
    }

    #[tokio::test]
    async fn catalog_reuses_reader_precedence_and_projects_scope_without_contents() {
        use super::test_support::{lock_environment, EnvironmentGuard};
        let _environment = lock_environment();
        let temp = tempfile::tempdir().unwrap();
        let workspace = temp.path().join("workspace");
        let xdg = temp.path().join("xdg");
        let codex = temp.path().join("codex");
        let claude = temp.path().join("claude");
        for dir in [
            xdg.join("opencode"),
            codex.clone(),
            claude.clone(),
            workspace.join(".claude/rules"),
        ] {
            std::fs::create_dir_all(dir).unwrap();
        }
        std::fs::write(codex.join("AGENTS.md"), "obsolete body").unwrap();
        std::fs::write(codex.join("AGENTS.override.md"), "private override body").unwrap();
        std::fs::write(workspace.join("AGENTS.md"), "shared instructions").unwrap();
        std::fs::write(
            workspace.join("CLAUDE.md"),
            "@project-guide.md\nClaude instructions",
        )
        .unwrap();
        std::fs::write(workspace.join("project-guide.md"), "Imported instructions").unwrap();
        std::fs::write(
            workspace.join(".claude/rules/conditional.md"),
            "---\npaths: [\"src/**/*.rs\"]\n---\nPrivate rule body",
        )
        .unwrap();
        std::fs::write(
            workspace.join("opencode.json"),
            r#"{"instructions":["guide.md"]}"#,
        )
        .unwrap();
        std::fs::write(workspace.join("guide.md"), "Configured instructions").unwrap();
        let _guard = EnvironmentGuard::set(&[
            ("XDG_CONFIG_HOME", &xdg),
            ("CODEX_HOME", &codex),
            ("CLAUDE_CONFIG_DIR", &claude),
        ]);
        let catalog = super::instruction_source_catalog(Some(&workspace)).await;
        assert!(catalog.failed_ecosystems.is_empty());
        let codex_entry = catalog
            .entries
            .iter()
            .find(|entry| entry.ecosystem_id == "codex")
            .unwrap();
        assert!(codex_entry.path.ends_with("AGENTS.override.md"));
        assert_eq!(codex_entry.scope, "user");
        let shared = catalog
            .entries
            .iter()
            .find(|entry| entry.ecosystem_id == "shared")
            .unwrap();
        assert_eq!(shared.name, "AGENTS.md");
        let conditional = catalog
            .entries
            .iter()
            .find(|entry| !entry.path_patterns.is_empty())
            .unwrap();
        assert_eq!(conditional.ecosystem_id, "claude-code");
        assert_eq!(conditional.scope, "project");
        assert_eq!(conditional.path_patterns, ["src/**/*.rs"]);
        assert!(catalog
            .entries
            .iter()
            .any(|entry| entry.name == "project-guide.md" && entry.ecosystem_id == "claude-code"));
        assert!(catalog
            .entries
            .iter()
            .any(|entry| entry.path.ends_with("guide.md")
                && entry.ecosystem_id == "opencode"
                && entry.scope == "project"));
        let serialized = serde_json::to_string(&catalog).unwrap();
        assert!(!serialized.contains("private override body"));
        assert!(!serialized.contains("Private rule body"));
        assert!(!serialized.contains("obsolete body"));
        std::fs::write(workspace.join("opencode.json"), "invalid").unwrap();
        let partial = super::instruction_source_catalog(Some(&workspace)).await;
        assert!(partial.failed_ecosystems.iter().any(|id| id == "opencode"));
        assert!(partial
            .entries
            .iter()
            .any(|entry| entry.ecosystem_id == "shared"));
        std::fs::remove_file(codex.join("AGENTS.override.md")).unwrap();
        let refreshed = super::instruction_source_catalog(Some(&workspace)).await;
        assert!(refreshed
            .entries
            .iter()
            .any(|entry| entry.ecosystem_id == "codex" && entry.path.ends_with("AGENTS.md")));
    }

    #[test]
    fn merged_user_sources_enforce_the_shared_total_byte_budget() {
        let mut files = (0..3)
            .map(|index| LocalInstructionFile {
                canonical_path: PathBuf::from(format!("large-{index}.md")),
                name: format!("large-{index}.md"),
                content: "x".repeat(1024 * 1024),
                path_patterns: Vec::new(),
            })
            .collect::<Vec<_>>();

        deduplicate_user_instruction_files(&mut files);

        assert_eq!(files.len(), 2);
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::ffi::OsString;
    use std::path::Path;
    use std::sync::{Mutex, MutexGuard, OnceLock};

    static ENVIRONMENT: OnceLock<Mutex<()>> = OnceLock::new();

    pub(crate) fn lock_environment() -> MutexGuard<'static, ()> {
        ENVIRONMENT
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("instruction environment lock")
    }

    pub(crate) struct EnvironmentGuard {
        values: Vec<(&'static str, Option<OsString>)>,
    }

    impl EnvironmentGuard {
        pub(crate) fn set(values: &[(&'static str, &Path)]) -> Self {
            let previous = values
                .iter()
                .map(|(name, value)| {
                    let previous = std::env::var_os(name);
                    std::env::set_var(name, value);
                    (*name, previous)
                })
                .collect();
            Self { values: previous }
        }
    }

    impl Drop for EnvironmentGuard {
        fn drop(&mut self) {
            for (name, value) in self.values.drain(..) {
                match value {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
    }
}
