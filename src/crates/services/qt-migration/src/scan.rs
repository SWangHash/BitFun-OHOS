//! Disk scanning for Qt migration candidates: toolchain kits, project
//! templates, source projects, and migration output projects.
//!
//! This is the card-facing view of the scan: one probe pass turns the disk
//! state into the candidate map the question card renders.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::detect::{
    detect_project_qt_major, detect_qt_major, is_ohos_target_kit, probe_source_projects,
    resolve_kit_root, resolve_template_kit_root,
};
use crate::layout::{qt_managed_kit_roots, QT_MANAGED_TOOLCHAINS_DIR_NAME};
use crate::output::{is_migration_artifact, is_output_container_name, merge_output_candidates};
use crate::strategy::recommend_toolchains;

pub struct QtMigrationCandidateProbe {
    pub candidates: HashMap<String, Vec<String>>,
    pub managed_toolchain_available: bool,
    pub managed_template_available: bool,
    /// The usable toolchain candidates the `toolchain` option list is built from, in
    /// **option order** ([`recommend_toolchains`]) and with the measured Qt facts so
    /// the card can render the version next to the path. Empty
    /// when the scan found no usable toolchain **and** when the default source
    /// project's generation has no kit on disk, which is the condition the template
    /// layer reads as "nothing to recommend" (and therefore as "offer the download
    /// option").
    pub toolchain_candidates: Vec<QtScanCandidate>,
    /// Qt major version of each `source_project` candidate, keyed by the candidate
    /// path. A separate list from the toolchain versions on purpose: the project
    /// version is read from the C++ API the sources use
    /// ([`detect_project_qt_major`]), not from a kit layout, and merging the two
    /// "version" facts would let a toolchain answer a question about a project.
    pub project_versions: Vec<(String, u8)>,
}

/// Upper bound on candidates per field (the backend keeps option lists short;
/// the question card renders default + alternate, so every field caps at 2).
pub(crate) const MAX_SOURCE_PROJECTS: usize = 2;
pub(crate) const MAX_OUTPUT_PROJECTS: usize = 2;
pub(crate) const MAX_TOOLCHAINS: usize = 2;
pub(crate) const MAX_TEMPLATES: usize = 2;
/// Depth bound of the **workspace-only** project probes (`source_project`
/// discovery, output containers, and the "is this inside a migrated project"
/// ancestry checks). The toolchain/template scan deliberately does not consult it:
pub(crate) const MAX_PROBE_DEPTH: usize = 4;
/// Upper bound on the shared scan's results per tier root, and on the ranked
/// candidate list it returns. Wider than the card's [`MAX_TOOLCHAINS`] /
/// [`MAX_TEMPLATES`], which bound *rendering* (the card offers a default plus an
/// alternate): the scan inspects every priority tier across two Qt generations.
pub(crate) const MAX_SCAN_CANDIDATES: usize = 8;

/// Directory names that are never entered while scanning.
pub(crate) const NOISE_DIRS: &[&str] = &[
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
    // In-flight toolchain installs (`<toolchains>/<version_dir>/.installing-<uuid>`).
    // The staging tree holds `payload/<kit>/bin/qmake`, so without this skip a
    // download that is still running would be offered as a toolchain candidate —
    // and then fail the moment the installer publishes (or removes) it.
    ".installing-*",
];

/// Traversal guard of the shared scan. The walk has no depth bound, so two guards
/// are mandatory or it is unsafe:
pub(crate) struct ScanGuard {
    pub(crate) result_cap: usize,
    visited: HashSet<PathBuf>,
}

impl ScanGuard {
    pub(crate) fn new(result_cap: usize) -> Self {
        Self {
            result_cap,
            visited: HashSet::new(),
        }
    }

    /// Whether `dir` may be entered with `found` results collected. A directory
    /// already visited (directly or through a link) is not entered again.
    pub(crate) fn enter(&mut self, dir: &Path, found: usize) -> bool {
        if found >= self.result_cap {
            return false;
        }
        // dunce keeps the key free of the Windows `\\?\` prefix, so a directory
        // reached through a junction and directly still shares one key.
        let key = dunce::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
        self.visited.insert(key)
    }
}

/// Qt-for-HarmonyOS template marker directory (absent from plain OpenHarmony
/// projects). Qt5-only: the template predicate deliberately no longer requires it
/// . It is still one of the two signals that recognize an
/// already-migrated project structure — the other being the version-independent
/// three template files ([`is_inside_migrated_harmony_project`]), which is what
/// keeps a Qt6-shaped migration result detectable.
pub(crate) const TEMPLATE_MARKER_DIR: &str = "qEmbeddedUiExtensionHost";
pub(crate) const TEMPLATE_QT_CONSTANTS: &str = "entry/src/main/ets/common/QtAppConstants.ets";
pub(crate) const TEMPLATE_QABILITY: &str = "entry/src/main/ets/qability/QAbility.ets";
pub(crate) const TEMPLATE_QT_DECLARATIONS: &str = "entry/src/main/qt/libqohos.d.ts";

/// Executable names whose presence marks a toolchain candidate directory (the hit
/// predicate of every walking tier). It is not a version signal: the measured Qt6
/// package ships `bin/qmake` as well, so "qmake exists, therefore Qt5" would
/// misreport Qt6. The version comes from [`detect_qt_major`].
pub(crate) const QMAKE_EXECUTABLES: &[&str] = &["qmake", "qmake.exe"];

/// Qt6-only **type names** that decide a Qt *project*'s version.
/// The candidates key carrying the session-resolved toolchain probe results: the
/// directories the model reported for `qmake` / `qmake6` / `qt-cmake`. Unlike
/// `toolchain` (input-named, highest priority) these rank at the session-probe
/// tier — last, per the agreed toolchain priority: 输入 > 工作区 > 托管 >
/// 已知安装根 > 会话探测.
pub const SESSION_TOOLCHAIN_CANDIDATES_KEY: &str = "toolchain_env";

/// Executable names that mark the directory a session probe reported. The
/// measured Qt bins carry `qmake`, `qmake6`, and `qt-cmake`, and
/// a probe may be the only one of the three commands that resolved, so all three
/// families count here. The walking tiers keep the narrower
/// [`QMAKE_EXECUTABLES`] hit predicate.
pub(crate) const QMAKE_PROBE_EXECUTABLES: &[&str] = &[
    "qmake",
    "qmake.exe",
    "qmake.bat",
    "qmake6",
    "qmake6.exe",
    "qmake6.bat",
    "qt-cmake",
    "qt-cmake.bat",
];

/// Maximum session probe hits the tier consumes
/// .
pub(crate) const MAX_SESSION_PROBE_DIRS: usize = 3;

/// Pop the session-resolved toolchain probes from the candidate map so the scan
/// can consume them directly at the session-probe tier.
pub fn take_session_probe_dirs(candidates: &mut HashMap<String, Vec<String>>) -> Vec<String> {
    let Some(values) = candidates.remove(SESSION_TOOLCHAIN_CANDIDATES_KEY) else {
        return Vec::new();
    };
    let mut dirs: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for value in values {
        if dirs.len() >= MAX_SESSION_PROBE_DIRS {
            break;
        }
        let path = PathBuf::from(value.trim());
        if path.as_os_str().is_empty() {
            continue;
        }
        let dir = if path.is_file() {
            match path.parent() {
                Some(parent) => parent.to_path_buf(),
                None => continue,
            }
        } else if path.is_dir() {
            path
        } else {
            // Neither an existing file nor an existing directory: a fabricated path.
            continue;
        };
        if !holds_qmake_probe_executable(&dir) {
            continue;
        }
        let dir = dir.to_string_lossy().into_owned();
        if seen.insert(path_key(Path::new(&dir))) {
            dirs.push(dir);
        }
    }
    dirs
}

/// Whether `dir` directly holds a session probe executable (no traversal).
pub(crate) fn holds_qmake_probe_executable(dir: &Path) -> bool {
    QMAKE_PROBE_EXECUTABLES
        .iter()
        .any(|name| dir.join(name).is_file())
}

/// Returns candidates from the current workspace, BitFun-managed shared
/// resources, well-known Qt installation roots, and the session probe results.
pub fn probe_qt_migration_candidates(
    workspace: &Path,
    managed_root: &Path,
    model_candidates: &HashMap<String, Vec<String>>,
    session_probe_dirs: &[String],
    extra_known_install_roots: &[PathBuf],
) -> QtMigrationCandidateProbe {
    let scan = scan_qt_migration_candidates(
        workspace,
        managed_root,
        model_candidates,
        session_probe_dirs,
        extra_known_install_roots,
    );

    // Source projects come first: their measured Qt generations decide which kits
    // the toolchain options may offer, so both facts must be known before the option
    // list is built.
    let source_candidates = probe_source_projects(
        workspace,
        model_candidates
            .get("source_project")
            .map(Vec::as_slice)
            .unwrap_or_default(),
    );
    // Read the Qt version of every source candidate the list will render. The
    // candidate list is already capped, so this is at most [`MAX_SOURCE_PROJECTS`]
    // bounded walks of one project each.
    let project_versions: Vec<(String, u8)> = source_candidates
        .iter()
        .map(|path| (path.clone(), detect_project_qt_major(Path::new(path))))
        .collect();
    let usable_toolchains = scan
        .toolchains
        .iter()
        .filter(|candidate| candidate.is_usable_toolchain())
        .cloned()
        .collect::<Vec<_>>();
    let toolchain_candidates = recommend_toolchains(&usable_toolchains, &project_versions);
    // Managed availability is a fact about the managed roots, not about which
    // tier reported the candidate. [`rank_scan_candidates`] dedups by path and
    // keeps the lowest tier, so a managed path that also arrives from a
    // prompt-named tier loses its `Managed` source and would hide the
    // already-on-disk template behind the official download option.
    let managed_toolchains_prefix =
        format!("{}/", path_key(&managed_toolchains_root(managed_root)));
    let managed_templates_prefix = format!("{}/", path_key(&managed_root.join(TEMPLATE_DIR_NAME)));
    let managed_toolchain_available = scan.toolchains.iter().any(|candidate| {
        candidate.is_usable_toolchain()
            && path_key(Path::new(&candidate.path)).starts_with(&managed_toolchains_prefix)
    });
    let managed_template_available = scan.templates.iter().any(|candidate| {
        path_key(Path::new(&candidate.path)).starts_with(&managed_templates_prefix)
    });

    let mut out = HashMap::new();
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
        toolchain_candidates
            .iter()
            .map(|candidate| candidate.path.clone())
            .collect(),
    );
    out.insert(
        "template".to_string(),
        scan.templates
            .iter()
            .take(MAX_TEMPLATES)
            .map(|candidate| candidate.path.clone())
            .collect(),
    );
    QtMigrationCandidateProbe {
        candidates: out,
        managed_toolchain_available,
        managed_template_available,
        toolchain_candidates,
        project_versions,
    }
}
// ---------------------------------------------------------------------------

/// Managed toolchains root: the download target of the provisioning stage as well
/// as a scan tier.
pub(crate) fn managed_toolchains_root(managed_root: &Path) -> PathBuf {
    managed_root.join(QT_MANAGED_TOOLCHAINS_DIR_NAME)
}

/// Directory name of the managed templates root under the Qt migration root.
pub(crate) const TEMPLATE_DIR_NAME: &str = "templates";

/// Collect directories that directly contain a qmake executable, without a depth
/// bound. [`ScanGuard`] stops the walk at [`MAX_SCAN_CANDIDATES`] results and
/// breaks symlink loops; every tier root gets its own guard, so a saturated
/// workspace cannot starve the managed or the known-install-root tier.
pub(crate) fn scan_qmake_hits(root: &Path) -> Vec<PathBuf> {
    let mut hits = Vec::new();
    let mut guard = ScanGuard::new(MAX_SCAN_CANDIDATES);
    walk_qmake_hits(root, &mut guard, &mut hits);
    hits.sort();
    hits
}

/// Recursive half of [`scan_qmake_hits`]. A directory holding qmake is a hit and
/// terminates the descent: neither the kit root above it nor anything below the
/// `bin` directory can yield a second kit.
pub(crate) fn walk_qmake_hits(dir: &Path, guard: &mut ScanGuard, out: &mut Vec<PathBuf>) {
    if !guard.enter(dir, out.len()) {
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
        return;
    }
    for sub in subdirs {
        walk_qmake_hits(&sub, guard, out);
    }
}

/// Tier 0 — paths named in the prompt / echoed by the model. Recursive and not
/// restricted to the workspace: the user wrote the path, so a prompt-named SDK
/// root (`<root>/bin/qmake`) is descended into and the bin dir holding qmake is
/// offered.
pub(crate) fn input_named_toolchain_hits(
    workspace: &Path,
    input_candidates: &[String],
) -> Vec<PathBuf> {
    let mut hits: Vec<PathBuf> = Vec::new();
    for candidate in input_candidates {
        let Some(path) = normalize_workspace_candidate(workspace, candidate) else {
            continue;
        };
        if let Some(bin_dir) = normalize_toolchain_candidate(&path) {
            hits.push(bin_dir);
        } else if path.is_dir() {
            hits.extend(scan_qmake_hits(&path));
        }
    }
    hits.sort_by_key(|path| path_key(path));
    hits
}

/// Tier 2 — the managed toolchains root. The kit roots the layout table declares
/// (`<toolchains>/qt5.12.12`, `<toolchains>/qt6.13.0`)
/// are resolved first, so an installed kit is found deterministically (contract
/// C3: the paths the layout declares must be hit by the scan); a walk of the root
/// then covers kits the table does not declare (an older or user-copied kit).
pub(crate) fn managed_toolchain_hits(managed_root: &Path) -> Vec<PathBuf> {
    let toolchains_root = managed_toolchains_root(managed_root);
    let mut hits: Vec<PathBuf> = Vec::new();
    for kit in qt_managed_kit_roots(&toolchains_root) {
        let bin = kit.kit_root.join("bin");
        if QMAKE_EXECUTABLES
            .iter()
            .any(|name| bin.join(name).is_file())
        {
            hits.push(bin);
        }
    }
    hits.extend(scan_qmake_hits(&toolchains_root));
    hits
}

/// Tier 3 — well-known Qt installation roots, resolved with a deliberately
/// bounded glob.
pub(crate) fn known_install_root_hits(extra_roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut hits: Vec<PathBuf> = Vec::new();
    for root in known_qt_install_roots()
        .into_iter()
        .chain(extra_roots.iter().cloned())
    {
        hits.extend(scan_qmake_hits(&root));
    }
    hits
}

/// Well-known parent directories that hold Qt installations: every existing drive
/// root and the home directory, plus `/opt` on Unix.
pub(crate) fn known_qt_install_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if cfg!(windows) {
        for letter in b'A'..=b'Z' {
            let drive = PathBuf::from(format!("{}:\\", letter as char));
            if drive.is_dir() {
                roots.extend(qt_named_child_dirs(&drive));
            }
        }
    } else {
        roots.extend(qt_named_child_dirs(Path::new("/opt")));
    }
    if let Some(home) = dirs::home_dir() {
        roots.extend(qt_named_child_dirs(&home));
    }
    roots
}

/// Directories directly under `parent` whose name starts with `Qt`
/// (case-insensitive) — the Qt installer's naming convention (`Qt`, `Qt-6-12`).
/// One directory listing, no recursion.
pub(crate) fn qt_named_child_dirs(parent: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(parent) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .to_lowercase()
                .starts_with("qt")
        })
        .map(|entry| entry.path())
        .collect()
}

/// Tier 4 — the session probe results, consumed directly. No traversal: the value
/// is the directory the model reported (already normalized and validated by
/// [`take_session_probe_dirs`]), which is exactly the candidate a caller acts on.
/// The tier is fully dependent on the model having run the probe commands, and the
/// scan no longer falls back to inspecting `PATH` itself.
pub(crate) fn session_probe_toolchain_hits(session_probe_dirs: &[String]) -> Vec<PathBuf> {
    session_probe_dirs.iter().map(PathBuf::from).collect()
}

/// Collect directories that match the Qt-for-HarmonyOS template structure, without
/// a depth bound, returning `(depth, template root)` pairs. Migration-result
/// exclusion is applied by the caller (managed resources are never migration
/// results, so they skip the check).
pub(crate) fn scan_template_hits(root: &Path) -> Vec<(usize, PathBuf)> {
    let mut hits = Vec::new();
    let mut guard = ScanGuard::new(MAX_SCAN_CANDIDATES);
    walk_template_hits(root, 0, &mut guard, &mut hits);
    hits.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| path_key(&a.1).cmp(&path_key(&b.1)))
    });
    hits
}

/// Recursive half of [`scan_template_hits`].
pub(crate) fn walk_template_hits(
    dir: &Path,
    depth: usize,
    guard: &mut ScanGuard,
    out: &mut Vec<(usize, PathBuf)>,
) {
    if !guard.enter(dir, out.len()) {
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
        walk_template_hits(&sub, depth + 1, guard, out);
    }
}

/// Collect the template candidates of the three template tiers, priority-ordered
/// (`(tier, path)` pairs are ranked by the caller through [`rank_scan_candidates`]).
pub(crate) fn template_tier_hits(
    workspace: &Path,
    managed_root: &Path,
    input_candidates: &[String],
) -> Vec<(QtScanSource, PathBuf)> {
    let mut ranked: Vec<(QtScanSource, PathBuf)> = Vec::new();
    for candidate in input_candidates {
        let Some(path) = normalize_workspace_candidate(workspace, candidate) else {
            continue;
        };
        if is_qt_harmonyos_template(&path)
            && !is_migration_artifact_location(&path)
            && !is_migration_artifact(&path)
        {
            ranked.push((QtScanSource::InputNamed, path));
        } else if path.is_dir() {
            // Prompt-named parent (e.g. the extract root of a downloaded
            // template): descend and offer the template dirs actually found
            // inside, with the same migration-result exclusions as above.
            for (_, template) in scan_template_hits(&path) {
                if is_migration_artifact_location(&template) || is_migration_artifact(&template) {
                    continue;
                }
                ranked.push((QtScanSource::InputNamed, template));
            }
        }
    }
    // 已迁移产物不是可复用模板：上次迁移的工程结构同样满足模板三特征。
    // 位置判据（输出容器内）之外补充命名判据：迁移产物工程名规范为
    // `原工程名-ohos`，而官方模板目录名不带该后缀（如 `qt5.12`）。
    for (_, template) in scan_template_hits(workspace) {
        if !is_migration_artifact_location(&template) && !is_migration_artifact(&template) {
            ranked.push((QtScanSource::Workspace, template));
        }
    }
    for (_, template) in scan_template_hits(&managed_root.join(TEMPLATE_DIR_NAME)) {
        ranked.push((QtScanSource::Managed, template));
    }
    ranked
}

/// Whether `dir` is a Qt-for-HarmonyOS template.
pub(crate) fn is_qt_harmonyos_template(dir: &Path) -> bool {
    [
        TEMPLATE_QT_CONSTANTS,
        TEMPLATE_QABILITY,
        TEMPLATE_QT_DECLARATIONS,
    ]
    .iter()
    .all(|relative| dir.join(relative).is_file())
}

/// A path that lives inside an output container (`output-project`, `迁移工程`,
/// ...) is a migration result, never a reusable template or a fresh output
/// target. Structural checks are deliberately NOT used here: both the official
/// template and a migrated project share the same HarmonyOS project layout, so
/// only the location tells them apart.
pub(crate) fn is_migration_artifact_location(path: &Path) -> bool {
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

pub(crate) fn is_noise_dir(name: &str) -> bool {
    NOISE_DIRS.iter().any(|n| {
        if let Some(prefix) = n.strip_suffix('*') {
            name.to_lowercase().starts_with(&prefix.to_lowercase())
        } else {
            noise_key(name) == noise_key(n)
        }
    })
}

/// Case- and separator-insensitive key for a directory name: `ThirdParty`,
/// `third-party`, `third_party` and `thirdparty` are one name.
pub(crate) fn noise_key(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-' && *c != '_')
        .collect()
}

pub(crate) fn normalize_toolchain_candidate(candidate: &Path) -> Option<PathBuf> {
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
/// outside the workspace: a prompt-named path is user intent, not a workspace
/// scan hit, for every field (`toolchain`/`template`/`output_project`
/// legitimately live outside the workspace, and `source_project` may too).
pub(crate) fn normalize_workspace_candidate(workspace: &Path, candidate: &str) -> Option<PathBuf> {
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

pub(crate) fn dedup_paths(paths: &mut Vec<String>) {
    let mut seen = std::collections::HashSet::new();
    paths.retain(|path| seen.insert(path_key(Path::new(path))));
}

/// Case-insensitive comparison key (Windows and OHOS paths both fold case).
pub(crate) fn path_key(p: &Path) -> String {
    let key = p.to_string_lossy().replace('\\', "/").to_lowercase();
    key.strip_prefix("//?/").unwrap_or(&key).to_string()
}

/// Priority tier a candidate came from, declared in scan order:
/// input-named > workspace > managed > known install root > session probe, so the
/// derived ordering is the declaration order. The serialized tags
/// follow the tool response vocabulary (`"source": "input"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QtScanSource {
    /// Named by the request (the `toolchain` / `template` input).
    #[serde(rename = "input")]
    InputNamed,
    /// Found by the workspace scan.
    Workspace,
    /// Found under the BitFun-managed shared resources
    /// (`<managed_root>/toolchains`, `<managed_root>/templates`), including the
    /// kit roots the layout table declares.
    Managed,
    /// Found under a well-known Qt installation root (`C:\Qt`, `~/.Qt-6-12`,
    /// `/opt/Qt`,...) or one of the caller-supplied extra roots.
    #[serde(rename = "known_install_root")]
    KnownInstallRoot,
    /// Consumed from the session probe results the model reported
    /// (`qmake` / `qmake6` / `qt-cmake`); there is no `PATH` tier.
    #[serde(rename = "session_probe")]
    SessionProbe,
}

/// One scanned candidate: the resolved directory plus the facts measured on disk
/// for it. Nothing is inferred — an unrecognized layout reports `None` / `false`
/// instead of a guess.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QtScanCandidate {
    /// The directory a caller acts on: the directory holding qmake for a
    /// toolchain candidate, the template root for a template candidate.
    pub path: String,
    /// Qt major version of the kit the candidate belongs to, or `None` when the
    /// on-disk layout does not identify one.
    pub qt_major: Option<u8>,
    /// Whether the kit the candidate belongs to is an OHOS target kit. Not
    /// derivable from `qt_major`: a Qt6 host kit and a Qt6 target kit both
    /// report `Some(6)`.
    pub ohos_target_kit: bool,
    /// Priority tier the candidate came from.
    pub source: QtScanSource,
}

/// Result of [`scan_qt_migration_candidates`], priority-ordered per field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QtMigrationScanResult {
    pub toolchains: Vec<QtScanCandidate>,
    pub templates: Vec<QtScanCandidate>,
}

impl QtScanCandidate {
    /// Whether this candidate is a toolchain a HarmonyOS migration can actually
    /// use: an OHOS target kit whose Qt generation the on-disk layout identifies.
    pub(crate) fn is_usable_toolchain(&self) -> bool {
        self.qt_major.is_some() && self.ohos_target_kit
    }
}

/// The one Qt migration scan: the toolchain and template candidates a caller may
/// act on, each with its detected Qt major version and a provenance tag for the
/// tier it came from.
pub fn scan_qt_migration_candidates(
    workspace: &Path,
    managed_root: &Path,
    model_candidates: &HashMap<String, Vec<String>>,
    session_probe_dirs: &[String],
    extra_known_install_roots: &[PathBuf],
) -> QtMigrationScanResult {
    QtMigrationScanResult {
        toolchains: scan_toolchain_candidates(
            workspace,
            managed_root,
            model_candidates
                .get("toolchain")
                .map(Vec::as_slice)
                .unwrap_or_default(),
            session_probe_dirs,
            extra_known_install_roots,
        ),
        templates: scan_template_candidates(
            workspace,
            managed_root,
            model_candidates
                .get("template")
                .map(Vec::as_slice)
                .unwrap_or_default(),
        ),
    }
}

pub(crate) fn scan_toolchain_candidates(
    workspace: &Path,
    managed_root: &Path,
    input_candidates: &[String],
    session_probe_dirs: &[String],
    extra_known_install_roots: &[PathBuf],
) -> Vec<QtScanCandidate> {
    let mut ranked: Vec<(QtScanSource, PathBuf)> = Vec::new();

    let mut push_tier = |source: QtScanSource, hits: Vec<PathBuf>| {
        ranked.extend(hits.into_iter().map(|hit| (source, hit)));
    };
    push_tier(
        QtScanSource::InputNamed,
        input_named_toolchain_hits(workspace, input_candidates),
    );
    push_tier(QtScanSource::Workspace, scan_qmake_hits(workspace));
    push_tier(QtScanSource::Managed, managed_toolchain_hits(managed_root));
    push_tier(
        QtScanSource::KnownInstallRoot,
        known_install_root_hits(extra_known_install_roots),
    );
    push_tier(
        QtScanSource::SessionProbe,
        session_probe_toolchain_hits(session_probe_dirs),
    );

    rank_scan_candidates(ranked, |hit| {
        let kit_root = resolve_kit_root(hit);
        (detect_qt_major(kit_root), is_ohos_target_kit(kit_root))
    })
}

pub(crate) fn scan_template_candidates(
    workspace: &Path,
    managed_root: &Path,
    input_candidates: &[String],
) -> Vec<QtScanCandidate> {
    rank_scan_candidates(
        template_tier_hits(workspace, managed_root, input_candidates),
        |template| {
            // Both facts describe the kit the template belongs to, when its location
            // identifies one; a standalone template reports `None` /
            // `false`.
            match resolve_template_kit_root(template) {
                Some(kit_root) => (detect_qt_major(kit_root), is_ohos_target_kit(kit_root)),
                None => (None, false),
            }
        },
    )
}

/// Rank scan hits by tier and path, deduplicate them (the first tier a path
/// appears in wins), resolve the kit facts with `facts`, and cap the list at
/// [`MAX_SCAN_CANDIDATES`].
pub(crate) fn rank_scan_candidates(
    mut ranked: Vec<(QtScanSource, PathBuf)>,
    facts: impl Fn(&Path) -> (Option<u8>, bool),
) -> Vec<QtScanCandidate> {
    ranked.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| path_key(&a.1).cmp(&path_key(&b.1)))
    });
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    for (source, hit) in ranked {
        if !seen.insert(path_key(&hit)) {
            continue;
        }
        let (qt_major, ohos_target_kit) = facts(&hit);
        out.push(QtScanCandidate {
            path: hit.to_string_lossy().into_owned(),
            qt_major,
            ohos_target_kit,
            source,
        });
        if out.len() >= MAX_SCAN_CANDIDATES {
            break;
        }
    }
    out
}
