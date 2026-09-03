//! Backend-owned candidate probing for the `qt-migration-paths` question card.
//!
//! Fills option paths for the intake fields the backend can discover, so the
//! model does not have to:
//! - `source_project`: qmake projects (`*.pro`) in the workspace;
//! - `toolchain`: qmake from `PATH`, falling back to the workspace;
//! - `template`: Qt-for-HarmonyOS template via the `qEmbeddedUiExtensionHost`
//!   marker.
//!
//! - `output_project`: workspace directories whose names denote an output
//!   container for migrated projects (e.g. `output-project`, `迁移工程`);
//!   the workspace root is the last-resort default.
//! Probing is read-only, depth-bounded, and only applies to local workspaces.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

const SKILL_WORKSPACE_DIR: &str = "workspace";

pub(crate) struct QtMigrationCandidateProbe {
    pub candidates: HashMap<String, Vec<String>>,
    pub managed_toolchain_available: bool,
    pub managed_template_available: bool,
}

/// Upper bound on candidates per field (the backend keeps option lists short).
const MAX_SOURCE_PROJECTS: usize = 3;
const MAX_OUTPUT_PROJECTS: usize = 2;
const MAX_TOOLCHAINS: usize = 2;
const MAX_TEMPLATES: usize = 2;
/// A read-only scan never descends below this depth.
const MAX_PROBE_DEPTH: usize = 4;

/// Directory names that are never entered while scanning the workspace.
const NOISE_DIRS: &[&str] = &[
    ".git",
    ".hvigor",
    "hvigor",
    "node_modules",
    "build",
    "out",
    "dist",
    ".ohos",
    "releases",
    "third_party",
    "ohos",
    "oh-*",
];

/// Qt-for-HarmonyOS template marker directory (absent from plain OpenHarmony projects).
const TEMPLATE_MARKER_DIR: &str = "qEmbeddedUiExtensionHost";
const TEMPLATE_QT_CONSTANTS: &str = "entry/src/main/ets/common/QtAppConstants.ets";
const TEMPLATE_QABILITY: &str = "entry/src/main/ets/qability/QAbility.ets";
const TEMPLATE_QT_DECLARATIONS: &str = "entry/src/main/qt/libqohos.d.ts";

/// qmake executable names probed per PATH entry. Qt migration currently
/// accepts Qt5 qmake only.
const QMAKE_EXECUTABLES: &[&str] = &["qmake", "qmake.exe"];

/// Returns candidates from the current workspace, BitFun-managed shared
/// resources, and the installed skill workspace. Local paths are never searched
/// for remote sessions.
pub(crate) fn probe_qt_migration_candidates(
    workspace: &Path,
    path_env: &str,
    managed_root: &Path,
    skill_root: Option<&Path>,
    model_candidates: &HashMap<String, Vec<String>>,
) -> QtMigrationCandidateProbe {
    let mut out = HashMap::new();
    let source_candidates = probe_source_projects(
        workspace,
        model_candidates
            .get("source_project")
            .map(Vec::as_slice)
            .unwrap_or_default(),
    );
    let output_candidates = merge_output_candidates(
        workspace,
        model_candidates
            .get("output_project")
            .map(Vec::as_slice)
            .unwrap_or_default(),
        &source_candidates,
        &[],
    );
    out.insert("source_project".to_string(), source_candidates);
    out.insert("output_project".to_string(), output_candidates);
    out.insert(
        "toolchain".to_string(),
        probe_toolchains(
            workspace,
            path_env,
            managed_root,
            skill_root,
            model_candidates
                .get("toolchain")
                .map(Vec::as_slice)
                .unwrap_or_default(),
        ),
    );
    out.insert(
        "template".to_string(),
        probe_templates(
            workspace,
            managed_root,
            skill_root,
            model_candidates
                .get("template")
                .map(Vec::as_slice)
                .unwrap_or_default(),
        ),
    );
    QtMigrationCandidateProbe {
        managed_toolchain_available: managed_toolchain_available(managed_root),
        managed_template_available: managed_template_available(managed_root),
        candidates: out,
    }
}

pub(crate) fn merge_workspace_output_candidates(
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

fn merge_output_candidates(
    workspace: &Path,
    model_candidates: &[String],
    source_candidates: &[String],
    workspace_output_candidates: &[String],
) -> Vec<String> {
    let mut ranked: Vec<(u8, String)> = Vec::new();
    for path in workspace_output_candidates {
        ranked.push((0, path.clone()));
    }
    for path in probe_output_project(workspace) {
        ranked.push((0, path));
    }
    // Model candidates fill the remaining slots after backend validation.
    for candidate in model_candidates {
        let Some(path) = normalize_workspace_candidate(workspace, candidate) else {
            continue;
        };
        if path.is_dir() {
            ranked.push((1, path.to_string_lossy().into_owned()));
        }
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

pub(crate) fn filter_output_candidates(
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

fn probe_output_project(workspace: &Path) -> Vec<String> {
    let mut found: Vec<(usize, PathBuf)> = Vec::new();
    scan_output_projects(workspace, 0, &mut found);
    found.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| path_key(&a.1).cmp(&path_key(&b.1))));
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
fn scan_output_projects(dir: &Path, depth: usize, out: &mut Vec<(usize, PathBuf)>) {
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

fn probe_source_projects(workspace: &Path, model_candidates: &[String]) -> Vec<String> {
    let mut found: Vec<(u8, usize, PathBuf)> = Vec::new();
    let mut backend_found = Vec::new();
    scan_projects(workspace, 0, &mut backend_found);
    found.extend(
        backend_found
            .into_iter()
            .map(|(depth, path)| (1, depth, path)),
    );
    for candidate in model_candidates {
        let Some(path) = normalize_workspace_candidate(workspace, candidate) else {
            continue;
        };
        let path = if path.is_file()
            && path
                .file_name()
                .map(|name| name.to_string_lossy().to_lowercase().ends_with(".pro"))
                .unwrap_or(false)
        {
            path.parent().unwrap_or(&path).to_path_buf()
        } else {
            path
        };
        if is_qt_source_project(&path) && !is_inside_migrated_harmony_project(&path) {
            let depth = path
                .strip_prefix(workspace)
                .map(|relative| relative.components().count())
                .unwrap_or(MAX_PROBE_DEPTH + 1);
            found.push((0, depth, path));
        }
    }
    // The model candidate reflects the project named in the current request and
    // is preferred as the default after backend validation. The backend still
    // owns the final filtering, ordering, and candidate cap.
    found.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| {
                let (artifact_a, artifact_b) = (
                    is_migration_artifact(&a.2) as u8,
                    is_migration_artifact(&b.2) as u8,
                );
                artifact_a.cmp(&artifact_b)
            })
            .then_with(|| a.1.cmp(&b.1))
            .then_with(|| path_key(&a.2).cmp(&path_key(&b.2)))
    });
    let mut candidates = found
        .into_iter()
        .map(|(_, _, p)| p.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    dedup_paths(&mut candidates);
    candidates.truncate(MAX_SOURCE_PROJECTS);
    candidates
}

fn is_qt_source_project(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    entries.flatten().any(|entry| {
        entry
            .file_type()
            .map(|kind| kind.is_file())
            .unwrap_or(false)
            && entry
                .file_name()
                .to_string_lossy()
                .to_lowercase()
                .ends_with(".pro")
    })
}

/// Collect directories that directly contain a `*.pro` file (project roots).
/// Roots terminate recursion: sub-projects inside a project are not hoisted.
fn scan_projects(dir: &Path, depth: usize, out: &mut Vec<(usize, PathBuf)>) {
    if depth > MAX_PROBE_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut has_pro = false;
    let mut subdirs: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(ftype) = entry.file_type() else {
            continue;
        };
        if ftype.is_dir() {
            if is_noise_dir(&name) {
                continue;
            }
            subdirs.push(p);
            continue;
        }
        if name.to_lowercase().ends_with(".pro") && !name.starts_with('.') {
            has_pro = true;
        }
    }
    if has_pro {
        if is_inside_migrated_harmony_project(dir) {
            return;
        }
        out.push((depth, dir.to_path_buf()));
        // A project root hides sub-projects, except at the workspace root
        // itself: the workspace may host several projects side by side, so
        // depth 0 keeps recursing instead of short-circuiting.
        if depth == 0 {
            for sub in subdirs {
                scan_projects(&sub, depth + 1, out);
            }
        }
        return;
    }
    for sub in subdirs {
        scan_projects(&sub, depth + 1, out);
    }
}

fn is_inside_migrated_harmony_project(dir: &Path) -> bool {
    dir.ancestors().take(MAX_PROBE_DEPTH + 2).any(|ancestor| {
        ancestor.join("build-profile.json5").is_file()
            && ancestor.join("entry").is_dir()
            && ancestor.join(TEMPLATE_MARKER_DIR).is_dir()
    })
}

/// A directory name that denotes a migration output project (e.g. `app-ohos`).
/// Used only to rank source candidates (migration artifacts after originals).
fn is_migration_artifact(dir: &Path) -> bool {
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    name.contains("-ohos") || name.contains("_ohos") || name.ends_with("ohos")
}

/// A directory name that denotes an output container where migrated projects
/// are created (e.g. `output-project`, `output`, `迁移工程`, `Migration
/// Project`). Matched case-insensitively and ignoring separators/spaces.
pub(crate) fn is_output_container_name(name: &str) -> bool {
    let normalized: String = name
        .to_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-' && *c != '_')
        .collect();
    matches!(
        normalized.as_str(),
        "output" | "outputs" | "outputproject" | "migrationproject" | "migrationoutput"
            | "迁移工程" | "迁移输出" | "输出工程"
    )
}

// ---------------------------------------------------------------------------
// toolchain
// ---------------------------------------------------------------------------

fn probe_toolchains(
    workspace: &Path,
    path_env: &str,
    managed_root: &Path,
    skill_root: Option<&Path>,
    model_candidates: &[String],
) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    // PATH order is preserved: earlier entries rank above later ones.
    for dir in std::env::split_paths(path_env) {
        for exe in QMAKE_EXECUTABLES {
            if dir.join(exe).is_file() {
                push_unique(&mut out, &mut seen, &dir);
                break;
            }
        }
        if out.len() >= MAX_TOOLCHAINS {
            break;
        }
    }

    // BitFun-managed toolchains are reusable across workspaces.
    if out.len() < MAX_TOOLCHAINS {
        let mut managed_hits = Vec::new();
        scan_workspace_qmake(&managed_root.join("toolchains"), 0, &mut managed_hits);
        managed_hits.sort();
        for dir in managed_hits {
            push_unique(&mut out, &mut seen, &dir);
            if out.len() >= MAX_TOOLCHAINS {
                break;
            }
        }
    }

    // A workspace-local qmake fills the remaining slot.
    if out.len() < MAX_TOOLCHAINS {
        let mut ws_hits: Vec<PathBuf> = Vec::new();
        scan_workspace_qmake(workspace, 0, &mut ws_hits);
        ws_hits.sort();
        for dir in ws_hits {
            push_unique(&mut out, &mut seen, &dir);
            if out.len() >= MAX_TOOLCHAINS {
                break;
            }
        }
    }

    if out.len() < MAX_TOOLCHAINS {
        let mut model_hits = model_candidates
            .iter()
            .filter_map(|candidate| normalize_workspace_candidate(workspace, candidate))
            .filter_map(|candidate| normalize_toolchain_candidate(&candidate))
            .collect::<Vec<_>>();
        model_hits.sort_by_key(|path| path_key(path));
        for dir in model_hits {
            push_unique(&mut out, &mut seen, &dir);
            if out.len() >= MAX_TOOLCHAINS {
                break;
            }
        }
    }

    if out.len() < MAX_TOOLCHAINS {
        if let Some(root) = skill_root {
            let skill_workspace = root.join(SKILL_WORKSPACE_DIR);
            let mut skill_hits = Vec::new();
            for candidate_root in [
                skill_workspace.join("qt-sdk"),
                skill_workspace.join("qt-src"),
                skill_workspace.join("commandline-tools"),
            ] {
                scan_workspace_qmake(&candidate_root, 0, &mut skill_hits);
            }
            skill_hits.sort();
            for dir in skill_hits {
                push_unique(&mut out, &mut seen, &dir);
                if out.len() >= MAX_TOOLCHAINS {
                    break;
                }
            }
        }
    }

    out
}

fn managed_toolchain_available(root: &Path) -> bool {
    let mut hits = Vec::new();
    scan_workspace_qmake(&root.join("toolchains"), 0, &mut hits);
    hits.into_iter().any(|bin_dir| {
        let sdk_root = bin_dir.parent().unwrap_or(&bin_dir);
        sdk_root.join("lib").is_dir()
            && (sdk_root.join("lib/cmake/Qt5/Qt5Config.cmake").is_file()
                || sdk_root.join("plugins/platforms/libqohos.so").is_file())
    })
}

fn managed_template_available(root: &Path) -> bool {
    let mut hits = Vec::new();
    scan_templates(&root.join("templates"), 0, &mut hits);
    !hits.is_empty()
}

/// Collect directories that directly contain a qmake executable.
fn scan_workspace_qmake(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > MAX_PROBE_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut found_here = false;
    let mut subdirs: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(ftype) = entry.file_type() else {
            continue;
        };
        if ftype.is_dir() {
            if is_noise_dir(&name) {
                continue;
            }
            subdirs.push(p);
            continue;
        }
        if QMAKE_EXECUTABLES.contains(&name.to_lowercase().as_str()) {
            found_here = true;
        }
    }
    if found_here {
        out.push(dir.to_path_buf());
    } else {
        for sub in subdirs {
            scan_workspace_qmake(&sub, depth + 1, out);
        }
    }
}

fn push_unique(out: &mut Vec<String>, seen: &mut std::collections::HashSet<String>, dir: &Path) {
    if seen.insert(path_key(dir)) {
        out.push(dir.to_string_lossy().into_owned());
    }
}

fn probe_templates(
    workspace: &Path,
    managed_root: &Path,
    skill_root: Option<&Path>,
    model_candidates: &[String],
) -> Vec<String> {
    let mut found: Vec<(u8, usize, PathBuf)> = Vec::new();
    let mut managed_hits = Vec::new();
    scan_templates(&managed_root.join("templates"), 0, &mut managed_hits);
    for (depth, path) in managed_hits {
        found.push((0, depth, path));
    }
    let mut workspace_hits = Vec::new();
    scan_templates(workspace, 0, &mut workspace_hits);
    for (depth, path) in workspace_hits {
        found.push((1, depth, path));
    }
    for candidate in model_candidates {
        let Some(path) = normalize_workspace_candidate(workspace, candidate) else {
            continue;
        };
        if is_qt_harmonyos_template(&path) {
            let depth = path
                .strip_prefix(workspace)
                .map(|relative| relative.components().count())
                .unwrap_or(MAX_PROBE_DEPTH + 1);
            found.push((2, depth, path));
        }
    }
    if let Some(root) = skill_root {
        let skill_workspace = root.join(SKILL_WORKSPACE_DIR);
        let mut skill_hits = Vec::new();
        for candidate_root in [
            skill_workspace.join("templates"),
            skill_workspace.join("qt-src"),
        ] {
            scan_templates(&candidate_root, 0, &mut skill_hits);
        }
        for (depth, path) in skill_hits {
            found.push((3, depth, path));
        }
    }
    found.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| a.1.cmp(&b.1))
            .then_with(|| path_key(&a.2).cmp(&path_key(&b.2)))
    });
    let mut candidates = found
        .into_iter()
        .map(|(_, _, p)| p.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    dedup_paths(&mut candidates);
    candidates.truncate(MAX_TEMPLATES);
    candidates
}

fn is_qt_harmonyos_template(dir: &Path) -> bool {
    let has_qt_structure = [
        TEMPLATE_QT_CONSTANTS,
        TEMPLATE_QABILITY,
        TEMPLATE_QT_DECLARATIONS,
    ]
    .iter()
    .all(|relative| dir.join(relative).is_file());
    dir.join(TEMPLATE_MARKER_DIR).is_dir() && has_qt_structure
}

/// Collect directories that match the Qt-for-HarmonyOS template structure.
fn scan_templates(dir: &Path, depth: usize, out: &mut Vec<(usize, PathBuf)>) {
    if depth > MAX_PROBE_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let is_template = is_qt_harmonyos_template(dir);
    let mut subdirs: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(ftype) = entry.file_type() else {
            continue;
        };
        if !ftype.is_dir() {
            continue;
        }
        if is_noise_dir(&name) {
            continue;
        }
        subdirs.push(p);
    }
    if is_template {
        out.push((depth, dir.to_path_buf()));
        return;
    }
    for sub in subdirs {
        scan_templates(&sub, depth + 1, out);
    }
}

fn is_noise_dir(name: &str) -> bool {
    let name = name.to_lowercase();
    NOISE_DIRS.iter().any(|n| {
        if let Some(prefix) = n.strip_suffix('*') {
            name.starts_with(&prefix.to_lowercase())
        } else {
            name == *n
        }
    })
}

fn normalize_toolchain_candidate(candidate: &Path) -> Option<PathBuf> {
    if candidate.is_file() {
        let name = candidate.file_name()?.to_string_lossy().to_lowercase();
        return QMAKE_EXECUTABLES
            .contains(&name.as_str())
            .then(|| candidate.parent().unwrap_or(candidate).to_path_buf());
    }
    QMAKE_EXECUTABLES
        .iter()
        .any(|name| candidate.join(name).is_file())
        .then(|| candidate.to_path_buf())
}

fn normalize_workspace_candidate(workspace: &Path, candidate: &str) -> Option<PathBuf> {
    let candidate = candidate.trim();
    if candidate.is_empty() {
        return None;
    }
    let candidate = PathBuf::from(candidate);
    if candidate
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return None;
    }
    let candidate = if candidate.is_absolute() {
        candidate
    } else {
        workspace.join(candidate)
    };
    let workspace_compare = workspace
        .canonicalize()
        .unwrap_or_else(|_| workspace.to_path_buf());
    let candidate_compare = if candidate.exists() {
        candidate.canonicalize().ok()?
    } else {
        candidate.clone()
    };
    let workspace_key = path_key(&workspace_compare)
        .trim_end_matches(['/', '\\'])
        .to_string();
    let candidate_key = path_key(&candidate_compare)
        .trim_end_matches(['/', '\\'])
        .to_string();
    let inside_workspace = candidate_key == workspace_key
        || candidate_key
            .strip_prefix(&workspace_key)
            .map(|suffix| suffix.starts_with('/') || suffix.starts_with('\\'))
            .unwrap_or(false);
    inside_workspace.then_some(candidate)
}

fn dedup_paths(paths: &mut Vec<String>) {
    let mut seen = std::collections::HashSet::new();
    paths.retain(|path| seen.insert(path_key(Path::new(path))));
}

/// Case-insensitive comparison key (Windows and OHOS paths both fold case).
fn path_key(p: &Path) -> String {
    let key = p.to_string_lossy().replace('\\', "/").to_lowercase();
    key.strip_prefix("//?/").unwrap_or(&key).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(dir: &Path, name: &str) {
        std::fs::write(dir.join(name), "").expect("write test file");
    }

    fn mkdir(dir: &Path, name: &str) -> PathBuf {
        let p = dir.join(name);
        std::fs::create_dir_all(&p).expect("create test dir");
        p
    }

    fn tree() -> (tempfile::TempDir, PathBuf) {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path().to_path_buf();
        (tmp, root)
    }

    fn create_template(root: &Path) {
        std::fs::create_dir_all(root.join(TEMPLATE_MARKER_DIR)).unwrap();
        for relative in [
            TEMPLATE_QT_CONSTANTS,
            TEMPLATE_QABILITY,
            TEMPLATE_QT_DECLARATIONS,
        ] {
            let path = root.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            touch(
                path.parent().unwrap(),
                path.file_name().unwrap().to_str().unwrap(),
            );
        }
    }

    fn candidate_map(field: &str, paths: Vec<String>) -> HashMap<String, Vec<String>> {
        HashMap::from([(field.to_string(), paths)])
    }

    #[test]
    fn model_source_candidate_fills_backend_scan_gap() {
        let (_t, root) = tree();
        let deep = root.join("one/two/three/four/five/model-project");
        std::fs::create_dir_all(&deep).unwrap();
        touch(&deep, "model.pro");
        let managed_root = root.join("managed");
        let model = candidate_map("source_project", vec![deep.to_string_lossy().into_owned()]);

        let probe = probe_qt_migration_candidates(&root, "", &managed_root, None, &model);

        assert_eq!(
            probe.candidates["source_project"],
            vec![deep.to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn model_source_candidate_from_pro_file_is_default() {
        let (_t, root) = tree();
        let project = mkdir(&root, "notepad--/src");
        let pro = project.join("RealCompare.pro");
        touch(&project, "RealCompare.pro");
        let model = candidate_map("source_project", vec![pro.to_string_lossy().into_owned()]);

        let probe = probe_qt_migration_candidates(&root, "", &root.join("managed"), None, &model);

        assert_eq!(
            path_key(Path::new(&probe.candidates["source_project"][0])),
            path_key(&project)
        );
    }

    #[test]
    fn model_source_candidates_are_filtered_sorted_deduped_and_capped() {
        let (_t, root) = tree();
        let backend = mkdir(&root, "a-backend");
        touch(&backend, "backend.pro");
        let model_b = mkdir(&root, "b-model");
        touch(&model_b, "model.pro");
        let model_c = mkdir(&root, "c-model");
        touch(&model_c, "model.pro");
        let model_d = mkdir(&root, "d-model");
        touch(&model_d, "model.pro");
        let outside = tempfile::tempdir().unwrap();
        touch(outside.path(), "outside.pro");
        let migrated = mkdir(&root, "migrated-ohos");
        touch(&migrated, "build-profile.json5");
        mkdir(&migrated, "entry");
        mkdir(&migrated, TEMPLATE_MARKER_DIR);
        touch(&migrated, "copied.pro");
        let model = candidate_map(
            "source_project",
            vec![
                model_d.to_string_lossy().into_owned(),
                outside.path().to_string_lossy().into_owned(),
                migrated.to_string_lossy().into_owned(),
                model_b.to_string_lossy().into_owned(),
                model_b.to_string_lossy().to_uppercase(),
                model_c.to_string_lossy().into_owned(),
            ],
        );

        let probe = probe_qt_migration_candidates(&root, "", &root.join("managed"), None, &model);

        let source = &probe.candidates["source_project"];
        assert_eq!(path_key(Path::new(&source[0])), path_key(&model_b));
        assert!(source
            .iter()
            .all(|path| path_key(Path::new(path)) != path_key(&outside.path())));
    }

    #[test]
    fn output_model_candidates_are_filtered_and_workspace_is_fallback() {
        let (_t, root) = tree();
        let source = mkdir(&root, "source");
        touch(&source, "source.pro");
        std::fs::create_dir_all(root.join("new-output")).unwrap();
        let output = root.join("new-output");
        let outside = tempfile::tempdir().unwrap();
        let model = candidate_map(
            "output_project",
            vec![
                source.to_string_lossy().into_owned(),
                outside.path().to_string_lossy().into_owned(),
                output.to_string_lossy().into_owned(),
            ],
        );

        let probe = probe_qt_migration_candidates(&root, "", &root.join("managed"), None, &model);
        assert_eq!(
            probe.candidates["output_project"],
            vec![output.to_string_lossy().into_owned()]
        );

        let invalid_model = candidate_map(
            "output_project",
            vec![source.to_string_lossy().into_owned()],
        );
        let fallback =
            probe_qt_migration_candidates(&root, "", &root.join("managed"), None, &invalid_model);
        assert_eq!(
            fallback.candidates["output_project"],
            vec![root.to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn nonexistent_output_path_is_filtered_out() {
        let (_t, root) = tree();
        let nonexistent = root.join("does-not-exist");
        let model = candidate_map(
            "output_project",
            vec![nonexistent.to_string_lossy().into_owned()],
        );
        let probe = probe_qt_migration_candidates(&root, "", &root.join("managed"), None, &model);
        assert!(probe.candidates["output_project"]
            .iter()
            .all(|p| path_key(Path::new(p)) != path_key(&nonexistent)));
    }

    #[test]
    fn output_container_dir_in_workspace_is_probed() {
        let (_t, root) = tree();
        let source = mkdir(&root, "calculator");
        touch(&source, "calculator.pro");
        let output_dir = mkdir(&root, "迁移工程");
        let migrated = mkdir(&root, "calculator-ohos");
        touch(&migrated, "build-profile.json5");
        mkdir(&migrated, "entry");
        let managed_root = root.join("managed");

        let probe = probe_qt_migration_candidates(&root, "", &managed_root, None, &HashMap::new());

        assert_eq!(
            probe.candidates["output_project"],
            vec![output_dir.to_string_lossy().into_owned()],
            "output container is probed; migrated product dirs are not"
        );
        assert!(probe.candidates["output_project"]
            .iter()
            .all(|p| path_key(Path::new(p)) != path_key(&migrated)));
    }

    #[test]
    fn output_container_names_are_semantic_variants() {
        for name in [
            "output",
            "outputs",
            "output-project",
            "output_project",
            "Migration Project",
            "迁移工程",
            "迁移输出",
        ] {
            assert!(
                is_output_container_name(name),
                "{name} should be recognized as an output container"
            );
        }
        for name in ["calculator-ohos", "app_ohos", "myappohos", "src", "build"] {
            assert!(
                !is_output_container_name(name),
                "{name} should not be an output container"
            );
        }
    }

    #[test]
    fn output_container_dir_ranks_before_model_candidate() {
        let (_t, root) = tree();
        let output_dir = mkdir(&root, "output-project");
        let model_dir = mkdir(&root, "model-output");
        let model = candidate_map(
            "output_project",
            vec![model_dir.to_string_lossy().into_owned()],
        );

        let probe =
            probe_qt_migration_candidates(&root, "", &root.join("managed"), None, &model);

        assert_eq!(
            probe.candidates["output_project"],
            vec![
                output_dir.to_string_lossy().into_owned(),
                model_dir.to_string_lossy().into_owned(),
            ]
        );
    }

    #[test]
    fn workspace_service_output_candidate_is_merged_first() {
        let (_t, root) = tree();
        let workspace_output = root.join("迁移工程").to_string_lossy().into_owned();
        let model_output = mkdir(&root, "model-output")
            .to_string_lossy()
            .into_owned();

        let candidates = merge_workspace_output_candidates(
            &root,
            &[model_output.clone()],
            &[],
            &[workspace_output.clone()],
        );

        assert_eq!(candidates, vec![workspace_output, model_output]);
    }

    #[test]
    fn backend_priority_can_displace_valid_model_toolchain() {
        let (_t, root) = tree();
        let path_bin = mkdir(&root, "path-bin");
        touch(&path_bin, "qmake");
        let managed_root = root.join("managed");
        let managed_bin = managed_root.join("toolchains/qt/bin");
        std::fs::create_dir_all(&managed_bin).unwrap();
        touch(&managed_bin, "qmake");
        let model_bin = mkdir(&root, "model-bin");
        touch(&model_bin, "qmake");
        let model = candidate_map("toolchain", vec![model_bin.to_string_lossy().into_owned()]);

        let probe = probe_qt_migration_candidates(
            &root,
            &path_bin.to_string_lossy(),
            &managed_root,
            None,
            &model,
        );

        let toolchains = &probe.candidates["toolchain"];
        assert_eq!(toolchains.len(), 2);
        assert_eq!(path_key(Path::new(&toolchains[0])), path_key(&path_bin));
        assert_eq!(path_key(Path::new(&toolchains[1])), path_key(&managed_bin));
        assert!(toolchains
            .iter()
            .all(|path| path_key(Path::new(path)) != path_key(&model_bin)));
    }

    #[test]
    fn valid_model_template_is_merged_when_backend_has_capacity() {
        let (_t, root) = tree();
        let backend_template = mkdir(&root, "a-template");
        create_template(&backend_template);
        let deep_model_template = root.join("one/two/three/four/five/model-template");
        create_template(&deep_model_template);
        let model = candidate_map(
            "template",
            vec![deep_model_template.to_string_lossy().into_owned()],
        );

        let probe = probe_qt_migration_candidates(&root, "", &root.join("managed"), None, &model);

        assert_eq!(
            probe.candidates["template"],
            vec![
                backend_template.to_string_lossy().into_owned(),
                deep_model_template.to_string_lossy().into_owned(),
            ]
        );
    }

    #[test]
    fn source_projects_sorted_original_before_artifact_then_depth_then_alpha() {
        let (_t, root) = tree();
        let deep = mkdir(&root, "deep");
        mkdir(&deep, "inner_qapp"); // depth 2 project: .pro under deep/inner_qapp
        touch(&root.join("deep").join("inner_qapp"), "inner_qapp.pro");
        touch(&root, "zapp.pro"); // workspace root is itself a project (depth 0)
        touch(&root, "aapp.pro"); // same root project, lexicographically first file
        let mid = mkdir(&root, "mid"); // depth 1 project
        touch(&mid, "mid.pro");
        let artifact = mkdir(&root, "myapp-ohos");
        touch(&artifact, "myapp-ohos.pro"); // migration artifact at depth 1

        let hits = probe_source_projects(&root, &[]);
        assert_eq!(
            hits,
            vec![
                root.to_string_lossy().into_owned(),
                mid.to_string_lossy().into_owned(),
                root.join("deep")
                    .join("inner_qapp")
                    .to_string_lossy()
                    .into_owned(),
            ],
            "originals first (shallower then alpha), 3-cap excludes the artifact"
        );
        assert!(
            hits.iter()
                .all(|h| h != &artifact.to_string_lossy().into_owned()),
            "migration artifact ranks after originals"
        );
    }

    #[test]
    fn source_project_extension_is_case_insensitive() {
        let (_t, root) = tree();
        touch(&root, "MyApp.PRO");
        assert_eq!(
            probe_source_projects(&root, &[]),
            vec![root.to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn migrated_harmony_project_qmake_sources_are_not_candidates() {
        let (_t, root) = tree();
        let original = mkdir(&root, "source");
        touch(&original, "original.pro");

        let migrated = mkdir(&root, "app-ohos");
        touch(&migrated, "build-profile.json5");
        mkdir(&migrated, "entry");
        mkdir(&migrated, TEMPLATE_MARKER_DIR);
        let copied_source = migrated.join("entry/src/main/cpp");
        std::fs::create_dir_all(&copied_source).unwrap();
        touch(&copied_source, "original.pro");

        let hits = probe_source_projects(&root, &[]);
        assert_eq!(hits, vec![original.to_string_lossy().into_owned()]);
    }

    #[test]
    fn source_projects_cap_is_three_and_noise_dir_is_skipped() {
        let (_t, root) = tree();
        for n in ["a", "b", "c", "d"] {
            let d = mkdir(&root, n);
            touch(&d, &format!("{n}.pro"));
        }
        let build = mkdir(&root, "build");
        touch(&build, "build.pro");
        let hits = probe_source_projects(&root, &[]);
        assert_eq!(hits.len(), 3);
        assert!(hits.iter().all(|h| !h.contains("build")));
    }

    #[test]
    fn toolchain_prefers_path_order_then_workspace_fill() {
        let (_t, root) = tree();
        // workspaces dir (a qmake inside the workspace is the fallback)
        let ws_tools = mkdir(&root, "Qt5.15.2");
        let ws_bin = mkdir(&ws_tools, "bin");
        touch(&ws_bin, "qmake.exe");

        let tmp2 = tempfile::tempdir().expect("tempdir");
        let dir1 = tmp2.path().join("path_first");
        let dir2 = tmp2.path().join("path_second");
        std::fs::create_dir_all(&dir1).unwrap();
        std::fs::create_dir_all(&dir2).unwrap();
        touch(&dir1, "qmake.exe");
        touch(&dir2, "qmake.exe");

        let path_env = format!("{};{}", dir1.to_string_lossy(), dir2.to_string_lossy());
        let managed_root = root.join("managed");
        let hits = probe_toolchains(&root, &path_env, &managed_root, None, &[]);
        assert_eq!(
            hits,
            vec![
                dir1.to_string_lossy().into_owned(),
                dir2.to_string_lossy().into_owned()
            ],
            "first two PATH qmakes fill default + alternate; workspace not needed"
        );

        // PATH yields one candidate -> workspace qmake fills the alternate slot.
        let one_path = dir1.to_string_lossy().into_owned();
        let hits = probe_toolchains(&root, &one_path, &managed_root, None, &[]);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0], dir1.to_string_lossy().into_owned());
        assert_eq!(hits[1], ws_bin.to_string_lossy().into_owned());
    }

    #[test]
    fn managed_resources_are_probed_before_workspace() {
        let (_t, root) = tree();
        let managed_root = root.join("managed");
        let managed_bin = managed_root.join("toolchains").join("qt5.12").join("bin");
        std::fs::create_dir_all(&managed_bin).unwrap();
        touch(&managed_bin, "qmake");
        std::fs::create_dir_all(managed_bin.parent().unwrap().join("lib/cmake/Qt5")).unwrap();
        touch(
            &managed_bin.parent().unwrap().join("lib/cmake/Qt5"),
            "Qt5Config.cmake",
        );

        let workspace_bin = root.join("workspace-tools");
        std::fs::create_dir_all(&workspace_bin).unwrap();
        touch(&workspace_bin, "qmake");
        let probe = probe_qt_migration_candidates(&root, "", &managed_root, None, &HashMap::new());
        assert!(probe.managed_toolchain_available);
        assert_eq!(
            probe.candidates["toolchain"][0],
            managed_bin.to_string_lossy()
        );
        assert_eq!(
            probe.candidates["toolchain"][1],
            workspace_bin.to_string_lossy()
        );
    }

    #[test]
    fn managed_template_is_probed_before_workspace() {
        let (_t, root) = tree();
        let managed_root = root.join("managed");
        let managed_tpl = managed_root.join("templates").join("qt5.12");
        create_template(&managed_tpl);
        let workspace_tpl = root.join("workspace-template");
        create_template(&workspace_tpl);

        let probe = probe_qt_migration_candidates(&root, "", &managed_root, None, &HashMap::new());
        assert!(probe.managed_template_available);
        assert_eq!(
            probe.candidates["template"][0],
            managed_tpl.to_string_lossy()
        );
        assert_eq!(
            probe.candidates["template"][1],
            workspace_tpl.to_string_lossy()
        );
    }

    #[test]
    fn toolchain_dedups_and_caps_at_two() {
        let (_t, root) = tree();
        let tmp2 = tempfile::tempdir().expect("tempdir");
        let d = tmp2.path().join("share");
        std::fs::create_dir_all(&d).unwrap();
        touch(&d, "qmake");
        // same dir twice in PATH
        let path_env = format!("{};{}", d.to_string_lossy(), d.to_string_lossy());
        let managed_root = root.join("managed");
        let hits = probe_toolchains(&root, &path_env, &managed_root, None, &[]);
        assert_eq!(hits, vec![d.to_string_lossy().into_owned()]);
    }

    #[test]
    fn template_marker_detects_qt_for_ohos_template_only() {
        let (_t, root) = tree();
        let tpl = mkdir(&root, "templates");
        create_template(&tpl);
        let plain = mkdir(&root, "plain_hm");
        mkdir(&plain, "entry");
        touch(&plain, "build-profile.json5");

        let managed_root = root.join("managed");
        let hits = probe_templates(&root, &managed_root, None, &[]);
        assert_eq!(hits, vec![tpl.to_string_lossy().into_owned()]);
    }

    #[test]
    fn qt_structure_without_marker_is_not_a_template() {
        let (_t, root) = tree();
        let tpl = mkdir(&root, "templates");
        for relative in [
            TEMPLATE_QT_CONSTANTS,
            TEMPLATE_QABILITY,
            TEMPLATE_QT_DECLARATIONS,
        ] {
            let path = tpl.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            touch(
                path.parent().unwrap(),
                path.file_name().unwrap().to_str().unwrap(),
            );
        }

        let managed_root = root.join("managed");
        assert!(probe_templates(&root, &managed_root, None, &[]).is_empty());
    }

    #[test]
    fn marker_without_qt_files_is_not_a_template() {
        let (_t, root) = tree();
        let tpl = mkdir(&root, "templates");
        mkdir(&tpl, TEMPLATE_MARKER_DIR);
        let managed_root = root.join("managed");
        assert!(probe_templates(&root, &managed_root, None, &[]).is_empty());
    }

    #[test]
    fn plain_harmonyos_project_is_not_template() {
        let (_t, root) = tree();
        let plain = mkdir(&root, "plain_hm");
        mkdir(&plain, "entry");
        touch(&plain, "build-profile.json5");

        let managed_root = root.join("managed");
        assert!(probe_templates(&root, &managed_root, None, &[]).is_empty());
    }

    #[test]
    fn output_project_does_not_reuse_source_project() {
        let (_t, root) = tree();
        touch(&root, "app.pro");
        let managed_root = root.join("managed");
        let probe = probe_qt_migration_candidates(&root, "", &managed_root, None, &HashMap::new());
        assert!(probe.candidates["source_project"].contains(&root.to_string_lossy().into_owned()));
        assert!(probe.candidates["output_project"].is_empty());
    }

    #[test]
    fn output_candidates_filter_source_paths() {
        let filtered = filter_output_candidates(
            vec!["D:/qt".to_string(), "D:/out".to_string()],
            &["D:/qt".to_string()],
        );
        assert_eq!(filtered, vec!["D:/out"]);
    }

    #[test]
    fn probe_map_contains_output_workspace_candidate() {
        let (_t, root) = tree();
        let managed_root = root.join("managed");
        let probe = probe_qt_migration_candidates(&root, "", &managed_root, None, &HashMap::new());
        assert_eq!(probe.candidates.len(), 4);
        assert!(probe.candidates.contains_key("source_project"));
        assert!(probe.candidates.contains_key("output_project"));
        assert!(probe.candidates.contains_key("toolchain"));
        assert!(probe.candidates.contains_key("template"));
        assert!(!probe.managed_toolchain_available);
        assert!(!probe.managed_template_available);
        assert_eq!(
            probe.candidates["output_project"],
            vec![root.to_string_lossy().into_owned()]
        );
    }
}
