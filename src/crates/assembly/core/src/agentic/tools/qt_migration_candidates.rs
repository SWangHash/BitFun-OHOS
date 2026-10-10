//! Backend-owned candidate probing for the `qt-migration-paths` question card.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use bitfun_agent_runtime::qt_migration_intake_state::{
    QtMigrationIntakeStateSnapshot, QtMigrationVersionStrategy,
};
use bitfun_agent_runtime::qt_migration_layout::{
    qt_managed_kit_roots, QT_MANAGED_TOOLCHAINS_DIR_NAME,
};
use serde::{Deserialize, Serialize};

pub(crate) struct QtMigrationCandidateProbe {
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
const MAX_SOURCE_PROJECTS: usize = 2;
const MAX_OUTPUT_PROJECTS: usize = 2;
const MAX_TOOLCHAINS: usize = 2;
const MAX_TEMPLATES: usize = 2;
/// Depth bound of the **workspace-only** project probes (`source_project`
/// discovery, output containers, and the "is this inside a migrated project"
/// ancestry checks). The toolchain/template scan deliberately does not consult it:
const MAX_PROBE_DEPTH: usize = 4;
/// Upper bound on the shared scan's results per tier root, and on the ranked
/// candidate list it returns. Wider than the card's [`MAX_TOOLCHAINS`] /
/// [`MAX_TEMPLATES`], which bound *rendering* (the card offers a default plus an
/// alternate): the scan inspects every priority tier across two Qt generations.
const MAX_SCAN_CANDIDATES: usize = 8;

/// Directory names that are never entered while scanning.
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
    // In-flight toolchain installs (`<toolchains>/<version_dir>/.installing-<uuid>`).
    // The staging tree holds `payload/<kit>/bin/qmake`, so without this skip a
    // download that is still running would be offered as a toolchain candidate —
    // and then fail the moment the installer publishes (or removes) it.
    ".installing-*",
];

/// Traversal guard of the shared scan. The walk has no depth bound, so two guards
/// are mandatory or it is unsafe:
struct ScanGuard {
    result_cap: usize,
    visited: HashSet<PathBuf>,
}

impl ScanGuard {
    fn new(result_cap: usize) -> Self {
        Self {
            result_cap,
            visited: HashSet::new(),
        }
    }

    /// Whether `dir` may be entered with `found` results collected. A directory
    /// already visited (directly or through a link) is not entered again.
    fn enter(&mut self, dir: &Path, found: usize) -> bool {
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
const TEMPLATE_MARKER_DIR: &str = "qEmbeddedUiExtensionHost";
const TEMPLATE_QT_CONSTANTS: &str = "entry/src/main/ets/common/QtAppConstants.ets";
const TEMPLATE_QABILITY: &str = "entry/src/main/ets/qability/QAbility.ets";
const TEMPLATE_QT_DECLARATIONS: &str = "entry/src/main/qt/libqohos.d.ts";

/// Qt6 CMake package directory, relative to a kit root. Its presence is the
/// deciding version signal
/// .
const QT6_CMAKE_PACKAGE_DIR: &str = "lib/cmake/Qt6";
/// Qt5 CMake package directory, relative to a kit root. The Qt5 equivalent of
/// [`QT6_CMAKE_PACKAGE_DIR`]; the measured Qt6 package ships no `lib/cmake/Qt5`,
/// so the two signals cannot both match.
const QT5_CMAKE_PACKAGE_DIR: &str = "lib/cmake/Qt5";
/// OHOS platform plugin, relative to a kit root: shipped by a HarmonyOS target
/// kit, absent from a desktop host kit
/// .
const QT_OHOS_PLATFORM_PLUGIN: &str = "plugins/platforms/libqohos.so";

/// Executable names whose presence marks a toolchain candidate directory (the hit
/// predicate of every walking tier). It is not a version signal: the measured Qt6
/// package ships `bin/qmake` as well, so "qmake exists, therefore Qt5" would
/// misreport Qt6. The version comes from [`detect_qt_major`].
const QMAKE_EXECUTABLES: &[&str] = &["qmake", "qmake.exe"];

/// Qt6-only **type names** that decide a Qt *project*'s version.
const QT6_ONLY_TYPE_NAMES: &[&str] = &[
    "QInputDevice",
    "QPointingDevice",
    "QEventPoint",
    "QStringConverter",
    "QAnyStringView",
];

/// Source extensions read for a project's version evidence. Build declaration
/// files (`.pro`, `.pri`, `.cmake`, `CMakeLists.txt`) are *not* read: the
/// declaration classes were dropped from the criterion, and a real
/// project such as `notepad--` declares only `QT += core gui widgets …`, which
/// carries no version at all.
const PROJECT_VERSION_SOURCE_EXTENSIONS: &[&str] = &["cc", "cpp", "cxx", "h", "hpp", "hxx"];

/// Upper bound on the source files examined for version evidence in one project.
const MAX_PROJECT_VERSION_FILES: usize = 12000;

/// Upper bound on the `include(...)` files read while deciding whether a
/// `CMakeLists.txt` is a Qt project. Measured worst case: 24 file-like includes in
/// one real project's `CMakeLists.txt`. The cap only exists so that a generated or
/// hostile file cannot turn the predicate into an unbounded read.
const MAX_CMAKE_INCLUDES: usize = 64;

/// Lowercased CMake marker that declares Qt: `find_package(Qt5 …)`,
/// `find_package(Qt6 …)` and `find_package(Qt …)` all contain it.
const QT_FIND_PACKAGE_MARKER: &str = "find_package(qt";

/// Upper bound on the size of one source file read for version evidence. A larger
/// file is **skipped**, not truncated: a partial read still could not prove a type
/// name absent from the rest of the file, and a source file this large is a
/// generated or vendored artifact rather than hand-written project code.
const MAX_PROJECT_VERSION_FILE_BYTES: u64 = 512 * 1024;

/// The candidates key carrying the session-resolved toolchain probe results: the
/// directories the model reported for `qmake` / `qmake6` / `qt-cmake`. Unlike
/// `toolchain` (input-named, highest priority) these rank at the session-probe
/// tier — last, per the agreed toolchain priority: 输入 > 工作区 > 托管 >
/// 已知安装根 > 会话探测.
pub(crate) const SESSION_TOOLCHAIN_CANDIDATES_KEY: &str = "toolchain_env";

/// Executable names that mark the directory a session probe reported. The
/// measured Qt bins carry `qmake`, `qmake6`, and `qt-cmake`, and
/// a probe may be the only one of the three commands that resolved, so all three
/// families count here. The walking tiers keep the narrower
/// [`QMAKE_EXECUTABLES`] hit predicate.
const QMAKE_PROBE_EXECUTABLES: &[&str] = &[
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
const MAX_SESSION_PROBE_DIRS: usize = 3;

/// Pop the session-resolved toolchain probes from the candidate map so the scan
/// can consume them directly at the session-probe tier.
pub(crate) fn take_session_probe_dirs(
    candidates: &mut HashMap<String, Vec<String>>,
) -> Vec<String> {
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
fn holds_qmake_probe_executable(dir: &Path) -> bool {
    QMAKE_PROBE_EXECUTABLES
        .iter()
        .any(|name| dir.join(name).is_file())
}

// ---------------------------------------------------------------------------
// Qt kit detection

/// Whether a kit root is an **OHOS target kit** rather than a desktop host kit:
fn is_ohos_target_kit(kit_root: &Path) -> bool {
    kit_root.join(QT_OHOS_PLATFORM_PLUGIN).is_file()
}

/// Detected Qt major version of a kit root, or `None` when the on-disk layout
/// does not identify one.
fn detect_qt_major(kit_root: &Path) -> Option<u8> {
    if kit_root.join(QT6_CMAKE_PACKAGE_DIR).is_dir() {
        Some(6)
    } else if kit_root.join(QT5_CMAKE_PACKAGE_DIR).is_dir() {
        Some(5)
    } else {
        None
    }
}

/// Kit root behind a directory a qmake scan reported (a directory that directly
/// contains the executable, normally the kit's `bin` — the same shape
/// [`resolve_kit_root`] resolves as `parent`).
fn resolve_kit_root(hit_dir: &Path) -> &Path {
    let parent = hit_dir.parent().unwrap_or(hit_dir);
    if detect_qt_major(parent).is_some() || is_ohos_target_kit(parent) {
        parent
    } else {
        hit_dir
    }
}

/// Kit root a template directory belongs to, when its location identifies one.
fn resolve_template_kit_root(dir: &Path) -> Option<&Path> {
    dir.ancestors()
        .find(|ancestor| detect_qt_major(ancestor).is_some() || is_ohos_target_kit(ancestor))
}

/// Detected Qt major version of a **Qt source project**, read from its C++ code.
fn detect_project_qt_major(project_dir: &Path) -> u8 {
    detect_project_qt_major_within(project_dir, MAX_PROJECT_VERSION_FILES)
}

/// [`detect_project_qt_major`] with an explicit file budget, so the budget itself
/// is testable without building a fixture of thousands of files.
fn detect_project_qt_major_within(project_dir: &Path, file_budget: usize) -> u8 {
    let mut guard = ScanGuard::new(file_budget);
    let mut examined = 0usize;
    if project_uses_qt6_only_type(project_dir, &mut guard, &mut examined) {
        6
    } else {
        5
    }
}

/// Whether any source file under `dir` uses a Qt6-only type, stopping at the first
/// hit — the criterion is existence, so a hit needs no further traversal.
fn project_uses_qt6_only_type(dir: &Path, guard: &mut ScanGuard, examined: &mut usize) -> bool {
    if !guard.enter(dir, *examined) {
        return false;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    let mut subdirs: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        if *examined >= guard.result_cap {
            break;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            if is_noise_dir(&name)
                || is_migration_artifact(&path)
                || is_migration_artifact_location(&path)
            {
                continue;
            }
            subdirs.push(path);
            continue;
        }
        if !file_type.is_file() || !is_project_version_source_file(&name) {
            continue;
        }
        *examined += 1;
        if file_uses_qt6_only_type(&path) {
            return true;
        }
    }
    subdirs
        .into_iter()
        .any(|sub| project_uses_qt6_only_type(&sub, guard, examined))
}

/// Whether `name` is a C++ source file the version evidence is read from.
fn is_project_version_source_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    match lower.rsplit_once('.') {
        // An empty stem is a hidden file (`.h`), not a translation unit.
        Some((stem, extension)) => {
            !stem.is_empty() && PROJECT_VERSION_SOURCE_EXTENSIONS.contains(&extension)
        }
        None => false,
    }
}

/// Whether one source file uses a Qt6-only type.
fn file_uses_qt6_only_type(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if metadata.len() > MAX_PROJECT_VERSION_FILE_BYTES {
        return false;
    }
    let Ok(bytes) = std::fs::read(path) else {
        return false;
    };
    // Lossy rather than `read_to_string`: a non-UTF-8 source file (legacy GBK C++
    // is common) must stay searchable, and the lossy replacement preserves every
    // ASCII byte, which is all the needles contain.
    let text = String::from_utf8_lossy(&bytes);
    QT6_ONLY_TYPE_NAMES
        .iter()
        .any(|name| contains_qt6_only_type_name(&text, name))
}

/// Whether `haystack` mentions `name` where an identifier starts.
fn contains_qt6_only_type_name(haystack: &str, name: &str) -> bool {
    haystack.match_indices(name).any(|(index, _)| {
        !haystack[..index]
            .chars()
            .next_back()
            .map(|previous| previous.is_alphanumeric() || previous == '_')
            .unwrap_or(false)
    })
}

/// Returns candidates from the current workspace, BitFun-managed shared
/// resources, well-known Qt installation roots, and the session probe results.
pub(crate) fn probe_qt_migration_candidates(
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
    // Managed availability is a fact about the managed roots, not about which tier
    // reported the candidate. [`rank_scan_candidates`] dedups by path and keeps the
    // lowest tier, so a managed path that also arrives from a higher-priority tier
    // loses its `Managed` source: the model echoes the template path the skill just
    // prepared into `candidates.template` (prompt-named tier) on every migration,
    // which used to report "no managed template" and put the official *download*
    // option back next to the very template already on disk.
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

/// How the bound source project's generation relates to the bound toolchain's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum QtMigrationGenerationMismatch {
    /// At least one side could not be measured (an unreadable project, a toolchain
    /// path with no kit layout, or a source path that is not a Qt project at all):
    /// there is nothing to decide, so nothing is asked.
    Unknown,
    /// Both sides are the same generation.
    Matching(u8),
    /// The project is newer than the toolchain (`project` 6, `toolchain` 5).
    ProjectNewer { project: u8, toolchain: u8 },
    /// The project is older than the toolchain (`project` 5, `toolchain` 6).
    ProjectOlder { project: u8, toolchain: u8 },
}

impl QtMigrationGenerationMismatch {
    /// Instruction handed to the model once the mismatch is measured.
    pub(crate) fn strategy_instruction(self) -> Option<String> {
        let (project, toolchain) = self.measured_generations()?;
        let direction = self.strategy_accept_semantics()?;
        Some(format!(
            "## 迁移策略确认（系统约束，必须立即执行）\n\n\
             四项输入已绑定，但原始工程的 Qt 代与所选工具链的代不一致：原始工程 Qt{project}，工具链 Qt{toolchain}。\
             Qt 工程只用它写就的那一代构建，所以这一步必须由用户决定，不得自行假设。\n\n\
             你的下一步必须且只能调用 AskUserQuestion 向用户确认，问题文案、header 与选项文案都由你用用户当前的\
             语言自行撰写（不要照抄本指令的措辞，也不要传 templateId）：\n\
             - 只提一个问题，给出两个选项：一个表示接受按下面的方向执行本次迁移，一个表示不迁移。\n\
             - 同意的选项必须带 \"value\": \"{proceed}\"，不迁移的选项必须带 \"value\": \"{abort}\"。\
             这两个取值是运行时判断用户选择的唯一依据：文案随你写，取值必须是这两个字符串，否则运行时不接受。\n\
             - 不要给这个问题设置 inputPlaceholder（不要自由文本输入）。\n\
             {direction}\n\n\
             在用户作答之前禁止执行任何迁移副作用（写文件、构建、部署、删除）、禁止加载技能。\
             不要再次调用 {paths_template_id}：四项输入已经绑定，重复提问不算作答。",
            proceed = QT_MIGRATION_STRATEGY_PROCEED_VALUE,
            abort = QT_MIGRATION_STRATEGY_ABORT_VALUE,
            paths_template_id =
                bitfun_agent_runtime::qt_migration_question_templates::QT_MIGRATION_PATHS_TEMPLATE_ID,
        ))
    }

    /// What the *accept* option means in this direction, as the requirement the model
    /// has to satisfy when it writes (or re-writes) the question.
    pub(crate) fn strategy_accept_semantics(self) -> Option<String> {
        let (project, toolchain) = self.measured_generations()?;
        Some(match self {
            Self::ProjectNewer { .. } => format!(
                "- 本次属于**降级**：工程比工具链新一代（Qt{project} 工程 + Qt{toolchain} 工具链）。\
                 同意选项的文案必须让用户看懂这是\"用 Qt{toolchain} 工具链迁移 Qt{project} 工程（降级）\"，\
                 并点出代价：工程里 Qt{project}-only 的代码可能需要改写，部分可能编译不过；\
                 不迁移选项表示\"先换成 Qt{project} 工具链，再重新发起迁移\"。"
            ),
            Self::ProjectOlder { .. } => format!(
                "- 本次是**在版本不一致下继续**：工程比工具链老一代（Qt{project} 工程 + Qt{toolchain} 工具链）。\
                 同意选项的文案必须让用户看懂这是\"用 Qt{toolchain} 工具链继续迁移 Qt{project} 工程\"\
                 （工程与工具链版本不一致，存在 API 差异）；\
                 不迁移选项表示\"放弃本次迁移\"。"
            ),
            Self::Unknown | Self::Matching(_) => return None,
        })
    }

    /// Classify two measured generations.
    pub(crate) fn from_generations(project: u8, toolchain: u8) -> Self {
        match project.cmp(&toolchain) {
            std::cmp::Ordering::Equal => Self::Matching(project),
            std::cmp::Ordering::Greater => Self::ProjectNewer { project, toolchain },
            std::cmp::Ordering::Less => Self::ProjectOlder { project, toolchain },
        }
    }

    /// The two measured generations, when this is a real mismatch.
    pub(crate) fn measured_generations(self) -> Option<(u8, u8)> {
        match self {
            Self::ProjectNewer { project, toolchain }
            | Self::ProjectOlder { project, toolchain } => Some((project, toolchain)),
            Self::Unknown | Self::Matching(_) => None,
        }
    }
}

/// Option value the runtime reads as "the user accepted this migration".
pub(crate) const QT_MIGRATION_STRATEGY_PROCEED_VALUE: &str = "continue_migration";

/// Option value the runtime reads as "the user refused to migrate this project".
pub(crate) const QT_MIGRATION_STRATEGY_ABORT_VALUE: &str = "abort";

/// The decision a submitted version-strategy answer carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum QtMigrationStrategyAnswer {
    /// The user accepted the migration even though the generations differ.
    Proceed,
    /// The user refused to migrate this project.
    Abort,
}

/// Read the decision out of a submitted answer group, or `None` when it carries
/// neither value.
pub(crate) fn read_version_strategy_answer(
    answers: &serde_json::Value,
) -> Option<QtMigrationStrategyAnswer> {
    let answers = answers.as_object()?;
    let mut decided = None;
    for value in answers.values() {
        let tokens: Vec<&str> = match value {
            serde_json::Value::String(token) => vec![token.as_str()],
            serde_json::Value::Array(items) => {
                items.iter().filter_map(|item| item.as_str()).collect()
            }
            _ => continue,
        };
        for token in tokens {
            match token.trim() {
                QT_MIGRATION_STRATEGY_ABORT_VALUE => return Some(QtMigrationStrategyAnswer::Abort),
                QT_MIGRATION_STRATEGY_PROCEED_VALUE => {
                    decided = Some(QtMigrationStrategyAnswer::Proceed)
                }
                _ => {}
            }
        }
    }
    decided
}

/// The measured `(project, toolchain)` generations of the bound intake values, when
/// both sides are measurable and disagree.
pub(crate) fn measure_bound_generation_mismatch(
    snapshot: &QtMigrationIntakeStateSnapshot,
    official_qt_major: Option<u8>,
) -> Option<(u8, u8)> {
    let source_project = bound_intake_value(snapshot, "source_project")?;
    let toolchain = bound_intake_value(snapshot, "toolchain")?;
    match compare_bound_generations(Path::new(source_project), toolchain, official_qt_major) {
        QtMigrationGenerationMismatch::ProjectNewer { project, toolchain }
        | QtMigrationGenerationMismatch::ProjectOlder { project, toolchain } => {
            Some((project, toolchain))
        }
        QtMigrationGenerationMismatch::Unknown | QtMigrationGenerationMismatch::Matching(_) => None,
    }
}

/// The mismatch a pending strategy question recorded, for the surfaces that must
/// describe or validate it without touching the disk again.
pub(crate) fn pending_generation_mismatch(
    snapshot: &QtMigrationIntakeStateSnapshot,
) -> Option<QtMigrationGenerationMismatch> {
    match snapshot.version_strategy {
        QtMigrationVersionStrategy::Pending { project, toolchain } => Some(
            QtMigrationGenerationMismatch::from_generations(project, toolchain),
        ),
        _ => None,
    }
}

/// What an answered question means for the version-strategy flow of its session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum QtMigrationStrategyFollowUp {
    /// A strategy question is still open and the answer carried neither contract
    /// value: the runtime recorded nothing, so the model must ask again.
    MissingAnswer {
        mismatch: QtMigrationGenerationMismatch,
    },
    /// The answer carried a contract value while the session still has no decision:
    /// the runtime did not record it, so the question has to be asked again instead
    /// of the model assuming it took effect.
    NotRecorded {
        mismatch: QtMigrationGenerationMismatch,
    },
    /// The decision this session recorded, to be stated as a system fact.
    Decided {
        mismatch: QtMigrationGenerationMismatch,
        strategy: QtMigrationVersionStrategy,
    },
}

impl QtMigrationStrategyFollowUp {
    /// The measured `(project, toolchain)` generations behind this fact, if any.
    pub(crate) fn measured_generations(self) -> Option<(u8, u8)> {
        match self {
            Self::MissingAnswer { mismatch }
            | Self::NotRecorded { mismatch }
            | Self::Decided { mismatch, .. } => mismatch.measured_generations(),
        }
    }

    /// The mismatch this fact was built from, for the surfaces that need the
    /// direction (downgrade vs continue) rather than just the two numbers.
    pub(crate) fn mismatch(self) -> QtMigrationGenerationMismatch {
        match self {
            Self::MissingAnswer { mismatch }
            | Self::NotRecorded { mismatch }
            | Self::Decided { mismatch, .. } => mismatch,
        }
    }

    /// What the question's *accept* option has to mean, for the re-ask instructions
    /// that must not drop the direction the first instruction stated.
    pub(crate) fn strategy_accept_semantics(self) -> Option<String> {
        self.mismatch().strategy_accept_semantics()
    }
}

/// The version-strategy fact an answered non-template question carries, or `None`
/// when this session measured no mismatch (nothing to say about any question).
pub(crate) fn version_strategy_follow_up(
    snapshot: &QtMigrationIntakeStateSnapshot,
    answers: &serde_json::Value,
) -> Option<QtMigrationStrategyFollowUp> {
    let strategy = snapshot.version_strategy;
    let (project, toolchain) = strategy.measured_generations()?;
    let mismatch = QtMigrationGenerationMismatch::from_generations(project, toolchain);
    let answered = read_version_strategy_answer(answers);

    match (strategy, answered) {
        // Still open and unreadable: ask again the way the instruction requires.
        (QtMigrationVersionStrategy::Pending { .. }, None) => {
            Some(QtMigrationStrategyFollowUp::MissingAnswer { mismatch })
        }
        // Readable answer, no decision recorded: say so instead of staying silent,
        // which is what let a model keep asking without knowing the answer was lost.
        (QtMigrationVersionStrategy::Pending { .. }, Some(_)) => {
            Some(QtMigrationStrategyFollowUp::NotRecorded { mismatch })
        }
        (_, _) => Some(QtMigrationStrategyFollowUp::Decided { mismatch, strategy }),
    }
}

/// One bound intake field value, or `None` while the field cannot bind a value.
fn bound_intake_value<'a>(
    snapshot: &'a QtMigrationIntakeStateSnapshot,
    field: &str,
) -> Option<&'a str> {
    let state = snapshot.fields.get(field)?;
    if !state.state.can_bind_value() {
        return None;
    }
    state.value.as_deref()
}

/// Compare the bound source project's generation with the bound toolchain's.
pub(crate) fn compare_bound_generations(
    source_project: &Path,
    toolchain: &str,
    official_qt_major: Option<u8>,
) -> QtMigrationGenerationMismatch {
    let project_major = {
        // A bound path that is not a Qt project has no project generation to
        // compare; `detect_project_qt_major` answers 5 or 6 by construction, so the
        // Qt-project predicate is what keeps a mistyped path from asking a question.
        if is_qt_source_project(source_project) {
            Some(detect_project_qt_major(source_project))
        } else {
            None
        }
    };
    let toolchain_major =
        if bitfun_agent_runtime::qt_migration_intake_state::qt_migration_is_skill_managed_value(
            toolchain,
        ) {
            official_qt_major
        } else {
            detect_qt_major(resolve_kit_root(Path::new(toolchain)))
        };
    let (Some(project), Some(toolchain)) = (project_major, toolchain_major) else {
        return QtMigrationGenerationMismatch::Unknown;
    };
    QtMigrationGenerationMismatch::from_generations(project, toolchain)
}

/// The `toolchain` options of the card, in option order.
fn recommend_toolchains(
    usable_toolchains: &[QtScanCandidate],
    project_versions: &[(String, u8)],
) -> Vec<QtScanCandidate> {
    if project_versions.is_empty() {
        return usable_toolchains
            .iter()
            .take(MAX_TOOLCHAINS)
            .cloned()
            .collect();
    }
    let mut chosen: Vec<QtScanCandidate> = Vec::new();
    for (_, project_qt_major) in project_versions.iter().take(MAX_TOOLCHAINS) {
        let matched = usable_toolchains.iter().find(|candidate| {
            candidate.qt_major == Some(*project_qt_major)
                && !chosen.iter().any(|taken| taken.path == candidate.path)
        });
        // No kit of this project's generation: leave it unserved rather than
        // substituting the other generation. The other listed projects are served
        // by their own generations below, so the field is not emptied by this one.
        if let Some(candidate) = matched {
            chosen.push(candidate.clone());
        }
    }
    // Further kits of a generation this list needs fill the remaining slots in scan
    // order, so a project with two kits on disk still offers both.
    let needed: Vec<u8> = project_versions
        .iter()
        .map(|(_, qt_major)| *qt_major)
        .collect();
    for candidate in usable_toolchains {
        if chosen.len() >= MAX_TOOLCHAINS {
            break;
        }
        if !candidate
            .qt_major
            .is_some_and(|qt_major| needed.contains(&qt_major))
        {
            continue;
        }
        if !chosen.iter().any(|taken| taken.path == candidate.path) {
            chosen.push(candidate.clone());
        }
    }
    chosen
}

/// Whether the official toolchain package can serve a project the card lists, or
/// `None` when no project was measured. Only the installable-source build asks.
#[cfg(feature = "qt-toolchain")]
pub(crate) fn official_toolchain_serves_a_project(
    project_versions: &[(String, u8)],
    official_qt_major: u8,
) -> Option<bool> {
    if project_versions.is_empty() {
        return None;
    }
    Some(
        project_versions
            .iter()
            .any(|(_, qt_major)| *qt_major == official_qt_major),
    )
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

/// Whether `path` is the workspace root itself or lives under it.
fn is_inside_workspace(workspace: &Path, path: &Path) -> bool {
    let key = |p: &Path| path_key(&dunce::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()));
    let root = key(workspace);
    let candidate = key(path);
    candidate == root || candidate.starts_with(&format!("{root}/"))
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
    // A prompt-named `source_project` is user intent: when the named path is
    // itself a Qt project it is offered directly, wherever it lives. A named
    // *directory* (the common case is the project's parent directory, because the
    // `.pro` sits in a subdirectory) is descended, but only inside the workspace —
    // see the branch below. `toolchain`, `template`, and `output_project` accept
    // external paths freely: kits and templates legitimately live outside.
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
            // A prompt-named project outside the workspace has no
            // workspace-relative depth; `MAX_PROBE_DEPTH + 1` keeps it at tier
            // 0 (still ahead of every workspace scan hit) and behind a
            // prompt-named project that resolves inside the workspace.
            let depth = path
                .strip_prefix(workspace)
                .map(|relative| relative.components().count())
                .unwrap_or(MAX_PROBE_DEPTH + 1);
            found.push((0, depth, path));
        } else if path.is_dir() && is_inside_workspace(workspace, &path) {
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
/// `find_package(Qt…)`, directly or through a module it includes. One of the two
/// build systems the ohos-qt-skills pre-flight (阶段零) recognizes — qmake `.pro`
/// is the other. Detection criteria deliberately mirror the skill's analyzer
/// workflow so the backend probe and the model-driven migration flow agree on what
/// a Qt project is.
fn is_qt_cmake_project(dir: &Path) -> bool {
    let Ok(cmake) = std::fs::read_to_string(dir.join("CMakeLists.txt")) else {
        return false;
    };
    if cmake.to_ascii_lowercase().contains(QT_FIND_PACKAGE_MARKER) {
        return true;
    }
    // A project may resolve Qt in a module it includes instead of here. Measured:
    cmake_include_targets(&cmake)
        .iter()
        .any(|include| included_cmake_module_declares_qt(dir, include))
}

/// File-like `include(...)` targets of a `CMakeLists.txt`, in file order.

/// `include(CMakeParseArguments)` names a module resolved through
/// `CMAKE_MODULE_PATH`, not a file next to the script, so only targets that look
/// like a path (they contain a separator or end in `.cmake`) are returned.
fn cmake_include_targets(contents: &str) -> Vec<String> {
    let mut targets = Vec::new();
    for line in contents.lines() {
        let line = line.trim_start();
        if line.starts_with('#') {
            continue;
        }
        let Some(rest) = line.strip_prefix("include") else {
            continue;
        };
        let Some(rest) = rest.trim_start().strip_prefix('(') else {
            continue;
        };
        let Some(end) = rest.find(')') else {
            continue;
        };
        let target = rest[..end].trim().trim_matches('"').trim();
        if target.contains('/') || target.to_ascii_lowercase().ends_with(".cmake") {
            targets.push(target.to_string());
        }
        if targets.len() >= MAX_CMAKE_INCLUDES {
            break;
        }
    }
    targets
}

/// Whether the `.cmake` module `include` names, resolved next to the including
/// `CMakeLists.txt`, declares Qt. A missing, oversized, or unreadable module is
/// simply not evidence of Qt.
fn included_cmake_module_declares_qt(cmake_dir: &Path, include: &str) -> bool {
    let path = cmake_dir.join(include);
    let Ok(metadata) = std::fs::metadata(&path) else {
        return false;
    };
    if metadata.len() > MAX_PROJECT_VERSION_FILE_BYTES {
        return false;
    }
    std::fs::read_to_string(&path)
        .map(|text| text.to_ascii_lowercase().contains(QT_FIND_PACKAGE_MARKER))
        .unwrap_or(false)
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
            // A hidden directory is tooling or scratch space, never the user's
            // project source. Measured: the previous migration's scratch area is
            // `.qt-ohos-precheck/`, and the probe projects the migration created
            // inside it (`host-codegen`, `qt-hello`) were offered as "原始工程"
            // next to the real project. Dot-*files* are already skipped, for the
            // same reason.
            if is_noise_dir(&name) || name.starts_with('.') {
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

/// Whether `dir` is inside (or is) an already-migrated Qt-for-HarmonyOS project:
fn is_inside_migrated_harmony_project(dir: &Path) -> bool {
    dir.ancestors().take(MAX_PROBE_DEPTH + 2).any(|ancestor| {
        ancestor.join("build-profile.json5").is_file()
            && ancestor.join("entry").is_dir()
            && (ancestor.join(TEMPLATE_MARKER_DIR).is_dir() || is_qt_harmonyos_template(ancestor))
    })
}

/// Whether `path` is a previous migration product (or lives inside one):
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

/// Managed toolchains root: the download target of the provisioning stage as well
/// as a scan tier.
fn managed_toolchains_root(managed_root: &Path) -> PathBuf {
    managed_root.join(QT_MANAGED_TOOLCHAINS_DIR_NAME)
}

/// Directory name of the managed templates root under the Qt migration root.
const TEMPLATE_DIR_NAME: &str = "templates";

/// Collect directories that directly contain a qmake executable, without a depth
/// bound. [`ScanGuard`] stops the walk at [`MAX_SCAN_CANDIDATES`] results and
/// breaks symlink loops; every tier root gets its own guard, so a saturated
/// workspace cannot starve the managed or the known-install-root tier.
fn scan_qmake_hits(root: &Path) -> Vec<PathBuf> {
    let mut hits = Vec::new();
    let mut guard = ScanGuard::new(MAX_SCAN_CANDIDATES);
    walk_qmake_hits(root, &mut guard, &mut hits);
    hits.sort();
    hits
}

/// Recursive half of [`scan_qmake_hits`]. A directory holding qmake is a hit and
/// terminates the descent: neither the kit root above it nor anything below the
/// `bin` directory can yield a second kit.
fn walk_qmake_hits(dir: &Path, guard: &mut ScanGuard, out: &mut Vec<PathBuf>) {
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
fn input_named_toolchain_hits(workspace: &Path, input_candidates: &[String]) -> Vec<PathBuf> {
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
fn managed_toolchain_hits(managed_root: &Path) -> Vec<PathBuf> {
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
fn known_install_root_hits(extra_roots: &[PathBuf]) -> Vec<PathBuf> {
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
fn known_qt_install_roots() -> Vec<PathBuf> {
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
fn qt_named_child_dirs(parent: &Path) -> Vec<PathBuf> {
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
fn session_probe_toolchain_hits(session_probe_dirs: &[String]) -> Vec<PathBuf> {
    session_probe_dirs.iter().map(PathBuf::from).collect()
}

/// Collect directories that match the Qt-for-HarmonyOS template structure, without
/// a depth bound, returning `(depth, template root)` pairs. Migration-result
/// exclusion is applied by the caller (managed resources are never migration
/// results, so they skip the check).
fn scan_template_hits(root: &Path) -> Vec<(usize, PathBuf)> {
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
fn walk_template_hits(
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
fn template_tier_hits(
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
fn is_qt_harmonyos_template(dir: &Path) -> bool {
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
fn noise_key(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-' && *c != '_')
        .collect()
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
/// outside the workspace: a prompt-named path is user intent, not a workspace
/// scan hit, for every field (`toolchain`/`template`/`output_project`
/// legitimately live outside the workspace, and `source_project` may too).
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

// ---------------------------------------------------------------------------
// tool-facing scan (Qt toolchain/template provisioning)

/// Priority tier a candidate came from, declared in scan order:
/// input-named > workspace > managed > known install root > session probe, so the
/// derived ordering is the declaration order. The serialized tags
/// follow the tool response vocabulary (`"source": "input"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum QtScanSource {
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
pub(crate) struct QtScanCandidate {
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
pub(crate) struct QtMigrationScanResult {
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
pub(crate) fn scan_qt_migration_candidates(
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

fn scan_toolchain_candidates(
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

fn scan_template_candidates(
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
fn rank_scan_candidates(
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Directory prefix of an in-flight managed toolchain install, mirrored from
    /// the provisioner's `STAGING_DIR_PREFIX`; the scan's noise rule skips it.
    const STAGING_DIR_PREFIX: &str = ".installing-";

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

    /// Qt5-shaped template: the three Qt files plus the Qt5-only marker
    /// directory. Kept as the default fixture so existing Qt5 expectations do
    /// not change.
    fn create_template(root: &Path) {
        std::fs::create_dir_all(root.join(TEMPLATE_MARKER_DIR)).unwrap();
        create_qt6_template(root);
    }

    /// Qt6-shaped template: the same three Qt files, without
    /// `qEmbeddedUiExtensionHost/`.
    fn create_qt6_template(root: &Path) {
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

    /// Qt5 OHOS target kit: `bin/qmake`, the Qt5 CMake package, and the OHOS
    /// platform plugin. Returns the `bin` dir (the toolchain candidate).
    fn create_qt5_ohos_kit(root: &Path) -> PathBuf {
        let bin = mkdir(root, "bin");
        touch(&bin, "qmake");
        let cmake = mkdir(root, QT5_CMAKE_PACKAGE_DIR);
        touch(&cmake, "Qt5Config.cmake");
        let platforms = mkdir(root, "plugins/platforms");
        touch(&platforms, "libqohos.so");
        bin
    }

    /// Qt6 OHOS target kit with the measured `bin/` contents:
    /// `qmake`, `qmake6`, and `qt-cmake` all live in it, so a "qmake exists,
    /// therefore Qt5" rule would misreport this kit.
    fn create_qt6_ohos_kit(root: &Path) -> PathBuf {
        let bin = mkdir(root, "bin");
        for exe in ["qmake", "qmake6", "qt-cmake"] {
            touch(&bin, exe);
        }
        let cmake = mkdir(root, QT6_CMAKE_PACKAGE_DIR);
        touch(&cmake, "Qt6Config.cmake");
        let platforms = mkdir(root, "plugins/platforms");
        touch(&platforms, "libqohos.so");
        bin
    }

    /// Qt6 desktop host kit, mirroring the measured `mingw_64/` layout
    /// : `bin/qmake.exe` and the desktop platform plugin, no
    /// `libqohos.so`.
    fn create_qt6_host_kit(root: &Path) -> PathBuf {
        let bin = mkdir(root, "bin");
        touch(&bin, "qmake.exe");
        let cmake = mkdir(root, QT6_CMAKE_PACKAGE_DIR);
        touch(&cmake, "Qt6Config.cmake");
        let platforms = mkdir(root, "plugins/platforms");
        touch(&platforms, "qwindows.dll");
        bin
    }

    /// The tool-facing candidate for `path`, compared by path key.
    fn candidate_for<'a>(
        candidates: &'a [QtScanCandidate],
        path: &Path,
    ) -> Option<&'a QtScanCandidate> {
        candidates
            .iter()
            .find(|candidate| path_key(Path::new(&candidate.path)) == path_key(path))
    }

    fn candidate_map(field: &str, paths: Vec<String>) -> HashMap<String, Vec<String>> {
        HashMap::from([(field.to_string(), paths)])
    }

    /// Path-key view of a candidate list: separator- and case-agnostic, so a
    /// mixed-separator fixture path compares equal to the canonicalized option
    /// path on every host OS.
    fn keys(paths: &[String]) -> Vec<String> {
        paths.iter().map(|path| path_key(Path::new(path))).collect()
    }

    /// Best-effort canonical form of a fixture path, so a comparison against a
    /// candidate the probe canonicalized through
    /// [`normalize_workspace_candidate`] holds on hosts where the temp dir is
    /// reached through a symlink (e.g. macOS `/var` -> `/private/var`).
    fn canonical_or_self(path: &Path) -> PathBuf {
        dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
    }

    /// Card probe of a fixture tree with no session probe results and no extra
    /// known install roots, so a fixture never depends on the host environment.
    fn card_probe(
        workspace: &Path,
        managed_root: &Path,
        model: &HashMap<String, Vec<String>>,
    ) -> QtMigrationCandidateProbe {
        probe_qt_migration_candidates(workspace, managed_root, model, &[], &[])
    }

    /// Shared scan of a fixture tree (the probe above is a card-facing view of it).
    fn scan_tree(
        workspace: &Path,
        managed_root: &Path,
        model: &HashMap<String, Vec<String>>,
    ) -> QtMigrationScanResult {
        scan_qt_migration_candidates(workspace, managed_root, model, &[], &[])
    }

    /// Template candidate paths of a fixture tree, by path key.
    fn scanned_template_keys(workspace: &Path, managed_root: &Path) -> Vec<String> {
        keys(
            &scan_tree(workspace, managed_root, &HashMap::new())
                .templates
                .iter()
                .map(|candidate| candidate.path.clone())
                .collect::<Vec<_>>(),
        )
    }

    /// Path keys of the candidates that live under one of `roots`.
    fn under_roots(paths: &[String], roots: &[&Path]) -> Vec<String> {
        let prefixes = roots.iter().map(|root| path_key(root)).collect::<Vec<_>>();
        paths
            .iter()
            .map(|path| path_key(Path::new(path)))
            .filter(|key| prefixes.iter().any(|prefix| key.starts_with(prefix)))
            .collect()
    }

    /// `(tier, path key)` of the scanned toolchains that live under one of `roots`,
    /// in scan order.
    fn tiers_under_roots(
        scan: &QtMigrationScanResult,
        roots: &[&Path],
    ) -> Vec<(QtScanSource, String)> {
        let prefixes = roots.iter().map(|root| path_key(root)).collect::<Vec<_>>();
        scan.toolchains
            .iter()
            .filter(|candidate| {
                let key = path_key(Path::new(&candidate.path));
                prefixes.iter().any(|prefix| key.starts_with(prefix))
            })
            .map(|candidate| (candidate.source, path_key(Path::new(&candidate.path))))
            .collect()
    }

    #[test]
    fn model_source_candidate_fills_backend_scan_gap() {
        let (_t, root) = tree();
        let deep = root.join("one/two/three/four/five/model-project");
        std::fs::create_dir_all(&deep).unwrap();
        touch(&deep, "model.pro");
        let managed_root = root.join("managed");
        let model = candidate_map("source_project", vec![deep.to_string_lossy().into_owned()]);

        let probe = card_probe(&root, &managed_root, &model);

        // 比较用 path_key：候选项经 dunce 规范化（Windows 上是反斜杠），fixture
        // 字符串里的 `/` 不参与比较。
        assert_eq!(
            keys(&probe.candidates["source_project"]),
            keys(&[deep.to_string_lossy().into_owned()])
        );
    }

    #[test]
    fn model_source_candidate_from_pro_file_is_default() {
        let (_t, root) = tree();
        let project = mkdir(&root, "notepad--/src");
        let pro = project.join("RealCompare.pro");
        touch(&project, "RealCompare.pro");
        let model = candidate_map("source_project", vec![pro.to_string_lossy().into_owned()]);

        let probe = card_probe(&root, &root.join("managed"), &model);

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

        let probe = card_probe(&root, &root.join("managed"), &model);

        let source = &probe.candidates["source_project"];
        assert_eq!(source.len(), 2, "capped at two like every field");
        assert_eq!(path_key(Path::new(&source[0])), path_key(&model_b));
        assert_eq!(path_key(Path::new(&source[1])), path_key(&model_c));
        assert!(source
            .iter()
            .all(|path| path_key(Path::new(path)) != path_key(&migrated)));
    }

    #[test]
    fn workspace_external_source_project_is_accepted() {
        // 归属规则：prompt/模型显式给出的 source_project 候选本身是 Qt 工程时，
        // 即使在当前工作区之外也是用户意图，必须成为候选并占默认位（文件头优先级：
        let (_t, root) = tree();
        let inside = mkdir(&root, "inside-project");
        touch(&inside, "inside.pro");
        let outside = tempfile::tempdir().unwrap();
        let project = mkdir(outside.path(), "outside-project");
        touch(&project, "outside.pro");
        let model = candidate_map(
            "source_project",
            vec![project.to_string_lossy().into_owned()],
        );

        let probe = card_probe(&root, &root.join("managed"), &model);

        let source = &probe.candidates["source_project"];
        assert_eq!(source.len(), 2);
        assert_eq!(
            path_key(Path::new(&source[0])),
            path_key(&canonical_or_self(&project)),
            "工作区外 prompt 工程保留并占默认位"
        );
        assert_eq!(
            path_key(Path::new(&source[1])),
            path_key(&inside),
            "工作区扫描命中补位，排在 prompt 候选之后"
        );
    }
    #[test]
    fn workspace_relative_source_candidate_is_accepted() {
        // 工作区相对路径按工作区解析，天然在工作区内，必须保留。
        let (_t, root) = tree();
        let project = mkdir(&root, "relative-project");
        touch(&project, "relative.pro");
        let model = candidate_map("source_project", vec!["relative-project".to_string()]);

        let probe = card_probe(&root, &root.join("managed"), &model);

        assert_eq!(
            keys(&probe.candidates["source_project"]),
            keys(&[project.to_string_lossy().into_owned()])
        );
    }
    #[cfg(unix)]
    #[test]
    fn prompt_named_symlinked_container_descends_to_linked_project() {
        // 点名的链接容器仍要下钻：工作区归属按**解析后**的路径判断，这条链接解析
        // 后落在工作区内，所以下钻照常。解析到工作区外的链接不下钻，见
        // a_workspace_external_container_is_not_descended_to_harvest_projects。
        let (_t, root) = tree();
        let container = mkdir(&root, "real-container");
        let project = mkdir(&container, "linked-project");
        touch(&project, "linked.pro");
        let link = root.join("link-to-container");
        std::os::unix::fs::symlink(&container, &link).unwrap();
        let model = candidate_map("source_project", vec![link.to_string_lossy().into_owned()]);

        let probe = card_probe(&root, &root.join("managed"), &model);

        assert_eq!(
            keys(&probe.candidates["source_project"]),
            keys(&[canonical_or_self(&project).to_string_lossy().into_owned()]),
            "prompt 命名的链接容器必须下钻到其中的真实工程根"
        );
    }

    #[test]
    fn workspace_external_toolchain_and_template_are_kept() {
        // 工作区归属不限制任何字段的候选：工具链与模板本来就常在工作区外
        // （独立 SDK、下载解压的模板），显式指定是用户意图，必须保留。
        let (_t, root) = tree();
        let sdk_tmp = tempfile::tempdir().unwrap();
        let sdk = mkdir(&sdk_tmp.path(), "Qt5.12.12");
        let bin = create_qt5_ohos_kit(&sdk);
        let tpl_tmp = tempfile::tempdir().unwrap();
        let tpl = mkdir(&tpl_tmp.path(), "qt5.12");
        create_template(&tpl);
        let mut model = candidate_map("toolchain", vec![sdk.to_string_lossy().into_owned()]);
        model.extend(candidate_map(
            "template",
            vec![tpl.to_string_lossy().into_owned()],
        ));

        let probe = card_probe(&root, &root.join("managed"), &model);

        // 主机上第三级（已知安装根）也可能命中真实 Qt，过滤后只断言 fixture 候选。
        assert_eq!(
            under_roots(&probe.candidates["toolchain"], &[sdk_tmp.path()]),
            keys(&[bin.to_string_lossy().into_owned()])
        );
        assert_eq!(
            under_roots(&probe.candidates["template"], &[tpl_tmp.path()]),
            keys(&[tpl.to_string_lossy().into_owned()])
        );
    }
    #[test]
    fn prompt_named_source_project_outranks_workspace_scan() {
        // 排序意图（文件头）：prompt 指定的候选优先（tier 0），其后才是工作区扫描
        // 命中（tier 1）。默认位（options[0]，前端预选）始终是 prompt 命名的工程，
        // 不是扫描命中的那个。prompt 命名的工作区外工程同样占默认位，见
        // workspace_external_source_project_is_accepted。
        let (_t, root) = tree();
        let scanned = mkdir(&root, "a-workspace-project");
        touch(&scanned, "a.pro");
        let prompt_named = mkdir(&root, "z-prompt-project");
        touch(&prompt_named, "z.pro");
        let model = candidate_map(
            "source_project",
            vec![prompt_named.to_string_lossy().into_owned()],
        );

        let probe = card_probe(&root, &root.join("managed"), &model);

        assert_eq!(
            keys(&probe.candidates["source_project"]),
            keys(&[
                prompt_named.to_string_lossy().into_owned(),
                scanned.to_string_lossy().into_owned()
            ]),
            "prompt 命名的工程排在扫描命中之前，占默认位"
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
        let probe = card_probe(&root, &root.join("managed"), &model);
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

        let probe = card_probe(&root, &managed_root, &HashMap::new());

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

        let probe = card_probe(&root, &managed_root, &model);

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

        let probe = card_probe(&root, &managed_root, &model);

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

    /// A HarmonyOS project carrying the Qt6 template shape: the
    /// three Qt files, **no** `qEmbeddedUiExtensionHost/` marker directory.
    fn create_qt6_migrated_project(root: &Path) {
        touch(root, "build-profile.json5");
        mkdir(root, "entry");
        create_qt6_template(root);
    }
    #[test]
    fn qt6_shaped_migrated_product_is_not_offered_as_a_source_project() {
        // 同一条判据在卡片探测里的效果：Qt6 产物即使含 `.pro` 也不作为源工程候选，
        // 也不能被绑成输出目录。
        let (_t, root) = tree();
        let product = mkdir(&root, "calculator-ohos");
        create_qt6_migrated_project(&product);
        touch(&product, "calculator.pro");
        let output_container = mkdir(&root, "output-project");

        let model = candidate_map(
            "source_project",
            vec![product.to_string_lossy().into_owned()],
        );
        let probe = card_probe(&root, &root.join("managed"), &model);

        assert!(
            probe.candidates["source_project"]
                .iter()
                .all(|path| path_key(Path::new(path)) != path_key(&product)),
            "Qt6 迁移产物不得成为源工程候选: {:?}",
            probe.candidates["source_project"]
        );
        assert!(is_migration_output_artifact(
            &output_container.join("inner")
        ));
        assert!(!is_migration_output_artifact(&output_container));
    }
    #[test]
    fn in_flight_staging_kit_is_not_a_toolchain_candidate() {
        // 阶段二挂起项：正在下载的 `.installing-*` 里 `payload/bin/qmake` 已经存在，
        // 不能作为候选被递给用户（下载完成后该目录会被发布或删除）。
        let (_t, root) = tree();
        let managed_tmp = tempfile::tempdir().expect("tempdir");
        let managed_root = managed_tmp.path().join("managed");
        let version_dir = managed_root.join("toolchains").join("qt5.12.12");
        let staging_kit = version_dir
            .join(format!("{STAGING_DIR_PREFIX}2f0e4d1a").as_str())
            .join("payload");
        let staging_bin = create_qt5_ohos_kit(&staging_kit);

        let probe = card_probe(&root, &managed_root, &HashMap::new());

        assert!(
            !probe.managed_toolchain_available,
            "进行中的供给不算托管可用"
        );
        assert!(
            under_roots(&probe.candidates["toolchain"], &[managed_tmp.path()]).is_empty(),
            "staging 里的 kit 不得成为候选: {:?}",
            probe.candidates["toolchain"]
        );
        assert!(
            probe
                .toolchain_candidates
                .iter()
                .all(|candidate| path_key(Path::new(&candidate.path)) != path_key(&staging_bin)),
            "staging 的 bin 目录不得成为工具链候选"
        );
        assert!(
            staging_bin.join("qmake").is_file(),
            "fixture 确实造出了 staging kit"
        );

        // 同一棵树发布到布局路径后就是候选（判据本身没有变化）。
        let published = version_dir.clone();
        create_qt5_ohos_kit(&published);
        let probe = card_probe(&root, &managed_root, &HashMap::new());
        assert!(probe.managed_toolchain_available);
        assert_eq!(
            under_roots(&probe.candidates["toolchain"], &[managed_tmp.path()]),
            keys(&[published.join("bin").to_string_lossy().into_owned()])
        );
    }
    #[test]
    fn managed_template_survives_migrated_project_exclusion() {
        // 官方模板自身就是完整鸿蒙工程结构（build-profile + entry + marker），
        // 不得被"已迁移工程"排除逻辑误伤；输出容器内的迁移产物则被排除。
        let (_t, root) = tree();
        // 托管资源在生产中位于工作区之外；fixture 也照此摆放，否则工作区层会先
        // 命中它，去重后它的来源就不再是 Managed（托管可用性会判错）。
        let managed_tmp = tempfile::tempdir().expect("tempdir");
        let managed_root = managed_tmp.path().join("managed");
        let managed_tpl = managed_root.join("templates").join("qt5.12");
        create_template(&managed_tpl);
        let output_container = mkdir(&root, "output");
        let migrated_tpl_like = mkdir(&output_container, "calc-ohos");
        create_template(&migrated_tpl_like);

        let probe = card_probe(&root, &managed_root, &HashMap::new());

        assert!(probe.managed_template_available);
        assert!(probe.candidates["template"]
            .iter()
            .any(|p| path_key(Path::new(p)) == path_key(&managed_tpl)));
        assert!(probe.candidates["template"]
            .iter()
            .all(|p| path_key(Path::new(p)) != path_key(&migrated_tpl_like)));
    }
    #[test]
    fn prompt_named_toolchain_ranks_first() {
        let (_t, root) = tree();
        let ws_kit = mkdir(&root, "workspace-kit");
        let ws_bin = create_qt5_ohos_kit(&ws_kit);
        // 托管资源在生产中位于工作区之外；fixture 也照此摆放，否则工作区扫描会
        // 把它当成工作区命中并挤掉真正的第二候选。
        let managed_tmp = tempfile::tempdir().expect("tempdir");
        let managed_root = managed_tmp.path().join("managed");
        let managed_bin = create_qt5_ohos_kit(&managed_root.join("toolchains/qt5.12.12"));
        // 输入命名的工具链在工作区之外，避免工作区扫描把它当成另一条命中。
        let prompt_root = tempfile::tempdir().expect("prompt tempdir");
        let prompt_kit = mkdir(prompt_root.path(), "prompt-kit");
        let prompt_bin = create_qt6_ohos_kit(&prompt_kit);
        let model = candidate_map("toolchain", vec![prompt_kit.to_string_lossy().into_owned()]);

        let probe = card_probe(&root, &managed_root, &model);

        // Prompt-named toolchain ranks first; workspace fills the alternate slot.
        let toolchains = under_roots(
            &probe.candidates["toolchain"],
            &[&root, managed_tmp.path(), prompt_root.path()],
        );
        assert_eq!(toolchains.len(), 2, "card renders default + alternate");
        assert_eq!(toolchains[0], path_key(&prompt_bin));
        assert_eq!(toolchains[1], path_key(&ws_bin));
        assert!(
            !toolchains.contains(&path_key(&managed_bin)),
            "托管工具链在 2 个渲染位之后"
        );
    }
    #[test]
    fn prompt_named_source_container_descends_to_project_roots() {
        // 用户填的是工程的上级目录（.pro 在子目录）：必须下钻找到真实工程根作为
        // 候选，而不是丢弃。容器位于工作区内、且深于普通扫描的深度上限，所以
        // 这里的候选只能来自下钻。工作区外的容器**不**下钻，见
        // a_workspace_external_container_is_not_descended_to_harvest_projects。
        let (_t, root) = tree();
        let container = root
            .join("one")
            .join("two")
            .join("three")
            .join("four")
            .join("five");
        let project = mkdir(&container, "notepad--");
        touch(&project, "RealCompare.pro");
        let model = candidate_map(
            "source_project",
            vec![container.to_string_lossy().into_owned()],
        );

        let probe = card_probe(&root, &root.join("managed"), &model);

        assert_eq!(
            keys(&probe.candidates["source_project"]),
            keys(&[project.to_string_lossy().into_owned()])
        );
    }

    #[test]
    fn a_workspace_external_container_is_not_descended_to_harvest_projects() {
        // 用户真机反馈：工作区里没有 Qt 工程时，卡片却把"工作区兄弟目录里的 Qt
        // 工程"填成了原始工程候选，还占了默认位。触发点是一个**工作区外的容器
        // 目录**（模型回声或 prompt 解析给出的）被下钻了——下钻不是"解析用户指的
        // 那个工程"，而是把那棵树里的工程全收成候选。
        let (_t, root) = tree();
        let inside = mkdir(&root, "inside-project");
        touch(&inside, "inside.pro");
        let outside = tempfile::tempdir().unwrap();
        let project = mkdir(&outside.path(), "notepad--");
        touch(&project, "RealCompare.pro");
        let model = candidate_map(
            "source_project",
            vec![outside.path().to_string_lossy().into_owned()],
        );

        let probe = card_probe(&root, &root.join("managed"), &model);

        assert_eq!(
            keys(&probe.candidates["source_project"]),
            keys(&[inside.to_string_lossy().into_owned()]),
            "工作区外的容器不得下钻：候选只能是工作区自己的工程"
        );
    }

    #[test]
    fn workspace_scan_does_not_reach_outside_the_workspace() {
        // 工作区扫描是唯一的"后端自行发现"来源，且按构造只读取工作区根之下：
        // prompt 未命名的外部工程绝不能进入 source_project 候选。
        let (_t, root) = tree();
        let scanned = mkdir(&root, "workspace-project");
        touch(&scanned, "ws.pro");
        let outside = tempfile::tempdir().unwrap();
        let external = mkdir(&outside.path(), "external-project");
        touch(&external, "ext.pro");

        let probe = card_probe(&root, &root.join("managed"), &HashMap::new());

        assert_eq!(
            keys(&probe.candidates["source_project"]),
            keys(&[scanned.to_string_lossy().into_owned()]),
            "工作区扫描不得越出工作区根"
        );
        assert!(probe.candidates["source_project"]
            .iter()
            .all(|path| path_key(Path::new(path)) != path_key(&external)));
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

        let probe = card_probe(&root, &root.join("managed"), &model_map);

        // 只断言 fixture 里的伪造路径没进来：第三级可能命中主机上的真实 Qt。
        assert!(under_roots(&probe.candidates["toolchain"], &[&root]).is_empty());
        assert!(probe.candidates["template"].is_empty());
    }

    #[test]
    fn source_projects_sorted_original_before_artifact_then_depth_then_alpha() {
        let (_t, root) = tree();
        let deep = mkdir(&root, "deep");
        let inner = mkdir(&deep, "inner_qapp"); // depth 2 project: .pro under deep/inner_qapp
        touch(&inner, "inner_qapp.pro");
        touch(&root, "zapp.pro"); // workspace root is itself a project (depth 0)
        touch(&root, "aapp.pro"); // same root project, lexicographically first file
        let mid = mkdir(&root, "mid"); // depth 1 project
        touch(&mid, "mid.pro");
        let artifact = mkdir(&root, "myapp-ohos");
        touch(&artifact, "myapp-ohos.pro"); // migration artifact at depth 1
        let later = mkdir(&root, "zz-later"); // depth 1 project behind the alpha keys
        touch(&later, "later.pro");

        let hits = probe_source_projects(&root, &[]);
        // 排序：原始工程（浅者优先，再按路径键）在迁移产物之前；MAX_SOURCE_PROJECTS
        // 上限为 2，所以只有前两个进入候选项，更深的工程被截断。
        assert_eq!(
            hits,
            vec![
                root.to_string_lossy().into_owned(),
                mid.to_string_lossy().into_owned()
            ],
            "浅者优先且按路径键排序；2 上限截断更深的工程"
        );
        assert!(
            hits.iter()
                .all(|h| h != &artifact.to_string_lossy().into_owned()),
            "迁移产物排在原始工程之后（并被上限截断）"
        );
    }
    #[test]
    fn cmake_qt_project_is_a_source_candidate() {
        // 探测依据与 ohos-qt-skills 阶段零预检一致：qmake.pro 之外，
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

    /// The measured project shape behind the "one project, two candidates" report:
    /// the root resolves Qt inside a module it includes, while the vendored
    /// subprojects under `ThirdParty/` spell `find_package(Qt…)` themselves.
    fn create_indirect_qt_project(root: &Path) {
        std::fs::write(
            root.join("CMakeLists.txt"),
            "cmake_minimum_required(VERSION 3.16)\ninclude(cmake/external/qt/package.cmake)\n",
        )
        .unwrap();
        let cmake = mkdir(root, "cmake/external/qt");
        std::fs::write(
            cmake.join("package.cmake"),
            "find_package(Qt${QT_VERSION_MAJOR} COMPONENTS Core Gui REQUIRED)\n",
        )
        .unwrap();
    }
    #[test]
    fn a_vendored_subproject_is_not_offered_next_to_the_project_that_owns_it() {
        // 用户真机反馈：telegram 工程被"识别成两个 Qt 工程"，而实际候选是两个
        // vendored 子工程。根工程走 include 解析 Qt（这里复刻），ThirdParty 下的
        // KDE 子工程自己写 find_package(Qt…) —— 只有主工程能成为候选。
        let (_t, root) = tree();
        create_indirect_qt_project(&root);
        let sub = mkdir(&root, "Telegram");
        std::fs::write(sub.join("CMakeLists.txt"), "project(sub C)\n").unwrap();
        for vendored in ["ThirdParty/kcoreaddons", "ThirdParty/kimageformats"] {
            let dir = mkdir(&sub, vendored);
            std::fs::write(
                dir.join("CMakeLists.txt"),
                "find_package(Qt5 COMPONENTS Core REQUIRED)\n",
            )
            .unwrap();
        }

        // 工作区扫描：主工程是唯一候选。
        let scanned = probe_source_projects(&root, &[]);
        assert_eq!(scanned, vec![root.to_string_lossy().into_owned()]);

        // prompt 里点名那个**不含** Qt 声明的子目录时同样不得退化成 vendored 子工程。
        let named = probe_source_projects(&root, &[sub.to_string_lossy().into_owned()]);
        assert_eq!(named, vec![root.to_string_lossy().into_owned()]);
        assert!(
            named.iter().all(|path| !path.contains("ThirdParty")),
            "vendored 子工程不得成为候选: {named:?}"
        );
    }

    #[test]
    fn a_hidden_working_directory_is_not_a_source_project() {
        // 实测：上一次迁移的暂存区是 `.qt-ohos-precheck/`，迁移过程在里面生成的
        // 探针工程（host-codegen / qt-hello）会作为"原始工程"挤进候选项，而用户
        // 要的只有主工程。
        let (_t, root) = tree();
        let main = mkdir(&root, "app");
        std::fs::write(
            main.join("CMakeLists.txt"),
            "find_package(Qt5 COMPONENTS Core REQUIRED)\n",
        )
        .unwrap();
        let scratch = mkdir(&root, ".qt-ohos-precheck/host-codegen");
        std::fs::write(
            scratch.join("CMakeLists.txt"),
            "find_package(Qt5 COMPONENTS Core REQUIRED)\n",
        )
        .unwrap();

        assert_eq!(
            probe_source_projects(&root, &[]),
            vec![main.to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn noise_dir_names_ignore_case_and_separators() {
        for name in ["ThirdParty", "third-party", "third_party", "THIRDPARTY"] {
            assert!(is_noise_dir(name), "{name} must be skipped as a noise dir");
        }
        for name in ["node_modules", "node-modules", "Node-Modules"] {
            assert!(is_noise_dir(name), "{name} must be skipped as a noise dir");
        }
        // 真实工程目录名不能被误伤。
        for name in ["Telegram", "src", "lib_ui", "SourceFiles", "third"] {
            assert!(!is_noise_dir(name), "{name} must stay scannable");
        }
    }

    /// Minimal Qt project fixture for the version detector: a CMake declaration
    /// that only has to make the directory a Qt project (`find_package(Qt…)`) plus
    /// one `.cpp` carrying `source`. No real project is used — the four samples the
    /// criterion was verified against (`D:\lzs\qt-test\*`) are hundreds of megabytes
    /// and must not enter the repository.
    fn create_version_fixture(root: &Path, declaration: &str, source: &str) {
        std::fs::write(
            root.join("CMakeLists.txt"),
            format!("cmake_minimum_required(VERSION 3.16)\n{declaration}\n"),
        )
        .unwrap();
        let src = mkdir(root, "src");
        std::fs::write(src.join("main.cpp"), source).unwrap();
    }

    #[test]
    fn project_qt_major_reads_the_code_not_the_build_declaration() {
        // 的代价：实现按「代码实际 API」判版，声明会骗人（canonic /
        // B23Downloader 都是声明 Qt5 却用 Qt6 API，各花 3–4 次编译 attempt）。
        // 两个 fixture 的声明**都是** Qt5，只有 Qt6 侧那行类型名决定结论。
        let (_t6, qt6_root) = tree();
        create_version_fixture(
            &qt6_root,
            "find_package(Qt5 COMPONENTS Widgets REQUIRED)",
            "// Qt6-only type in the Qt5-declaring project.\nQt6::QAnyStringView view;\n",
        );
        let (_t5, qt5_root) = tree();
        create_version_fixture(
            &qt5_root,
            "find_package(Qt5 COMPONENTS Widgets REQUIRED)",
            "#include <QApplication>\nint main() { return 0; }\n",
        );

        assert_eq!(detect_project_qt_major(&qt6_root), 6);
        assert_eq!(detect_project_qt_major(&qt5_root), 5);
    }

    #[test]
    fn project_qt_major_hits_every_listed_type_name() {
        for name in QT6_ONLY_TYPE_NAMES {
            let (_t, root) = tree();
            create_version_fixture(
                &root,
                "find_package(Qt6 COMPONENTS Gui REQUIRED)",
                &format!("#include <QtGui/{name}>\n"),
            );
            assert_eq!(
                detect_project_qt_major(&root),
                6,
                "{name} must be read as a Qt6-only type"
            );
        }
    }

    #[test]
    fn project_qt_major_requires_an_identifier_boundary() {
        // 方法名判据在真实工程上实测假阳性（tdesktop 自己定义了同名
        // `isInputEvent` lambda），所以判据只用类型名；类型名同样要挡住"用户
        // 函数名以它结尾"这一种撞名。
        let (_t, root) = tree();
        create_version_fixture(
            &root,
            "find_package(Qt5 COMPONENTS Gui REQUIRED)",
            "static auto MyQInputDevice = 1;\nstatic auto MyQEventPoint = 2;\n",
        );
        assert_eq!(detect_project_qt_major(&root), 5);

        // Qt 自己的私有类（`QEventPointPrivate`）以判据名开头，必须照常命中。
        let (_t2, qt6_root) = tree();
        create_version_fixture(
            &qt6_root,
            "find_package(Qt6 COMPONENTS Gui REQUIRED)",
            "QEventPointPrivate point;\n",
        );
        assert_eq!(detect_project_qt_major(&qt6_root), 6);
    }

    #[test]
    fn project_qt_major_skips_noise_dirs_and_migration_artifacts() {
        // NOISE_DIRS（build 等构建产物）与迁移产物都必须跳过：后者是 Qt6 形状的
        // 鸿蒙工程，读它等于把上次迁移的**输出**当成原始工程的版本。
        let (_t, root) = tree();
        create_version_fixture(
            &root,
            "find_package(Qt5 COMPONENTS Gui REQUIRED)",
            "int main() { return 0; }\n",
        );
        let build = mkdir(&root, "build");
        std::fs::write(build.join("generated.cpp"), "QAnyStringView view;\n").unwrap();
        let artifact = mkdir(&root, "app-ohos");
        std::fs::write(artifact.join("migrated.cpp"), "QPointingDevice device;\n").unwrap();

        assert_eq!(detect_project_qt_major(&root), 5);
    }

    #[test]
    fn project_qt_major_stops_at_the_file_budget() {
        // 预算只约束最坏情况（"没命中"要扫完），命中即停。文件先于子目录读，
        // 且根目录只有一个子目录，所以两种预算的结果与 read_dir 顺序无关。
        let (_t, root) = tree();
        std::fs::write(
            root.join("CMakeLists.txt"),
            "cmake_minimum_required(VERSION 3.16)\nfind_package(Qt6 COMPONENTS Gui REQUIRED)\n",
        )
        .unwrap();
        std::fs::write(root.join("clean.cpp"), "int main() { return 0; }\n").unwrap();
        let nested = mkdir(&root, "nested");
        std::fs::write(nested.join("uses_qt6.cpp"), "QStringConverter converter;\n").unwrap();

        assert_eq!(
            detect_project_qt_major_within(&root, 1),
            5,
            "预算耗尽后不得再进入子目录"
        );
        assert_eq!(detect_project_qt_major_within(&root, 2), 6);
    }
    #[test]
    fn source_projects_carry_their_own_project_version_in_the_probe() {
        let (_t, root) = tree();
        let qt6_project = mkdir(&root, "qt6-app");
        create_version_fixture(
            &qt6_project,
            "find_package(Qt6 COMPONENTS Widgets REQUIRED)",
            "QStringConverter converter;\n",
        );
        let qt5_project = mkdir(&root, "qt5-app");
        create_version_fixture(
            &qt5_project,
            "find_package(Qt5 COMPONENTS Widgets REQUIRED)",
            "#include <QWidget>\n",
        );

        let probe = card_probe(&root, &root.join("managed"), &HashMap::new());

        for (project, expected) in [(&qt6_project, 6), (&qt5_project, 5)] {
            let key = path_key(project);
            let measured = probe
                .project_versions
                .iter()
                .find(|(path, _)| path_key(Path::new(path)) == key)
                .map(|(_, qt_major)| *qt_major);
            assert_eq!(measured, Some(expected), "project {}", project.display());
        }
    }

    #[test]
    fn toolchain_option_is_the_kit_of_the_default_project_generation() {
        // 需求：迁移必须用原始工程所写的那一代 Qt 编译，所以卡片默认项（首项，被预选）
        // 必须是该代的 kit。
        let (_t, root) = tree();
        let project = mkdir(&root, "qt6-app");
        create_version_fixture(
            &project,
            "find_package(Qt6 COMPONENTS Widgets REQUIRED)",
            "QStringConverter converter;\n",
        );
        // 扫描顺序是「先 tier 后 path」，工作区里的 `Qt5.15.2` 必然排在 `Qt6.7.2`
        // 之前，所以 Qt6 排到首位只可能来自按工程版本挑 kit。
        create_qt5_ohos_kit(&mkdir(&root, "Qt5.15.2"));
        let qt6_bin = create_qt6_ohos_kit(&mkdir(&root, "Qt6.7.2"));
        let model = candidate_map(
            "source_project",
            vec![project.to_string_lossy().into_owned()],
        );

        let probe = card_probe(&root, &root.join("managed"), &model);

        // 宿主上真实安装的 Qt（第三层已知安装根）也会进候选，所以只断言首项：工作区
        // 层的 fixture kit 一定排在已知安装根那一层之前。
        assert_eq!(
            keys(&probe.candidates["toolchain"]).first().cloned(),
            Some(path_key(&qt6_bin)),
            "Qt6 原始工程的首个工具链候选必须是 Qt6 kit"
        );
        assert_eq!(
            probe.toolchain_candidates[0].qt_major,
            Some(6),
            "首选项的版本事实就是卡片渲染的 Qt 版本徽标"
        );
    }
    /// Synthetic usable kit candidate for the recommendation unit tests: these
    /// fixtures are the only way to exercise a kit generation the host does not
    /// have, because the scan always reports the host's real Qt installations too.
    fn kit(path: &str, qt_major: u8) -> QtScanCandidate {
        QtScanCandidate {
            path: path.to_string(),
            qt_major: Some(qt_major),
            ohos_target_kit: true,
            source: QtScanSource::Workspace,
        }
    }

    /// Candidate paths of a `toolchain` option list, for order assertions.
    fn option_paths(candidates: &[QtScanCandidate]) -> Vec<String> {
        candidates
            .iter()
            .map(|candidate| candidate.path.clone())
            .collect()
    }

    #[test]
    fn toolchain_options_serve_each_project_generation() {
        // 默认工程 Qt5、备选工程 Qt6 ⇒ 默认槽 Qt5 kit、备选槽 Qt6 kit。Qt6 kit 在盘上
        // 排得更靠后也不能被"第二个 Qt5 kit"顶掉。
        let qt5_12 = kit("/kits/Qt5.12.12/bin", 5);
        let qt5_15 = kit("/kits/Qt5.15.2/bin", 5);
        let qt6 = kit("/kits/Qt6.7.2/bin", 6);

        let chosen = recommend_toolchains(
            &[qt5_12.clone(), qt5_15, qt6.clone()],
            &[("project-qt5".into(), 5), ("project-qt6".into(), 6)],
        );

        assert_eq!(
            option_paths(&chosen),
            option_paths(&[qt5_12, qt6]),
            "每个位置服务同位置的工程版本"
        );
    }
    #[test]
    fn bound_generations_are_compared_from_disk_facts() {
        let (_t, root) = tree();
        let qt6_project = mkdir(&root, "qt6-app");
        create_version_fixture(
            &qt6_project,
            "find_package(Qt6 COMPONENTS Widgets REQUIRED)",
            "QAnyStringView view;\n",
        );
        let qt5_project = mkdir(&root, "qt5-app");
        create_version_fixture(
            &qt5_project,
            "find_package(Qt5 COMPONENTS Widgets REQUIRED)",
            "#include <QWidget>\n",
        );
        let qt5_bin = create_qt5_ohos_kit(&mkdir(&root, "Qt5.12.12"));
        let qt6_bin = create_qt6_ohos_kit(&mkdir(&root, "Qt6.7.2"));

        // 同代：不提问。
        assert_eq!(
            compare_bound_generations(&qt6_project, &qt6_bin.to_string_lossy(), Some(5)),
            QtMigrationGenerationMismatch::Matching(6)
        );
        assert_eq!(
            compare_bound_generations(&qt5_project, &qt5_bin.to_string_lossy(), Some(5)),
            QtMigrationGenerationMismatch::Matching(5)
        );

        // Qt6 工程 + Qt5 工具链 ⇒ 降级方向；Qt5 工程 + Qt6 工具链 ⇒ 继续方向。
        let newer = compare_bound_generations(&qt6_project, &qt5_bin.to_string_lossy(), Some(5));
        assert_eq!(
            newer,
            QtMigrationGenerationMismatch::ProjectNewer {
                project: 6,
                toolchain: 5
            }
        );
        assert_eq!(newer.measured_generations(), Some((6, 5)));
        let older = compare_bound_generations(&qt5_project, &qt6_bin.to_string_lossy(), Some(5));
        assert_eq!(
            older,
            QtMigrationGenerationMismatch::ProjectOlder {
                project: 5,
                toolchain: 6
            }
        );
        assert_eq!(older.measured_generations(), Some((5, 6)));

        // 官方工具链是固定一代（由调用方传入），代相同则不算不一致。
        assert_eq!(
            compare_bound_generations(&qt5_project, "__official__", Some(5)),
            QtMigrationGenerationMismatch::Matching(5)
        );
        assert!(
            compare_bound_generations(&qt6_project, "__official__", Some(5))
                .strategy_instruction()
                .is_some(),
            "Qt6 工程 + 官方 Qt5 包同样是不一致，必须问"
        );
    }

    #[test]
    fn an_unmeasurable_side_asks_nothing() {
        let (_t, root) = tree();
        let qt6_project = mkdir(&root, "qt6-app");
        create_version_fixture(
            &qt6_project,
            "find_package(Qt6 COMPONENTS Widgets REQUIRED)",
            "QAnyStringView view;\n",
        );
        let not_a_kit = mkdir(&root, "not-a-kit");
        let not_a_project = mkdir(&root, "plain-source");

        // 工具链路径没有 kit 布局 ⇒ 测不出代 ⇒ 不提问。
        assert_eq!(
            compare_bound_generations(&qt6_project, &not_a_kit.to_string_lossy(), Some(5)),
            QtMigrationGenerationMismatch::Unknown
        );
        // 源路径不是 Qt 工程 ⇒ 没有"工程代"可比（避免把路径写错当成 Qt5 工程）。
        assert_eq!(
            compare_bound_generations(&not_a_project, &not_a_kit.to_string_lossy(), Some(5)),
            QtMigrationGenerationMismatch::Unknown
        );

        for mismatch in [
            QtMigrationGenerationMismatch::Unknown,
            QtMigrationGenerationMismatch::Matching(6),
        ] {
            assert!(mismatch.measured_generations().is_none());
            assert!(mismatch.strategy_instruction().is_none());
        }
    }
    #[test]
    fn the_answer_contract_is_read_by_value_not_by_key() {
        use serde_json::json;

        // 通用卡按 field id 或位置下标提交，两种键都必须读到。
        assert_eq!(
            read_version_strategy_answer(&json!({ "0": QT_MIGRATION_STRATEGY_ABORT_VALUE })),
            Some(QtMigrationStrategyAnswer::Abort)
        );
        assert_eq!(
            read_version_strategy_answer(
                &json!({ "qt_migration_version_strategy": QT_MIGRATION_STRATEGY_PROCEED_VALUE })
            ),
            Some(QtMigrationStrategyAnswer::Proceed)
        );
        // 多选/数组形状同样能读（并容忍两端空白）。
        assert_eq!(
            read_version_strategy_answer(
                &json!({ "answers": [" x ", QT_MIGRATION_STRATEGY_ABORT_VALUE] })
            ),
            Some(QtMigrationStrategyAnswer::Abort)
        );
    }
    #[test]
    fn a_recorded_strategy_is_stated_as_a_fact() {
        use serde_json::json;

        // 已决策略必须可达：旧实现靠"是否仍 pending"判断，决策一旦写入就再也讲不出"已确认"，
        // 于是模型只能靠闸门文案反复提问。这里对三个已决状态逐个核事实与代数。
        for (strategy, generations) in [
            (
                QtMigrationVersionStrategy::Downgrade {
                    project: 6,
                    toolchain: 5,
                },
                (6u8, 5u8),
            ),
            (
                QtMigrationVersionStrategy::Continue {
                    project: 5,
                    toolchain: 6,
                },
                (5, 6),
            ),
            (
                QtMigrationVersionStrategy::Abort {
                    project: 6,
                    toolchain: 5,
                },
                (6, 5),
            ),
        ] {
            let snapshot = bound_intake_snapshot("/proj", "/kit", strategy);
            let follow_up = version_strategy_follow_up(
                &snapshot,
                &json!({ "0": QT_MIGRATION_STRATEGY_PROCEED_VALUE }),
            )
            .expect("a recorded strategy is always a fact");
            assert_eq!(follow_up.measured_generations(), Some(generations));
            assert_eq!(
                follow_up,
                QtMigrationStrategyFollowUp::Decided {
                    mismatch: QtMigrationGenerationMismatch::from_generations(
                        generations.0,
                        generations.1
                    ),
                    strategy,
                }
            );
        }
    }

    #[test]
    fn a_readable_answer_that_was_not_recorded_is_reported_instead_of_being_silent() {
        use serde_json::json;

        // 真机 bug 的形状：答案带着契约取值，但会话仍是 pending（运行时没记下来）。
        // 必须给出"未记录"这一事实，而不是返回 None —— 否则模型只会照闸门文案反复提问。
        let pending = |project: u8, toolchain: u8| {
            bound_intake_snapshot(
                "/proj",
                "/kit",
                QtMigrationVersionStrategy::Pending { project, toolchain },
            )
        };

        assert_eq!(
            version_strategy_follow_up(
                &pending(6, 5),
                &json!({ "0": QT_MIGRATION_STRATEGY_PROCEED_VALUE })
            ),
            Some(QtMigrationStrategyFollowUp::NotRecorded {
                mismatch: QtMigrationGenerationMismatch::ProjectNewer {
                    project: 6,
                    toolchain: 5,
                },
            })
        );
        // 没有契约取值的答案仍是"重新提问"，两者必须区分开。
        assert_eq!(
            version_strategy_follow_up(&pending(6, 5), &json!({ "0": "降级到 Qt5 迁移" })),
            Some(QtMigrationStrategyFollowUp::MissingAnswer {
                mismatch: QtMigrationGenerationMismatch::ProjectNewer {
                    project: 6,
                    toolchain: 5,
                },
            })
        );
        // 反方向（工程更旧）同样按实测代数报出来。
        assert_eq!(
            version_strategy_follow_up(
                &pending(5, 6),
                &json!({ "0": QT_MIGRATION_STRATEGY_ABORT_VALUE })
            ),
            Some(QtMigrationStrategyFollowUp::NotRecorded {
                mismatch: QtMigrationGenerationMismatch::ProjectOlder {
                    project: 5,
                    toolchain: 6,
                },
            })
        );
    }
    #[test]
    fn the_strategy_instruction_keeps_the_two_directions_apart() {
        // 真机缺口：两种方向共用一句"同意继续迁移"，用户可能在不知道这是降级的情况下同意。
        let downgrade = QtMigrationGenerationMismatch::ProjectNewer {
            project: 6,
            toolchain: 5,
        }
        .strategy_instruction()
        .expect("must instruct");
        let continue_migration = QtMigrationGenerationMismatch::ProjectOlder {
            project: 5,
            toolchain: 6,
        }
        .strategy_instruction()
        .expect("must instruct");

        // 降级方向：必须点明降级与代价，并给"先换工具链再来"的拒绝语义。
        assert!(downgrade.contains("降级"));
        assert!(downgrade.contains("Qt6-only"));
        assert!(downgrade.contains("先换成 Qt6 工具链"));
        assert!(!downgrade.contains("在版本不一致下继续"));

        // 继续方向：必须点明"版本不一致但继续"与 API 差异，且不得说成降级。
        assert!(continue_migration.contains("在版本不一致下继续"));
        assert!(continue_migration.contains("API 差异"));
        assert!(continue_migration.contains("放弃本次迁移"));
        assert!(!continue_migration.contains("降级"));

        // 取值契约两种方向完全一致：方向只约束语义，不改运行时读的值。
        for instruction in [&downgrade, &continue_migration] {
            assert!(instruction.contains(QT_MIGRATION_STRATEGY_PROCEED_VALUE));
            assert!(instruction.contains(QT_MIGRATION_STRATEGY_ABORT_VALUE));
            assert!(instruction.contains("唯一依据"));
        }
    }
    /// A bound intake snapshot for the version-gate tests.
    fn bound_intake_snapshot(
        source_project: &str,
        toolchain: &str,
        strategy: QtMigrationVersionStrategy,
    ) -> QtMigrationIntakeStateSnapshot {
        let mut snapshot = QtMigrationIntakeStateSnapshot::empty();
        for (field, value) in [
            ("source_project", source_project),
            ("output_project", "/out/hm"),
            ("toolchain", toolchain),
            ("template", "/tpl"),
        ] {
            snapshot.fields.insert(
                field.to_string(),
                bitfun_agent_runtime::qt_migration_intake_state::QtMigrationIntakeFieldState {
                    state: bitfun_agent_runtime::qt_migration_intake_state::QtMigrationFieldResolutionState::Resolved,
                    value: Some(value.to_string()),
                },
            );
        }
        snapshot.version_strategy = strategy;
        snapshot
    }
    #[test]
    fn a_generation_with_no_kit_is_left_unserved_without_substitution() {
        // 反向：盘上只有 Qt6 kit 时，Qt5 工程那一位留空，不得拿 Qt6 kit 冒充。默认位与
        // 工程默认位可以不一一对应，但列出来的选项必须至少有一个工程用得上。
        let qt6 = kit("/kits/Qt6.7.2/bin", 6);

        let chosen = recommend_toolchains(
            &[qt6.clone()],
            &[("project-qt6".into(), 6), ("project-qt5".into(), 5)],
        );

        assert_eq!(option_paths(&chosen), option_paths(&[qt6]));
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
    fn take_session_probe_dirs_normalizes_probe_hits_to_directories() {
        let (_t, root) = tree();
        let bin = mkdir(&root, "sdk/bin");
        touch(&bin, "qmake");

        // 探测命令的原始形态是可执行文件路径 → 归一化为父目录；其余字段不受影响。
        let mut candidates = candidate_map(
            SESSION_TOOLCHAIN_CANDIDATES_KEY,
            vec![bin.join("qmake").to_string_lossy().into_owned()],
        );
        candidates.insert(
            "toolchain".to_string(),
            vec!["D:/from-prompt/bin".to_string()],
        );
        assert_eq!(
            take_session_probe_dirs(&mut candidates),
            vec![bin.to_string_lossy().into_owned()]
        );
        // 专用键取出后消失，输入命中的 toolchain 字段不受影响。
        assert!(!candidates.contains_key(SESSION_TOOLCHAIN_CANDIDATES_KEY));
        assert!(candidates.contains_key("toolchain"));
        assert!(take_session_probe_dirs(&mut candidates).is_empty());

        // 模型直接回传目录（按指令形态）→ 原样保留。
        let mut dir_form = candidate_map(
            SESSION_TOOLCHAIN_CANDIDATES_KEY,
            vec![bin.to_string_lossy().into_owned()],
        );
        assert_eq!(
            take_session_probe_dirs(&mut dir_form),
            vec![bin.to_string_lossy().into_owned()]
        );

        // 伪造路径（既非文件也非目录）→ 拒绝。
        let mut bogus = candidate_map(
            SESSION_TOOLCHAIN_CANDIDATES_KEY,
            vec![root.join("nope").to_string_lossy().into_owned()],
        );
        assert!(take_session_probe_dirs(&mut bogus).is_empty());

        // 空串 → 拒绝。
        let mut empty = candidate_map(SESSION_TOOLCHAIN_CANDIDATES_KEY, vec![String::new()]);
        assert!(take_session_probe_dirs(&mut empty).is_empty());

        // 存在但不含任何探测可执行文件的目录 → 拒绝（不伪造候选）。
        let bare = mkdir(&root, "not-a-toolchain");
        let mut bare_map = candidate_map(
            SESSION_TOOLCHAIN_CANDIDATES_KEY,
            vec![bare.to_string_lossy().into_owned()],
        );
        assert!(take_session_probe_dirs(&mut bare_map).is_empty());
    }
    #[test]
    fn session_probe_ranks_below_the_workspace_tier() {
        // 优先级：输入 > 工作区 > 托管 > 已知安装根 > 会话探测。
        let (_t, root) = tree();
        let ws_kit = mkdir(&root, "Qt5.15.2");
        let ws_bin = create_qt5_ohos_kit(&ws_kit);
        let session_tmp = tempfile::tempdir().expect("session tempdir");
        let session_kit = mkdir(session_tmp.path(), "env-kit");
        let session_bin = create_qt6_ohos_kit(&session_kit);
        let managed_root = root.join("managed");

        let scan = scan_qt_migration_candidates(
            &root,
            &managed_root,
            &HashMap::new(),
            &[session_bin.to_string_lossy().into_owned()],
            &[],
        );

        let ws = candidate_for(&scan.toolchains, &ws_bin).expect("工作区命中必须在结果里");
        let session =
            candidate_for(&scan.toolchains, &session_bin).expect("会话探测命中必须在结果里");
        assert_eq!(ws.source, QtScanSource::Workspace);
        assert_eq!(session.source, QtScanSource::SessionProbe);
    }
    #[test]
    fn toolchain_prefers_workspace_then_managed_then_known_install_root() {
        let (_t, root) = tree();
        let ws_kit = mkdir(&root, "Qt5.15.2");
        let ws_bin = create_qt5_ohos_kit(&ws_kit);

        let managed_tmp = tempfile::tempdir().expect("tempdir");
        let managed_root = managed_tmp.path().join("managed");
        let managed_bin = create_qt5_ohos_kit(&managed_root.join("toolchains/qt5.12.12"));

        let known_tmp = tempfile::tempdir().expect("known install root");
        let known_kit = mkdir(known_tmp.path(), "known-kit");
        let known_bin = create_qt6_ohos_kit(&known_kit);

        let scan = scan_qt_migration_candidates(
            &root,
            &managed_root,
            &HashMap::new(),
            &[],
            &[known_tmp.path().to_path_buf()],
        );

        // 只保留 fixture 自己的三级根，排除宿主上真实 Qt 的第三级命中。
        let tiers = tiers_under_roots(&scan, &[&root, managed_tmp.path(), known_tmp.path()]);
        assert_eq!(
            tiers,
            vec![
                (QtScanSource::Workspace, path_key(&ws_bin)),
                (QtScanSource::Managed, path_key(&managed_bin)),
                (QtScanSource::KnownInstallRoot, path_key(&known_bin)),
            ],
            "工作区 > 托管 > 已知安装根（宿主上真实 Qt 的命中已被过滤）"
        );
        assert!(
            scan.toolchains
                .iter()
                .any(|candidate| candidate.source == QtScanSource::KnownInstallRoot),
            "第三级必须产生候选，否则这一级没生效"
        );
    }
    #[test]
    fn managed_toolchain_availability_is_version_aware_for_both_generations() {
        // decision B：托管可用性版本化——Qt5 kit 与 Qt6 kit 都算"可用"，
        // 判据与扫描一致（detect_qt_major + is_ohos_target_kit）。
        for (declared_kit_dir, build_kit, expected_major) in [
            ("qt5.12.12", create_qt5_ohos_kit as fn(&Path) -> PathBuf, 5),
            ("qt6.13.0", create_qt6_ohos_kit as fn(&Path) -> PathBuf, 6),
        ] {
            let (_t, root) = tree();
            let managed_tmp = tempfile::tempdir().expect("tempdir");
            let managed_root = managed_tmp.path().join("managed");
            let bin = build_kit(&managed_root.join("toolchains").join(declared_kit_dir));

            let probe = card_probe(&root, &managed_root, &HashMap::new());

            assert!(
                probe.managed_toolchain_available,
                "布局表声明的 {declared_kit_dir} 必须算作托管可用（C3）"
            );
            let candidates = under_roots(&probe.candidates["toolchain"], &[managed_tmp.path()]);
            assert_eq!(candidates, keys(&[bin.to_string_lossy().into_owned()]));
            let managed = candidate_for(&probe.toolchain_candidates, &bin)
                .expect("托管 kit 必须出现在卡片候选项里");
            assert_eq!(
                managed.qt_major,
                Some(expected_major),
                "可用性必须按实测版本判定，不按 Qt5 形状"
            );
        }
    }
    #[test]
    fn template_predicate_requires_the_three_files_with_or_without_the_marker() {
        // 三文件是共同特征（Qt5/Qt6 都有）：缺任一文件即不是模板；
        // 只要三文件齐全，marker 有无都算模板。
        let (_t, root) = tree();
        let qt5_shaped = mkdir(&root, "qt5-shaped");
        create_template(&qt5_shaped);
        let qt6_shaped = mkdir(&root, "qt6-shaped");
        create_qt6_template(&qt6_shaped);
        let marker_only = mkdir(&root, "marker-only");
        mkdir(&marker_only, TEMPLATE_MARKER_DIR);
        create_qt6_template(&marker_only);
        std::fs::remove_file(marker_only.join(TEMPLATE_QT_DECLARATIONS)).unwrap();
        let plain = mkdir(&root, "plain_hm");
        mkdir(&plain, "entry");
        touch(&plain, "build-profile.json5");

        assert!(is_qt_harmonyos_template(&qt5_shaped));
        assert!(is_qt_harmonyos_template(&qt6_shaped));
        assert!(
            !is_qt_harmonyos_template(&marker_only),
            "marker 加两个文件不足以成立：三文件要求必须保留"
        );
        assert!(!is_qt_harmonyos_template(&plain));
    }
    #[test]
    fn qt6_target_kit_is_detected_as_qt6_not_qt5() {
        // 实测依据：真实 Qt 6.12.0 target kit 的 bin/ 同时含
        // qmake、qmake6、qt-cmake，所以"qmake 存在即 Qt5"必然误判；
        // 版本判据只看 lib/cmake/Qt6 目录。
        let (_t, root) = tree();
        let kit = mkdir(&root, "6.12.0/harmonyos_arm64_v8a");
        let bin = create_qt6_ohos_kit(&kit);

        let scan = scan_tree(&root, &root.join("managed"), &HashMap::new());

        let candidate = candidate_for(&scan.toolchains, &bin).expect("Qt6 kit 的 bin 必须成为候选");
        assert_eq!(candidate.qt_major, Some(6));
        assert_ne!(candidate.qt_major, Some(5), "bin/qmake 存在不得推出 Qt5");
        assert!(candidate.ohos_target_kit, "target kit 必须被识别为 OHOS");
        assert_eq!(candidate.source, QtScanSource::Workspace);
    }
    #[test]
    fn qt6_host_kit_is_not_reported_as_an_ohos_toolchain() {
        // 实测依据：host kit（mingw_64）只有 qwindows.dll，没有
        // libqohos.so，所以它不是 OHOS 工具链；而它的 lib/cmake/Qt6 让版本仍是
        // Some(6)——单看版本无法与 target kit 区分，这正是 ohos_target_kit
        // 字段存在的原因。
        let (_t, root) = tree();
        let kit = mkdir(&root, "6.12.0/mingw_64");
        let bin = create_qt6_host_kit(&kit);

        let scan = scan_tree(&root, &root.join("managed"), &HashMap::new());

        // 只对 fixture 内的候选断言：第三级会合法地命中宿主上真实安装的
        // HarmonyOS target kit（它们当然是 ohos_target_kit）。
        let fixture: Vec<&QtScanCandidate> = scan
            .toolchains
            .iter()
            .filter(|candidate| path_key(Path::new(&candidate.path)).starts_with(&path_key(&root)))
            .collect();
        assert!(!fixture.is_empty(), "fixture 里的 host kit 必须被扫描到");
        assert!(
            fixture.iter().all(|candidate| !candidate.ohos_target_kit),
            "host kit 不得被报成 OHOS 工具链"
        );
        assert!(
            fixture
                .iter()
                .all(|candidate| candidate.qt_major != Some(5)),
            "host kit 不得被猜成 Qt5"
        );
        let candidate = candidate_for(&scan.toolchains, &bin)
            .expect("host kit 的 bin 由 ohos_target_kit 区分，而非被版本判据吸收");
        assert_eq!(candidate.qt_major, Some(6));
        assert!(!candidate.ohos_target_kit);
    }
    #[test]
    fn shared_scan_finds_deep_kits_the_old_bounded_card_scan_missed() {
        // 深度回归：真实安装根带版本层，
        // SDK 会落在旧的卡片深度上限之外。D14 之后卡片与工具共用同一次扫描，
        // 所以两边都必须看到它——这正是"卡片有界/工具无界"分叉作废的证明。
        let (_t, root) = tree();
        let kit = mkdir(&root, "one/two/three/four/five/sdk");
        let bin = create_qt6_ohos_kit(&kit);
        let managed_root = root.join("managed");

        let scan = scan_tree(&root, &managed_root, &HashMap::new());
        let candidate = candidate_for(&scan.toolchains, &bin).expect("无深限扫描必须找到它");
        assert_eq!(candidate.qt_major, Some(6));
        assert!(candidate.ohos_target_kit);

        let probe = card_probe(&root, &managed_root, &HashMap::new());
        assert_eq!(
            under_roots(&probe.candidates["toolchain"], &[&root]),
            keys(&[bin.to_string_lossy().into_owned()]),
            "卡片消费同一次扫描，不再因深度上限漏掉它"
        );
        assert_eq!(
            candidate_for(&probe.toolchain_candidates, &bin)
                .expect("深层的 kit 必须是卡片候选项")
                .qt_major,
            Some(6)
        );
    }
    #[test]
    fn layout_table_declared_kit_roots_are_hit_by_the_scan() {
        // 契约 C3：布局表声明的路径必须被扫描器命中（取代过去的"深度巧合"）。
        let (_t, root) = tree();
        let managed_tmp = tempfile::tempdir().expect("tempdir");
        let managed_root = managed_tmp.path().join("managed");
        let toolchains_root = managed_root.join("toolchains");
        for kit in qt_managed_kit_roots(&toolchains_root) {
            match kit.qt_major {
                5 => {
                    create_qt5_ohos_kit(&kit.kit_root);
                }
                6 => {
                    create_qt6_ohos_kit(&kit.kit_root);
                }
                other => panic!("unexpected declared generation: {other}"),
            }
        }

        let scan = scan_tree(&root, &managed_root, &HashMap::new());

        for kit in qt_managed_kit_roots(&toolchains_root) {
            let bin = kit.kit_root.join("bin");
            let candidate = candidate_for(&scan.toolchains, &bin)
                .unwrap_or_else(|| panic!("布局表声明的 {} 必须被扫描命中", bin.display()));
            assert_eq!(candidate.source, QtScanSource::Managed);
            assert_eq!(
                candidate.qt_major,
                Some(kit.qt_major),
                "版本必须取自磁盘实测，且与布局表一致"
            );
            assert!(candidate.ohos_target_kit);
            assert!(candidate.is_usable_toolchain());
        }
    }

    #[test]
    fn usable_toolchain_requires_a_target_kit_with_an_identified_version() {
        let (_t, root) = tree();
        let target_kit = mkdir(&root, "target-kit");
        let target_bin = create_qt6_ohos_kit(&target_kit);
        let host_kit = mkdir(&root, "host-kit");
        let host_bin = create_qt6_host_kit(&host_kit);
        let unidentified = mkdir(&root, "unidentified");
        let unidentified_bin = mkdir(&unidentified, "bin");
        touch(&unidentified_bin, "qmake");

        let scan = scan_tree(&root, &root.join("managed"), &HashMap::new());

        let usable = |path: &Path| {
            candidate_for(&scan.toolchains, path)
                .unwrap_or_else(|| panic!("{} must be scanned", path.display()))
                .is_usable_toolchain()
        };
        assert!(usable(&target_bin), "target kit 是可用工具链");
        assert!(!usable(&host_bin), "host kit 不可用：不是 OHOS target kit");
        assert!(!usable(&unidentified_bin), "无版本依据的目录不可用");

        // 卡片只列可用工具链：不可用的命中不进候选项。
        let probe = card_probe(&root, &root.join("managed"), &HashMap::new());
        assert_eq!(
            under_roots(&probe.candidates["toolchain"], &[&root]),
            keys(&[target_bin.to_string_lossy().into_owned()])
        );
    }
}
