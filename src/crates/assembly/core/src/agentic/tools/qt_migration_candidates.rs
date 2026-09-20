//! Backend-owned candidate probing for the `qt-migration-paths` question card.
//!
//! Priority: prompt-named candidates (model-provided, validated) rank first in
//! every field; per-field discovery order below that:
//! - `source_project`: qmake projects (`*.pro`) in the workspace;
//! - `toolchain`: workspace qmake, then BitFun-managed shared toolchains,
//!   then `PATH`;
//! - `template`: Qt-for-HarmonyOS templates in the workspace, then
//!   BitFun-managed shared templates (via the `qEmbeddedUiExtensionHost`
//!   marker);
//! - `output_project`: workspace directories whose names denote an output
//!   container for migrated projects (e.g. `output-project`, `迁移工程`);
//!   the workspace root is the last-resort default.
//! Probing is read-only, depth-bounded, and only applies to local workspaces.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub(crate) struct QtMigrationCandidateProbe {
    pub candidates: HashMap<String, Vec<String>>,
    pub managed_toolchain_available: bool,
    pub managed_template_available: bool,
}

/// Upper bound on candidates per field (the backend keeps option lists short;
/// the question card renders default + alternate, so every field caps at 2).
const MAX_SOURCE_PROJECTS: usize = 2;
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

/// Login shells tried (in order) to capture the session PATH. The BitFun app
/// process on sandboxed platforms inherits a fixed minimal PATH, while
/// user-installed toolchains are exposed through shell profiles.
const LOGIN_SHELLS: &[&str] = &["bash", "zsh", "sh"];
const LOGIN_SHELL_CAPTURE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// The PATH a login shell would see.
///
/// On desktop platforms the BitFun process inherits the user environment, so
/// the process PATH is already equivalent and is returned directly. On
/// sandboxed platforms (HarmonyOS) the app process gets a fixed minimal PATH,
/// so the session PATH is captured from a login shell instead; this keeps
/// "the qmake in the environment variables" consistent with what `which
/// qmake` reports inside BitFun shell sessions.
pub(crate) fn shell_session_path_env() -> String {
    if cfg!(target_env = "ohos") {
        for shell in LOGIN_SHELLS {
            if let Some(captured) = capture_login_shell_path(shell) {
                return captured;
            }
        }
    }
    std::env::var("PATH").unwrap_or_default()
}

/// Spawn a login shell that prints its PATH. Returns `None` when the shell is
/// unavailable, the login phase fails, or the answer does not arrive in time.
fn capture_login_shell_path(shell: &str) -> Option<String> {
    let mut child = std::process::Command::new(shell)
        .arg("-l")
        .arg("-c")
        .arg("echo $PATH")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        if let Ok(output) = child.wait_with_output() {
            let _ = sender.send(output);
        }
    });
    let output = receiver.recv_timeout(LOGIN_SHELL_CAPTURE_TIMEOUT).ok()?;
    let captured = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if captured.is_empty() || !captured.contains(':') {
        return None;
    }
    Some(captured)
}

/// Returns candidates from the current workspace and BitFun-managed shared
/// resources. Local paths are never searched for remote sessions.
pub(crate) fn probe_qt_migration_candidates(
    workspace: &Path,
    path_env: &str,
    managed_root: &Path,
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
    // Prompt-named candidates rank first (explicit user intent); the is_dir
    // check still applies so only real directories reach the option list, and
    // a previous migration result is excluded — it is a finished product, not
    // a target for the next migration. Location alone is not enough: a
    // migrated project may sit outside any output container (e.g. next to the
    // source project), so the migrated-project structure check is applied too.
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
        } else if path.is_dir() {
            // Prompt-named container (e.g. the parent directory of the Qt
            // project): descend and offer the project roots actually found
            // inside. scan_projects keeps the migrated-project exclusions.
            let mut scanned = Vec::new();
            scan_projects(&path, 0, &mut scanned);
            for (sub_depth, project) in scanned {
                let depth = project
                    .strip_prefix(workspace)
                    .map(|relative| relative.components().count())
                    .unwrap_or(MAX_PROBE_DEPTH + 1)
                    + sub_depth;
                found.push((0, depth, project));
            }
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

/// CMake-based Qt project marker: a CMakeLists.txt that resolves Qt via
/// `find_package(Qt…)`. One of the two build systems the ohos-qt-skills
/// pre-flight (阶段零) recognizes — qmake `.pro` is the other. Detection
/// criteria deliberately mirror the skill's analyzer workflow so the backend
/// probe and the model-driven migration flow agree on what a Qt project is.
fn is_qt_cmake_project(dir: &Path) -> bool {
    let Ok(cmake) = std::fs::read_to_string(dir.join("CMakeLists.txt")) else {
        return false;
    };
    // Covers find_package(Qt5 …), find_package(Qt6 …), find_package(Qt …).
    cmake.to_ascii_lowercase().contains("find_package(qt")
}

fn is_qt_source_project(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    let mut has_cmake = false;
    for entry in entries.flatten() {
        if !entry
            .file_type()
            .map(|kind| kind.is_file())
            .unwrap_or(false)
        {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name.ends_with(".pro") {
            return true;
        }
        if name == "cmakelists.txt" {
            has_cmake = true;
        }
    }
    has_cmake && is_qt_cmake_project(dir)
}

/// Collect directories that directly contain a `*.pro` file or a Qt CMake
/// build (CMakeLists.txt with `find_package(Qt…)` — same criteria as the
/// ohos-qt-skills pre-flight). Roots terminate recursion: sub-projects inside
/// a project are not hoisted.
fn scan_projects(dir: &Path, depth: usize, out: &mut Vec<(usize, PathBuf)>) {
    if depth > MAX_PROBE_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut has_pro = false;
    let mut has_cmake = false;
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
        let lower = name.to_lowercase();
        if lower.ends_with(".pro") && !name.starts_with('.') {
            has_pro = true;
        }
        if lower == "cmakelists.txt" {
            has_cmake = true;
        }
    }
    if has_pro || (has_cmake && is_qt_cmake_project(dir)) {
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

/// Whether `path` is a previous migration product (or lives inside one):
/// inside an output container, or itself/above a migrated HarmonyOS project
/// structure (build-profile + entry + `qEmbeddedUiExtensionHost`). Same
/// criteria the output-candidate probe uses for exclusion. Used by the
/// answer-submit validation to reject overwriting previous migration results.
pub(crate) fn is_migration_output_artifact(path: &Path) -> bool {
    is_migration_artifact_location(path) || is_inside_migrated_harmony_project(path)
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

// ---------------------------------------------------------------------------
// toolchain
// ---------------------------------------------------------------------------

fn probe_toolchains(
    workspace: &Path,
    path_env: &str,
    managed_root: &Path,
    model_candidates: &[String],
) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Prompt-named candidates rank first: they reflect explicit user intent.
    // The qmake structural check still applies, so invalid paths cannot pass.
    // A prompt-named SDK root (qmake at `<root>/bin/qmake`) is descended into
    // so the bin dir actually containing a qmake executable is offered.
    if !model_candidates.is_empty() {
        let mut model_hits: Vec<PathBuf> = Vec::new();
        for candidate in model_candidates {
            let Some(path) = normalize_workspace_candidate(workspace, candidate) else {
                continue;
            };
            if let Some(dir) = normalize_toolchain_candidate(&path) {
                model_hits.push(dir);
            } else if path.is_dir() {
                let mut scanned = Vec::new();
                scan_workspace_qmake(&path, 0, &mut scanned);
                scanned.sort_by_key(|path| path_key(path));
                model_hits.extend(scanned);
            }
        }
        model_hits.sort_by_key(|path| path_key(path));
        for dir in model_hits {
            push_unique(&mut out, &mut seen, &dir);
            if out.len() >= MAX_TOOLCHAINS {
                return out;
            }
        }
    }

    // Workspace-local qmake outranks the shared managed toolchain.
    if out.len() < MAX_TOOLCHAINS {
        let mut ws_hits: Vec<PathBuf> = Vec::new();
        scan_workspace_qmake(workspace, 0, &mut ws_hits);
        ws_hits.sort();
        for dir in ws_hits {
            push_unique(&mut out, &mut seen, &dir);
            if out.len() >= MAX_TOOLCHAINS {
                return out;
            }
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
                return out;
            }
        }
    }

    // PATH is the last resort: entries on PATH may be desktop Qt builds that
    // are unrelated to the HarmonyOS migration.
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
    model_candidates: &[String],
) -> Vec<String> {
    let mut found: Vec<(u8, usize, PathBuf)> = Vec::new();
    // Prompt-named candidates rank first (explicit user intent); the Qt
    // template structural check still applies, and a previous migration
    // result is rejected by location (output container) or by the migration
    // artifact naming convention (`*-ohos`).
    for candidate in model_candidates {
        let Some(path) = normalize_workspace_candidate(workspace, candidate) else {
            continue;
        };
        if is_qt_harmonyos_template(&path)
            && !is_migration_artifact_location(&path)
            && !is_migration_artifact(&path)
        {
            let depth = path
                .strip_prefix(workspace)
                .map(|relative| relative.components().count())
                .unwrap_or(MAX_PROBE_DEPTH + 1);
            found.push((0, depth, path));
        } else if path.is_dir() {
            // Prompt-named parent (e.g. the extract root of a downloaded
            // template): descend and offer the template dirs actually found
            // inside, with the same migration-result exclusions as above.
            let mut scanned = Vec::new();
            scan_templates(&path, 0, &mut scanned);
            for (sub_depth, template) in scanned {
                if is_migration_artifact_location(&template) || is_migration_artifact(&template) {
                    continue;
                }
                let depth = template
                    .strip_prefix(workspace)
                    .map(|relative| relative.components().count())
                    .unwrap_or(MAX_PROBE_DEPTH + 1)
                    + sub_depth;
                found.push((0, depth, template));
            }
        }
    }
    let mut workspace_hits = Vec::new();
    scan_templates(workspace, 0, &mut workspace_hits);
    // 已迁移产物不是可复用模板：上次迁移的工程结构同样满足模板四特征。
    // 位置判据（输出容器内）之外补充命名判据：迁移产物工程名规范为
    // `原工程名-ohos`，而官方模板目录名不带该后缀（如 `qt5.12`）。
    for (depth, path) in workspace_hits {
        if !is_migration_artifact_location(&path) && !is_migration_artifact(&path) {
            found.push((1, depth, path));
        }
    }
    let mut managed_hits = Vec::new();
    scan_templates(&managed_root.join("templates"), 0, &mut managed_hits);
    for (depth, path) in managed_hits {
        found.push((2, depth, path));
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
/// Migration-result exclusion is applied by the caller (managed resources are
/// never migration results, so they skip the check).
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

/// A path that lives inside an output container (`output-project`, `迁移工程`,
/// ...) is a migration result, never a reusable template or a fresh output
/// target. Structural checks are deliberately NOT used here: both the official
/// template and a migrated project share the same HarmonyOS project layout, so
/// only the location tells them apart.
fn is_migration_artifact_location(path: &Path) -> bool {
    path.ancestors()
        .skip(1)
        .take(MAX_PROBE_DEPTH + 2)
        .any(|ancestor| {
            ancestor
                .file_name()
                .map(|name| is_output_container_name(&name.to_string_lossy()))
                .unwrap_or(false)
        })
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

/// Normalize a model-provided candidate path. Absolute paths are accepted even
/// outside the workspace: users may point at toolchains/templates anywhere,
/// and a prompt-named path is user intent, not a workspace scan hit. Relative
/// paths resolve against the workspace; `..` segments are rejected. Callers
/// still apply per-field structural checks (qmake / template layout / is_dir),
/// so hallucinated paths cannot reach the option list.
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
    if candidate.exists() {
        // dunce keeps the Windows canonical form free of the `\\?\` prefix;
        // std canonicalize would leak it into user-visible option paths.
        dunce::canonicalize(&candidate)
            .ok()
            .or_else(|| Some(candidate))
    } else {
        Some(candidate)
    }
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

        let probe = probe_qt_migration_candidates(&root, "", &managed_root, &model);

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

        let probe = probe_qt_migration_candidates(&root, "", &root.join("managed"), &model);

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
        let migrated = mkdir(&root, "migrated-ohos");
        touch(&migrated, "build-profile.json5");
        mkdir(&migrated, "entry");
        mkdir(&migrated, TEMPLATE_MARKER_DIR);
        touch(&migrated, "copied.pro");
        let model = candidate_map(
            "source_project",
            vec![
                model_d.to_string_lossy().into_owned(),
                migrated.to_string_lossy().into_owned(),
                model_b.to_string_lossy().into_owned(),
                model_b.to_string_lossy().to_uppercase(),
                model_c.to_string_lossy().into_owned(),
            ],
        );

        let probe = probe_qt_migration_candidates(&root, "", &root.join("managed"), &model);

        let source = &probe.candidates["source_project"];
        assert_eq!(source.len(), 2, "capped at two like every field");
        assert_eq!(path_key(Path::new(&source[0])), path_key(&model_b));
        assert_eq!(path_key(Path::new(&source[1])), path_key(&model_c));
        assert!(source
            .iter()
            .all(|path| path_key(Path::new(path)) != path_key(&migrated)));
    }

    #[test]
    fn workspace_external_source_candidate_is_kept() {
        let (_t, root) = tree();
        let outside = tempfile::tempdir().unwrap();
        touch(outside.path(), "outside.pro");
        let model = candidate_map(
            "source_project",
            vec![outside.path().to_string_lossy().into_owned()],
        );

        let probe = probe_qt_migration_candidates(&root, "", &root.join("managed"), &model);

        // 用户显式给出的工作区外工程是用户意图，必须保留在候选中。
        assert_eq!(
            probe.candidates["source_project"],
            vec![outside.path().to_string_lossy().into_owned()]
        );
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

        let probe = probe_qt_migration_candidates(&root, "", &root.join("managed"), &model);
        // 用户显式给出的工作区外输出目录保留（用户意图），workspace 内探测候选优先。
        // 两个候选同为 prompt-named（rank 0），顺序由 path_key 决定，而两个
        // tempdir 的目录名是随机的，所以断言集合而非具体顺序。
        let outputs = &probe.candidates["output_project"];
        assert_eq!(outputs.len(), 2, "source filtered; output + outside kept");
        assert!(outputs
            .iter()
            .any(|p| path_key(Path::new(p)) == path_key(&output)));
        assert!(outputs
            .iter()
            .any(|p| path_key(Path::new(p)) == path_key(outside.path())));

        let invalid_model = candidate_map(
            "output_project",
            vec![source.to_string_lossy().into_owned()],
        );
        let fallback =
            probe_qt_migration_candidates(&root, "", &root.join("managed"), &invalid_model);
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
        let probe = probe_qt_migration_candidates(&root, "", &root.join("managed"), &model);
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

        let probe = probe_qt_migration_candidates(&root, "", &managed_root, &HashMap::new());

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
    fn prompt_named_output_inside_container_is_rejected() {
        let (_t, root) = tree();
        let output_container = mkdir(&root, "output");
        let previous = mkdir(&output_container, "calculator-ohos");
        touch(&previous, "build-profile.json5");
        // 模型自作主张把上次迁移产物作为输出候选传入：容器内路径必须被拒。
        let model = candidate_map(
            "output_project",
            vec![previous.to_string_lossy().into_owned()],
        );
        let managed_root = root.join("managed");

        let probe = probe_qt_migration_candidates(&root, "", &managed_root, &model);

        // 容器内的旧产物被拒后，容器本身由语义扫描补上作为输出目标。
        assert_eq!(
            probe.candidates["output_project"],
            vec![output_container.to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn prompt_named_migrated_product_outside_container_is_rejected() {
        // 上次迁移的产物可能不在任何输出容器内（如源工程旁的 xxx-ohos）。
        // 结构判据（build-profile + entry + marker）必须把它拒之门外，
        // 不能只依赖"位于输出容器内"这一位置特征。
        let (_t, root) = tree();
        let previous = mkdir(&root, "calculator-ohos");
        create_template(&previous);
        touch(&previous, "build-profile.json5");
        mkdir(&previous, "entry");
        // 模型把上次迁移产物作为输出候选传入：必须被拒。
        let model = candidate_map(
            "output_project",
            vec![previous.to_string_lossy().into_owned()],
        );
        let managed_root = root.join("managed");

        let probe = probe_qt_migration_candidates(&root, "", &managed_root, &model);

        // 产物被拒后回退到 workspace 根作为兜底输出目标。
        assert_eq!(
            probe.candidates["output_project"],
            vec![root.to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn migration_output_artifact_criteria_match_probe_exclusion() {
        // 提交侧校验与输出候选探测使用同一套产物判据：
        // 容器内路径、真实迁移产物（结构判据）都算产物；
        // 输出容器本身与普通新建目录不是产物。
        let (_t, root) = tree();
        let container = mkdir(&root, "output-project");
        let product_in_container = mkdir(&container, "calculator-ohos");
        touch(&product_in_container, "build-profile.json5");
        mkdir(&product_in_container, "entry");
        mkdir(&product_in_container, TEMPLATE_MARKER_DIR);
        let product_outside = mkdir(&root, "notepad-ohos");
        touch(&product_outside, "build-profile.json5");
        mkdir(&product_outside, "entry");
        mkdir(&product_outside, TEMPLATE_MARKER_DIR);
        let fresh = mkdir(&root, "new-output");

        assert!(is_migration_output_artifact(&product_in_container));
        assert!(is_migration_output_artifact(&product_outside));
        assert!(!is_migration_output_artifact(&container));
        assert!(!is_migration_output_artifact(&fresh));
    }

    #[test]
    fn managed_template_survives_migrated_project_exclusion() {
        // 官方模板自身就是完整鸿蒙工程结构（build-profile + entry + marker），
        // 不得被"已迁移工程"排除逻辑误伤；输出容器内的迁移产物则被排除。
        let (_t, root) = tree();
        let managed_root = root.join("managed");
        let managed_tpl = managed_root.join("templates").join("qt5.12");
        create_template(&managed_tpl);
        let output_container = mkdir(&root, "output");
        let migrated_tpl_like = mkdir(&output_container, "calc-ohos");
        create_template(&migrated_tpl_like);

        let probe = probe_qt_migration_candidates(&root, "", &managed_root, &HashMap::new());

        assert!(probe.managed_template_available);
        assert!(probe.candidates["template"]
            .iter()
            .any(|p| path_key(Path::new(p)) == path_key(&managed_tpl)));
        assert!(probe.candidates["template"]
            .iter()
            .all(|p| path_key(Path::new(p)) != path_key(&migrated_tpl_like)));
    }

    #[test]
    fn migrated_product_outside_container_is_not_a_template_candidate() {
        // 上次迁移的产物可能不在任何输出容器内（如源工程旁的 xxx-ohos），
        // 位置判据拦不住它；命名判据（*-ohos）负责把它挡在模板候选之外。
        // 同结构、非迁移命名的目录（官方模板放入 workspace 的形态）不受影响。
        let (_t, root) = tree();
        let managed_root = root.join("managed");
        let migrated = mkdir(&root, "calculator-ohos");
        create_template(&migrated);
        let official = mkdir(&root, "qt-official-template");
        create_template(&official);

        let probe = probe_qt_migration_candidates(&root, "", &managed_root, &HashMap::new());

        assert!(probe.candidates["template"]
            .iter()
            .any(|p| path_key(Path::new(p)) == path_key(&official)));
        assert!(probe.candidates["template"]
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
    fn prompt_named_output_ranks_before_output_container() {
        let (_t, root) = tree();
        let output_dir = mkdir(&root, "output-project");
        let model_dir = mkdir(&root, "model-output");
        let model = candidate_map(
            "output_project",
            vec![model_dir.to_string_lossy().into_owned()],
        );

        let probe = probe_qt_migration_candidates(&root, "", &root.join("managed"), &model);

        // Prompt-named output ranks first; output-container dirs follow.
        assert_eq!(
            probe.candidates["output_project"],
            vec![
                model_dir.to_string_lossy().into_owned(),
                output_dir.to_string_lossy().into_owned(),
            ]
        );
    }

    #[test]
    fn workspace_service_output_is_merged_after_model_candidate() {
        let (_t, root) = tree();
        let workspace_output = root.join("迁移工程").to_string_lossy().into_owned();
        let model_output = mkdir(&root, "model-output").to_string_lossy().into_owned();

        let candidates = merge_workspace_output_candidates(
            &root,
            &[model_output.clone()],
            &[],
            &[workspace_output.clone()],
        );

        // Prompt-named candidate outranks the workspace service output dir.
        assert_eq!(candidates, vec![model_output, workspace_output]);
    }

    #[test]
    fn prompt_named_toolchain_ranks_first() {
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
            &model,
        );

        // Prompt-named toolchain ranks first; workspace/managed fill the rest.
        let toolchains = &probe.candidates["toolchain"];
        assert_eq!(toolchains.len(), 2);
        assert_eq!(path_key(Path::new(&toolchains[0])), path_key(&model_bin));
        assert_eq!(path_key(Path::new(&toolchains[1])), path_key(&path_bin));
    }

    #[test]
    fn valid_model_template_ranks_before_backend_discovery() {
        let (_t, root) = tree();
        let backend_template = mkdir(&root, "a-template");
        create_template(&backend_template);
        let deep_model_template = root.join("one/two/three/four/five/model-template");
        create_template(&deep_model_template);
        let model = candidate_map(
            "template",
            vec![deep_model_template.to_string_lossy().into_owned()],
        );

        let probe = probe_qt_migration_candidates(&root, "", &root.join("managed"), &model);

        assert_eq!(
            probe.candidates["template"],
            vec![
                deep_model_template.to_string_lossy().into_owned(),
                backend_template.to_string_lossy().into_owned(),
            ]
        );
    }

    #[test]
    fn prompt_named_source_container_descends_to_project_roots() {
        // 用户填的是工程的上级目录（.pro 在子目录），且该目录在工作区外：
        // 必须下钻找到真实工程根作为候选，而不是丢弃。
        let (_t, root) = tree();
        let outside = tempfile::tempdir().unwrap();
        let project = mkdir(&outside.path(), "notepad--");
        touch(&project, "RealCompare.pro");
        let model = candidate_map(
            "source_project",
            vec![outside.path().to_string_lossy().into_owned()],
        );

        let probe = probe_qt_migration_candidates(&root, "", &root.join("managed"), &model);

        assert_eq!(
            probe.candidates["source_project"],
            vec![project.to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn prompt_named_toolchain_sdk_root_descends_to_bin() {
        // 用户填的是 Qt SDK 根目录（qmake 在 <root>/bin/qmake）且在工作区外：
        // 必须下钻找到实际包含 qmake 的 bin 目录。
        let (_t, root) = tree();
        let sdk_tmp = tempfile::tempdir().unwrap();
        let sdk = mkdir(&sdk_tmp.path(), "Qt5.12.12");
        let bin = mkdir(&sdk, "bin");
        touch(&bin, "qmake.exe");
        let model = candidate_map("toolchain", vec![sdk.to_string_lossy().into_owned()]);

        let probe = probe_qt_migration_candidates(&root, "", &root.join("managed"), &model);

        assert_eq!(probe.candidates["toolchain"].len(), 1);
        assert_eq!(
            path_key(Path::new(&probe.candidates["toolchain"][0])),
            path_key(&bin)
        );
    }

    #[test]
    fn prompt_named_template_parent_descends_to_template_dir() {
        // 用户填的是模板工程的上级目录（如解压根）且在工作区外：必须下钻。
        let (_t, root) = tree();
        let tpl_tmp = tempfile::tempdir().unwrap();
        let tpl = mkdir(&tpl_tmp.path(), "qt5.12");
        create_template(&tpl);
        let parent = tpl.parent().unwrap().to_path_buf();
        let model = candidate_map("template", vec![parent.to_string_lossy().into_owned()]);

        let probe = probe_qt_migration_candidates(&root, "", &root.join("managed"), &model);

        assert_eq!(probe.candidates["template"].len(), 1);
        assert_eq!(
            path_key(Path::new(&probe.candidates["template"][0])),
            path_key(&tpl)
        );
    }

    #[test]
    fn prompt_named_nonexistent_paths_stay_filtered() {
        // 下钻不放松存在性要求：不存在的路径在任何字段都不能成为候选。
        let (_t, root) = tree();
        let model = candidate_map(
            "toolchain",
            vec![root.join("no-such-sdk").to_string_lossy().into_owned()],
        );
        let template_model = candidate_map(
            "template",
            vec![root.join("no-such-template").to_string_lossy().into_owned()],
        );
        let mut model_map = model;
        model_map.extend(template_model);

        let probe = probe_qt_migration_candidates(&root, "", &root.join("managed"), &model_map);

        assert!(probe.candidates["toolchain"].is_empty());
        assert!(probe.candidates["template"].is_empty());
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
    fn cmake_qt_project_is_a_source_candidate() {
        // 探测依据与 ohos-qt-skills 阶段零预检一致：qmake .pro 之外，
        // 含 find_package(Qt…) 的 CMakeLists.txt 工程同样是 Qt 工程
        // （coin3d / SARibbon 等 CMake 型项目均属此类）。
        let (_t, root) = tree();
        std::fs::write(
            root.join("CMakeLists.txt"),
            "cmake_minimum_required(VERSION 3.16)\nfind_package(Qt5 COMPONENTS Widgets REQUIRED)\nadd_executable(app main.cpp)\n",
        )
        .unwrap();
        touch(&root, "main.cpp");

        assert_eq!(
            probe_source_projects(&root, &[]),
            vec![root.to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn cmake_without_qt_is_not_a_source_candidate() {
        let (_t, root) = tree();
        std::fs::write(
            root.join("CMakeLists.txt"),
            "cmake_minimum_required(VERSION 3.16)\nproject(plain C)\nadd_library(foo foo.c)\n",
        )
        .unwrap();

        assert_eq!(probe_source_projects(&root, &[]), Vec::<String>::new());
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
    fn source_projects_cap_is_two_and_noise_dir_is_skipped() {
        let (_t, root) = tree();
        for n in ["a", "b", "c", "d"] {
            let d = mkdir(&root, n);
            touch(&d, &format!("{n}.pro"));
        }
        let build = mkdir(&root, "build");
        touch(&build, "build.pro");
        let hits = probe_source_projects(&root, &[]);
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().all(|h| !h.contains("build")));
    }

    #[test]
    fn toolchain_prefers_workspace_then_managed_then_path() {
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

        // Workspace qmake outranks PATH entries (PATH is the last resort).
        let path_env = format!("{};{}", dir1.to_string_lossy(), dir2.to_string_lossy());
        let managed_root = root.join("managed");
        let hits = probe_toolchains(&root, &path_env, &managed_root, &[]);
        assert_eq!(
            hits,
            vec![
                ws_bin.to_string_lossy().into_owned(),
                dir1.to_string_lossy().into_owned()
            ],
            "workspace qmake fills default; first PATH entry fills alternate"
        );

        // No workspace qmake -> PATH entries fill the list in PATH order.
        let empty_ws = tempfile::tempdir().expect("tempdir");
        let hits = probe_toolchains(empty_ws.path(), &path_env, &managed_root, &[]);
        assert_eq!(
            hits,
            vec![
                dir1.to_string_lossy().into_owned(),
                dir2.to_string_lossy().into_owned()
            ]
        );
    }

    #[test]
    fn workspace_toolchain_and_template_rank_before_managed() {
        let (_t, root) = tree();
        // Managed resources live outside the workspace in production; keep the
        // fixture faithful so the workspace scan cannot reach into them.
        let managed_tmp = tempfile::tempdir().expect("tempdir");
        let managed_root = managed_tmp.path().join("managed");
        let managed_bin = managed_root.join("toolchains").join("qt5.12").join("bin");
        std::fs::create_dir_all(&managed_bin).unwrap();
        touch(&managed_bin, "qmake");
        std::fs::create_dir_all(managed_bin.parent().unwrap().join("lib/cmake/Qt5")).unwrap();
        touch(
            &managed_bin.parent().unwrap().join("lib/cmake/Qt5"),
            "Qt5Config.cmake",
        );
        let managed_tpl = managed_root.join("templates").join("qt5.12");
        create_template(&managed_tpl);

        let workspace_bin = root.join("workspace-tools");
        std::fs::create_dir_all(&workspace_bin).unwrap();
        touch(&workspace_bin, "qmake");
        let workspace_tpl = root.join("workspace-template");
        create_template(&workspace_tpl);

        let probe = probe_qt_migration_candidates(&root, "", &managed_root, &HashMap::new());
        assert!(probe.managed_toolchain_available);
        assert!(probe.managed_template_available);
        // Workspace-local resources outrank the shared managed ones in both
        // fields (user confirmed priority).
        assert_eq!(
            probe.candidates["toolchain"][0],
            workspace_bin.to_string_lossy()
        );
        assert_eq!(
            probe.candidates["toolchain"][1],
            managed_bin.to_string_lossy()
        );
        assert_eq!(
            probe.candidates["template"][0],
            workspace_tpl.to_string_lossy()
        );
        assert_eq!(
            probe.candidates["template"][1],
            managed_tpl.to_string_lossy()
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
        let hits = probe_toolchains(&root, &path_env, &managed_root, &[]);
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
        let hits = probe_templates(&root, &managed_root, &[]);
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
        assert!(probe_templates(&root, &managed_root, &[]).is_empty());
    }

    #[test]
    fn marker_without_qt_files_is_not_a_template() {
        let (_t, root) = tree();
        let tpl = mkdir(&root, "templates");
        mkdir(&tpl, TEMPLATE_MARKER_DIR);
        let managed_root = root.join("managed");
        assert!(probe_templates(&root, &managed_root, &[]).is_empty());
    }

    #[test]
    fn plain_harmonyos_project_is_not_template() {
        let (_t, root) = tree();
        let plain = mkdir(&root, "plain_hm");
        mkdir(&plain, "entry");
        touch(&plain, "build-profile.json5");

        let managed_root = root.join("managed");
        assert!(probe_templates(&root, &managed_root, &[]).is_empty());
    }

    #[test]
    fn output_project_does_not_reuse_source_project() {
        let (_t, root) = tree();
        touch(&root, "app.pro");
        let managed_root = root.join("managed");
        let probe = probe_qt_migration_candidates(&root, "", &managed_root, &HashMap::new());
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
        let probe = probe_qt_migration_candidates(&root, "", &managed_root, &HashMap::new());
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
