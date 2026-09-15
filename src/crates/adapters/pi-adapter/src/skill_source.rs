//! Explicit local settings paths only; packages and pattern expressions are not evaluated.
use openbitfun_product_domains::external_sources::ExternalSourceScope;
use openbitfun_static_hook_support::{read_bounded_file, BoundedFileRead};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

#[derive(Debug)]
pub struct PiSkillRoot {
    pub path: PathBuf,
    pub scope: ExternalSourceScope,
}

#[derive(Debug, Default)]
pub struct PiSkillRootReport {
    pub roots: Vec<PiSkillRoot>,
    pub diagnostics: Vec<(String, String)>,
}

pub struct PiSkillRootProvider {
    pub agent_dir: PathBuf,
    pub home_dir: Option<PathBuf>,
}

impl Default for PiSkillRootProvider {
    fn default() -> Self {
        Self {
            agent_dir: crate::PiHookProviderOptions::default().agent_dir,
            home_dir: dirs::home_dir(),
        }
    }
}

impl PiSkillRootProvider {
    pub fn discover(&self, workspace: Option<&Path>) -> PiSkillRootReport {
        let mut report = PiSkillRootReport::default();
        let mut layers = vec![(self.agent_dir.clone(), ExternalSourceScope::UserGlobal)];
        if let Some(workspace) = workspace {
            layers.push((workspace.join(".pi"), ExternalSourceScope::Project));
        }
        let mut seen = BTreeSet::new();
        for (base, scope) in layers {
            let settings = base.join("settings.json");
            let mut diagnose = |message: &str| {
                if report.diagnostics.len() < 66 {
                    report
                        .diagnostics
                        .push((settings.to_string_lossy().into_owned(), message.into()));
                }
            };
            if !base.is_absolute() {
                diagnose("Pi configuration directory must be absolute");
                continue;
            }
            let bytes = match read_bounded_file(&settings, 1024 * 1024) {
                Ok(BoundedFileRead::Content(bytes)) => bytes,
                Ok(BoundedFileRead::TooLarge) => {
                    diagnose("Pi settings exceed the size limit");
                    continue;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => {
                    diagnose("Cannot read Pi settings");
                    continue;
                }
            };
            let value: serde_json::Value = match serde_json::from_slice(&bytes) {
                Ok(serde_json::Value::Object(value)) => value.into(),
                _ => {
                    diagnose("Pi settings must be a JSON object");
                    continue;
                }
            };
            let paths = match value.get("skills") {
                None => continue,
                Some(serde_json::Value::Array(paths)) => paths,
                _ => {
                    diagnose("Pi skills must be an array of local paths");
                    continue;
                }
            };
            if paths.len() > 64 {
                diagnose("Pi configured skill path limit exceeded; only the first 64 entries are inspected");
            }
            for value in paths.iter().take(64) {
                let Some(value) = value.as_str().filter(|value| !value.trim().is_empty()) else {
                    diagnose("Pi skill path must be a non-empty string");
                    continue;
                };
                if value.contains("://")
                    || value.starts_with("npm:")
                    || value.starts_with("git:")
                    || value.starts_with('!')
                    || value.contains(['*', '?', '[', ']', '{', '}'])
                {
                    diagnose("Pi skill packages, URLs, and path patterns are not supported by explicit local discovery");
                    continue;
                }
                let path = if value == "~" || value.starts_with("~/") || value.starts_with("~\\") {
                    let Some(home) = self.home_dir.as_ref() else {
                        diagnose("Cannot resolve the home directory for a Pi skill path");
                        continue;
                    };
                    home.join(value.get(2..).unwrap_or_default())
                } else {
                    base.join(value)
                };
                let path = match std::fs::canonicalize(&path) {
                    Ok(path) => path,
                    Err(_) => {
                        diagnose("Configured Pi skill path is missing or unreadable");
                        continue;
                    }
                };
                if !path.is_dir()
                    && !(path.is_file() && path.extension().is_some_and(|ext| ext == "md"))
                {
                    diagnose("Configured Pi skill path must be a directory or Markdown file");
                    continue;
                }
                if seen.insert(path.clone()) {
                    report.roots.push(PiSkillRoot { path, scope });
                }
            }
        }
        report
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resolves_each_settings_directory_and_preserves_valid_paths_after_errors() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        let agent_dir = home.join("custom-agent");
        let project = temp.path().join("project");
        std::fs::create_dir_all(agent_dir.join("extra")).unwrap();
        std::fs::create_dir_all(project.join(".pi")).unwrap();
        std::fs::create_dir_all(project.join("skills")).unwrap();
        std::fs::write(home.join("single.md"), "single").unwrap();
        std::fs::write(agent_dir.join("settings.json"), r#"{"skills":["extra","~/single.md","extra","missing","https://secret@example.test/path","*.md",42]}"#).unwrap();
        std::fs::write(
            project.join(".pi/settings.json"),
            r#"{"skills":["../skills"]}"#,
        )
        .unwrap();
        let report = PiSkillRootProvider {
            agent_dir,
            home_dir: Some(home.clone()),
        }
        .discover(Some(&project));
        assert_eq!(report.roots.len(), 3);
        assert_eq!(report.roots[0].scope, ExternalSourceScope::UserGlobal);
        assert_eq!(
            report.roots[1].path,
            std::fs::canonicalize(home.join("single.md")).unwrap()
        );
        assert_eq!(
            report.roots[2].path,
            std::fs::canonicalize(project.join("skills")).unwrap()
        );
        assert_eq!(report.roots[2].scope, ExternalSourceScope::Project);
        assert_eq!(report.diagnostics.len(), 4);
        assert!(!format!("{:?}", report.diagnostics).contains("secret"));
    }

    #[test]
    fn reports_bad_settings_without_hiding_the_other_scope() {
        let temp = tempfile::tempdir().unwrap();
        let agent_dir = temp.path().join("agent");
        let project = temp.path().join("project");
        std::fs::create_dir_all(&agent_dir).unwrap();
        std::fs::create_dir_all(project.join(".pi/extra")).unwrap();
        std::fs::write(agent_dir.join("settings.json"), "invalid").unwrap();
        std::fs::write(project.join(".pi/settings.json"), r#"{"skills":["extra"]}"#).unwrap();
        let provider = PiSkillRootProvider {
            agent_dir,
            home_dir: None,
        };
        let report = provider.discover(Some(&project));
        assert_eq!(report.roots.len(), 1);
        assert_eq!(report.diagnostics.len(), 1);
        std::fs::write(provider.agent_dir.join("settings.json"), "{}").unwrap();
        assert!(provider.discover(Some(&project)).diagnostics.is_empty());
    }
}
