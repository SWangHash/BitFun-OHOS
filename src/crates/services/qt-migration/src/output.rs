//! Migration output-directory recognition and candidate merging: distinguish
//! the generated HarmonyOS project from Qt source projects and fold scanned
//! output candidates into the card's `output_project` candidate map.

use std::path::{Path, PathBuf};

use crate::detect::is_qt_source_project;
use crate::scan::{
    dedup_paths, is_migration_artifact_location, is_noise_dir, is_qt_harmonyos_template,
    normalize_workspace_candidate, path_key, MAX_OUTPUT_PROJECTS, MAX_PROBE_DEPTH,
    TEMPLATE_MARKER_DIR,
};

pub fn merge_workspace_output_candidates(
    workspace: &Path,
    model_candidates: &[String],
    source_candidates: &[String],
    workspace_output_candidates: &[String],
) -> Vec<String> {
    merge_output_candidates(
        workspace,
        model_candidates,
        source_candidates,
        workspace_output_candidates,
    )
}

pub(crate) fn merge_output_candidates(
    workspace: &Path,
    model_candidates: &[String],
    source_candidates: &[String],
    workspace_output_candidates: &[String],
) -> Vec<String> {
    let mut ranked: Vec<(u8, String)> = Vec::new();
    // Prompt-named candidates rank first (explicit user intent); only real
    // directories qualify, a previous migration result is excluded, and a
    // migrated project is recognized by structure, not location alone.
    // The check also rejects an official template dir as an output target,
    // which is equally unintended by the workflow.
    for candidate in model_candidates {
        let Some(path) = normalize_workspace_candidate(workspace, candidate) else {
            continue;
        };
        if path.is_dir()
            && !is_migration_artifact_location(&path)
            && !is_inside_migrated_harmony_project(&path)
        {
            ranked.push((0, path.to_string_lossy().into_owned()));
        }
    }
    for path in workspace_output_candidates {
        ranked.push((1, path.clone()));
    }
    for path in probe_output_project(workspace) {
        ranked.push((1, path));
    }
    ranked.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| path_key(Path::new(&a.1)).cmp(&path_key(Path::new(&b.1))))
    });
    let mut candidates = ranked.into_iter().map(|(_, p)| p).collect::<Vec<_>>();
    candidates = filter_output_candidates(candidates, source_candidates);
    dedup_paths(&mut candidates);
    candidates.truncate(MAX_OUTPUT_PROJECTS);
    // The current workspace root is the last-resort default.
    if candidates.is_empty() {
        candidates = filter_output_candidates(
            vec![workspace.to_string_lossy().into_owned()],
            source_candidates,
        );
    }
    candidates
}

pub fn filter_output_candidates(
    candidates: Vec<String>,
    source_candidates: &[String],
) -> Vec<String> {
    candidates
        .into_iter()
        .filter(|candidate| {
            let path = Path::new(candidate);
            !is_qt_source_project(path)
                && !source_candidates
                    .iter()
                    .any(|source| path_key(Path::new(source)) == path_key(path))
        })
        .collect()
}

pub(crate) fn probe_output_project(workspace: &Path) -> Vec<String> {
    let mut found: Vec<(usize, PathBuf)> = Vec::new();
    scan_output_projects(workspace, 0, &mut found);
    found.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| path_key(&a.1).cmp(&path_key(&b.1)))
    });
    let mut candidates = found
        .into_iter()
        .map(|(_, p)| p.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    dedup_paths(&mut candidates);
    candidates
}

/// Collect workspace directories whose names denote an output container for
/// migrated projects (e.g. `output-project`, `迁移工程`). A matched directory
/// is a leaf: its children are never scanned, and a missed directory still
/// recurses (depth-bounded).
pub(crate) fn scan_output_projects(dir: &Path, depth: usize, out: &mut Vec<(usize, PathBuf)>) {
    if depth > MAX_PROBE_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(ftype) = entry.file_type() else {
            continue;
        };
        if !ftype.is_dir() || is_noise_dir(&name) {
            continue;
        }
        if is_output_container_name(&name) {
            out.push((depth + 1, p));
        } else {
            scan_output_projects(&p, depth + 1, out);
        }
    }
}

/// Whether `dir` is inside (or is) an already-migrated Qt-for-HarmonyOS project:
pub(crate) fn is_inside_migrated_harmony_project(dir: &Path) -> bool {
    dir.ancestors().take(MAX_PROBE_DEPTH + 2).any(|ancestor| {
        ancestor.join("build-profile.json5").is_file()
            && ancestor.join("entry").is_dir()
            && (ancestor.join(TEMPLATE_MARKER_DIR).is_dir() || is_qt_harmonyos_template(ancestor))
    })
}

/// Whether `path` is a previous migration product (or lives inside one):
pub fn is_migration_output_artifact(path: &Path) -> bool {
    is_migration_artifact_location(path) || is_inside_migrated_harmony_project(path)
}

/// A directory name that denotes a migration output project (e.g. `app-ohos`).
/// Used only to rank source candidates (migration artifacts after originals).
pub(crate) fn is_migration_artifact(dir: &Path) -> bool {
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    name.contains("-ohos") || name.contains("_ohos") || name.ends_with("ohos")
}

/// A directory name that denotes an output container where migrated projects
/// are created (e.g. `output-project`, `output`, `迁移工程`, `Migration
/// Project`). Matched case-insensitively and ignoring separators/spaces.
pub fn is_output_container_name(name: &str) -> bool {
    let normalized: String = name
        .to_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-' && *c != '_')
        .collect();
    matches!(
        normalized.as_str(),
        "output"
            | "outputs"
            | "outputproject"
            | "migrationproject"
            | "migrationoutput"
            | "迁移工程"
            | "迁移输出"
            | "输出工程"
    )
}
