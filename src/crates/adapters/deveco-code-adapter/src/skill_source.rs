use crate::command_source::strip_jsonc;
use crate::local_source_paths::{
    find_project_root, local_source_plan, DevEcoCodeLocalConfigOptions, LocalConfigDocument,
    LocalSourcePlanItem,
};
use bitfun_product_domains::external_sources::ExternalSourceScope;
use bitfun_services_core::bounded_fs::BoundedTextRead;
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

const MAX_CONFIG_FILE_BYTES: usize = 1024 * 1024;
const MAX_CONFIGURED_SKILL_ROOTS: usize = 64;

#[derive(Debug, Clone)]
pub struct DevEcoCodeSkillRootProviderOptions {
    pub config: DevEcoCodeLocalConfigOptions,
    pub home_dir: Option<PathBuf>,
}

impl DevEcoCodeSkillRootProviderOptions {
    pub fn from_environment() -> Self {
        Self {
            config: DevEcoCodeLocalConfigOptions::from_environment(),
            home_dir: dirs::home_dir(),
        }
    }
}

impl Default for DevEcoCodeSkillRootProviderOptions {
    fn default() -> Self {
        Self::from_environment()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DevEcoCodeConfiguredSkillRoot {
    pub path: PathBuf,
    pub scope: ExternalSourceScope,
    pub precedence: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DevEcoCodeSkillRootDiagnostic {
    pub location: String,
    pub message: String,
}

#[derive(Debug, Default)]
pub struct DevEcoCodeSkillRootReport {
    pub roots: Vec<DevEcoCodeConfiguredSkillRoot>,
    pub diagnostics: Vec<DevEcoCodeSkillRootDiagnostic>,
}

impl DevEcoCodeSkillRootReport {
    fn diagnose(&mut self, location: String, message: &str) {
        if self.diagnostics.len() < MAX_CONFIGURED_SKILL_ROOTS {
            self.diagnostics.push(DevEcoCodeSkillRootDiagnostic {
                location,
                message: message.into(),
            });
        } else if self.diagnostics.len() == MAX_CONFIGURED_SKILL_ROOTS {
            self.diagnostics.push(DevEcoCodeSkillRootDiagnostic {
                location: "DevEco Code skills".into(),
                message: "Additional configured skill root diagnostics were omitted".into(),
            });
        }
    }
}

pub struct DevEcoCodeSkillRootProvider {
    config: DevEcoCodeLocalConfigOptions,
    home_dir: Option<PathBuf>,
}

impl DevEcoCodeSkillRootProvider {
    pub fn new(options: DevEcoCodeSkillRootProviderOptions) -> Self {
        Self {
            config: options.config,
            home_dir: options.home_dir,
        }
    }

    pub fn discover_with_diagnostics(
        &self,
        workspace_root: Option<&Path>,
    ) -> DevEcoCodeSkillRootReport {
        let mut report = DevEcoCodeSkillRootReport::default();
        if !self.config.ordinary_cli_sources_enabled {
            report.diagnose(
                "DevEco Code runtime mode".into(),
                crate::local_source_paths::UNSUPPORTED_RUNTIME,
            );
            return report;
        }
        if let Some(config) = &self.config.explicit_config_file {
            let resolved = if config.is_absolute() {
                Some(config.clone())
            } else {
                workspace_root.map(|root| root.join(config))
            };
            if resolved.as_ref().is_none_or(|path| !path.is_file()) {
                report.diagnose(
                    "DEVECO_CONFIG".into(),
                    "Explicit configuration file is missing, unreadable, or cannot be resolved",
                );
            }
        }
        let canonical_workspace = workspace_root
            .map(find_project_root)
            .and_then(|path| dunce::canonicalize(path).ok());
        let canonical_home = self
            .home_dir
            .as_deref()
            .and_then(|path| dunce::canonicalize(path).ok());
        let mut configured_paths = Vec::new();
        let mut effective_paths = None;
        let mut precedence = 0usize;

        for item in local_source_plan(&self.config, workspace_root, None) {
            let document = match item {
                LocalSourcePlanItem::Config(document) => document,
                LocalSourcePlanItem::Directory(directory) => {
                    for name in ["skill", "skills"] {
                        let path = directory.path.join(name);
                        if path.is_dir() {
                            configured_paths.push((
                                path.to_string_lossy().into_owned(),
                                directory.scope,
                                precedence,
                                directory.path.to_string_lossy().into_owned(),
                            ));
                            precedence = precedence.saturating_add(1);
                        }
                    }
                    continue;
                }
            };
            let paths = match read_local_skill_paths(&document, &mut report) {
                Ok(paths) => paths,
                Err(message) => {
                    report.diagnose(document.location(), message);
                    continue;
                }
            };
            if let Some(paths) = paths {
                effective_paths = Some((paths, document.scope, document.location()));
            }
        }

        // V1 merges the paths array by replacement, then scans the final array
        // after all native configuration directories have been inspected.
        if let Some((paths, scope, location)) = effective_paths {
            for value in paths {
                let current_precedence = precedence;
                precedence = precedence.saturating_add(1);
                configured_paths.push((value, scope, current_precedence, location.clone()));
            }
        }

        if configured_paths.len() > MAX_CONFIGURED_SKILL_ROOTS {
            report.diagnose(
                "DevEco Code skills".into(),
                "Configured skill root limit exceeded; only the latest 64 entries are inspected",
            );
        }
        let mut contributions = Vec::new();
        for (value, source_scope, current_precedence, location) in configured_paths
            .into_iter()
            .rev()
            .take(MAX_CONFIGURED_SKILL_ROOTS)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
        {
            let Some(path) =
                resolve_configured_path(&value, workspace_root, self.home_dir.as_deref())
            else {
                report.diagnose(
                    location,
                    "Configured skill path is invalid or requires a workspace or home directory",
                );
                continue;
            };
            let Ok(path) = dunce::canonicalize(path) else {
                report.diagnose(
                    location,
                    "Configured skill directory is missing or unreadable",
                );
                continue;
            };
            if !path.is_dir() {
                report.diagnose(location, "Configured skill path is not a directory");
                continue;
            }
            let workspace_scoped = canonical_workspace
                .as_ref()
                .is_some_and(|workspace| path.starts_with(workspace));
            let home_scoped = canonical_home
                .as_ref()
                .is_some_and(|home| path.starts_with(home));
            let scope = match source_scope {
                ExternalSourceScope::Project | ExternalSourceScope::WorkspaceLocal
                    if workspace_scoped =>
                {
                    ExternalSourceScope::Project
                }
                ExternalSourceScope::UserGlobal if workspace_scoped => ExternalSourceScope::Project,
                ExternalSourceScope::UserGlobal if home_scoped => ExternalSourceScope::UserGlobal,
                _ => {
                    report.diagnose(
                        location,
                        "Configured skill directory is outside the allowed source boundary",
                    );
                    continue;
                }
            };
            contributions.push(DevEcoCodeConfiguredSkillRoot {
                path,
                scope,
                precedence: current_precedence,
            });
        }

        let mut seen = BTreeSet::new();
        let mut unique = contributions
            .into_iter()
            .rev()
            .filter(|root| seen.insert(root.path.clone()))
            .collect::<Vec<_>>();
        unique.reverse();
        report.roots = unique;
        report
    }
}

impl Default for DevEcoCodeSkillRootProvider {
    fn default() -> Self {
        Self::new(DevEcoCodeSkillRootProviderOptions::default())
    }
}

fn read_local_skill_paths(
    document: &LocalConfigDocument,
    report: &mut DevEcoCodeSkillRootReport,
) -> Result<Option<Vec<String>>, &'static str> {
    let content = match document
        .read_bounded(MAX_CONFIG_FILE_BYTES)
        .map_err(|_| "Cannot read DevEco Code configuration")?
    {
        BoundedTextRead::Content(content) => content,
        BoundedTextRead::TooLarge => {
            return Err("DevEco Code configuration exceeds the size limit")
        }
        BoundedTextRead::InvalidUtf8 => return Err("DevEco Code configuration is not UTF-8"),
    };
    let value = serde_json::from_str::<Value>(&strip_jsonc(&content))
        .map_err(|_| "DevEco Code configuration is not valid JSON/JSONC")?;
    if !value.is_object() {
        return Err("DevEco Code configuration must be an object");
    }
    let paths = match value.get("skills") {
        None => return Ok(None),
        Some(Value::Object(skills)) => {
            if skills
                .get("urls")
                .is_some_and(|urls| urls.as_array().is_none_or(|urls| !urls.is_empty()))
            {
                report.diagnose(
                    document.location(),
                    "Remote skill URLs are not supported by static discovery",
                );
            }
            let Some(paths) = skills.get("paths") else {
                return Ok(None);
            };
            strict_string_array(Some(paths))
        }
        Some(Value::Array(skills)) => skills.iter().map(Value::as_str).collect(),
        _ => None,
    }
    .ok_or("Configured skill paths must be an array of strings")?;
    Ok(Some(
        paths
            .into_iter()
            .filter_map(|path| {
                if is_remote_url(path.trim()) {
                    report.diagnose(
                        document.location(),
                        "Remote skill URLs are not supported by static discovery",
                    );
                    None
                } else {
                    Some(path.to_string())
                }
            })
            .collect(),
    ))
}

fn strict_string_array(value: Option<&Value>) -> Option<Vec<&str>> {
    let Some(value) = value else {
        return Some(Vec::new());
    };
    value.as_array()?.iter().map(Value::as_str).collect()
}

fn is_remote_url(value: &str) -> bool {
    url::Url::parse(value).is_ok_and(|url| matches!(url.scheme(), "http" | "https"))
}

fn resolve_configured_path(
    value: &str,
    workspace_root: Option<&Path>,
    home_dir: Option<&Path>,
) -> Option<PathBuf> {
    let value = value.trim();
    if value.is_empty() || is_remote_url(value) || value.contains('\0') {
        return None;
    }
    if let Some(relative) = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
    {
        return home_dir.map(|home| home.join(relative));
    }
    let path = PathBuf::from(value);
    if path.is_absolute() {
        Some(path)
    } else {
        workspace_root.map(|workspace| workspace.join(path))
    }
}
