use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    Prompt,
    Scan,
}

pub fn prompt_paths(resolved: Option<&Value>) -> HashMap<String, Vec<String>> {
    let mut paths: HashMap<String, Vec<String>> = HashMap::new();
    let Some(resolved) = resolved.and_then(Value::as_object) else {
        return paths;
    };
    for field in bitfun_product_domains::qt_migration::QT_MIGRATION_INTAKE_REQUIRED_FIELDS {
        let Some(path) = resolved
            .get(field)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|path| !path.is_empty())
        else {
            continue;
        };
        paths
            .entry(field.to_string())
            .or_default()
            .push(path.to_string());
    }
    paths
}

pub fn normalize(workspace: Option<&Path>, raw: &str) -> Option<PathBuf> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    match workspace {
        Some(workspace) => crate::scan::normalize_workspace_candidate(workspace, raw),
        None => Some(PathBuf::from(raw)).filter(|path| path.is_absolute()),
    }
}

fn path_key(workspace: Option<&Path>, raw: &str) -> Option<String> {
    normalize(workspace, raw).map(|path| crate::scan::path_key(&path))
}

pub fn origin(workspace: Option<&Path>, raw: &str, prompt_paths: &[String]) -> Origin {
    let Some(candidate) = path_key(workspace, raw) else {
        return Origin::Scan;
    };
    if prompt_paths
        .iter()
        .any(|path| path_key(workspace, path).as_deref() == Some(candidate.as_str()))
    {
        Origin::Prompt
    } else {
        Origin::Scan
    }
}

pub fn admit(
    field: &str,
    workspace: Option<&Path>,
    raw: &str,
    origin: Origin,
    declared: Option<&str>,
) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() || declared == Some("ledger") {
        return None;
    }
    if raw == crate::state::QT_MIGRATION_OFFICIAL_VALUE {
        return None;
    }
    if field == crate::scan::SESSION_TOOLCHAIN_CANDIDATES_KEY {
        return Some(raw.to_string());
    }
    let Some(path) = normalize(workspace, raw) else {
        return Some(raw.to_string());
    };
    let path = match field {
        "source_project" => project_dir(&path),
        _ => path,
    };
    let admitted = match field {
        "source_project" | "output_project" | "toolchain" | "template"
            if origin == Origin::Prompt =>
        {
            true
        }
        "source_project" => admit_source(&path),
        "output_project" => match workspace {
            Some(workspace) => admit_output(workspace, &path, origin),
            None => true,
        },
        "toolchain" => {
            crate::strategy::toolchain_value_is_measurable(&path.to_string_lossy())
                || crate::scan::bindable_field_container(field, &path.to_string_lossy()).is_some()
        }
        "template" => {
            crate::scan::is_qt_harmonyos_template(&path)
                || crate::scan::bindable_field_container(field, &path.to_string_lossy()).is_some()
        }
        _ => true,
    };
    admitted.then(|| path.to_string_lossy().into_owned())
}

fn project_dir(path: &Path) -> PathBuf {
    let project_file = path.is_file()
        && path
            .extension()
            .map(|extension| extension.eq_ignore_ascii_case("pro"))
            .unwrap_or(false);
    match project_file {
        true => path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| path.to_path_buf()),
        false => path.to_path_buf(),
    }
}

fn admit_source(path: &Path) -> bool {
    if crate::output::is_inside_migrated_harmony_project(path)
        || crate::detect::is_inside_qt_installation(path)
    {
        return false;
    }
    if crate::detect::is_qt_source_project(path) {
        return crate::detect::project_description_fits_directory(path);
    }
    crate::detect::has_qt_project_below(path)
        && crate::detect::project_description_fits_directory(path)
}

fn admit_output(workspace: &Path, path: &Path, origin: Origin) -> bool {
    if !path.is_dir()
        || crate::scan::is_migration_artifact_location(path)
        || crate::output::is_inside_migrated_harmony_project(path)
        || crate::detect::is_inside_qt_installation(path)
        || crate::detect::is_qt_source_project(path)
    {
        return false;
    }
    match origin {
        Origin::Scan => inside_workspace(workspace, path),
        Origin::Prompt => true,
    }
}

fn inside_workspace(workspace: &Path, path: &Path) -> bool {
    let root = crate::scan::normalize_workspace_candidate(workspace, &workspace.to_string_lossy())
        .unwrap_or_else(|| workspace.to_path_buf());
    let root_key = crate::scan::path_key(&root);
    let path_key = crate::scan::path_key(path);
    path_key == root_key || path_key.starts_with(&format!("{root_key}/"))
}
