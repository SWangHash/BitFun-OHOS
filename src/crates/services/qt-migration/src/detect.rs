//! Qt kit and project detection: measure which Qt generation a kit or a
//! source project uses, and recognize Qt CMake projects on disk.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

use crate::output::{is_inside_migrated_harmony_project, is_migration_artifact};
use crate::scan::{
    dedup_paths, is_migration_artifact_location, is_noise_dir, normalize_workspace_candidate,
    path_key, scan_qmake_hits, ScanGuard, MAX_PROBE_DEPTH, MAX_SOURCE_PROJECTS,
};

/// Qt6 CMake package directory, relative to a kit root. Its presence is the
/// deciding version signal
/// .
pub(crate) const QT6_CMAKE_PACKAGE_DIR: &str = "lib/cmake/Qt6";
/// Qt5 CMake package directory, relative to a kit root. The Qt5 equivalent of
/// [`QT6_CMAKE_PACKAGE_DIR`]; the measured Qt6 package ships no `lib/cmake/Qt5`,
/// so the two signals cannot both match.
pub(crate) const QT5_CMAKE_PACKAGE_DIR: &str = "lib/cmake/Qt5";
/// OHOS platform plugin, relative to a kit root: shipped by a HarmonyOS target
/// kit, absent from a desktop host kit
/// .
pub(crate) const QT_OHOS_PLATFORM_PLUGIN: &str = "plugins/platforms/libqohos.so";

/// Upper bound on one `qmake -query` run: a kit tool that hangs proves nothing
/// and must not stall a scan.
const KIT_VERSION_PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const KIT_VERSION_PROBE_POLL: Duration = Duration::from_millis(10);

static KIT_VERSION_CACHE: OnceLock<Mutex<HashMap<PathBuf, (Option<SystemTime>, Option<u8>)>>> =
    OnceLock::new();
/// Qt6-only **type names** that decide a Qt *project*'s version.
pub const QT6_ONLY_TYPE_NAMES: &[&str] = &[
    "QInputDevice",
    "QPointingDevice",
    "QEventPoint",
    "QStringConverter",
    "QAnyStringView",
];

/// Source extensions read for a project's version evidence. Build declarations
/// only count when they request Qt6 alone ([`cmake_declares_qt6_only`]); a real
/// project such as `notepad--` declares only `QT += core gui widgets …`, which
/// carries no version at all.
pub(crate) const PROJECT_VERSION_SOURCE_EXTENSIONS: &[&str] =
    &["cc", "cpp", "cxx", "h", "hpp", "hxx"];

/// Upper bound on the source files examined for version evidence in one project.
pub(crate) const MAX_PROJECT_VERSION_FILES: usize = 12000;

/// Upper bound on the `include(...)` files read while deciding whether a
/// `CMakeLists.txt` is a Qt project. Measured worst case: 24 file-like includes in
/// one real project's `CMakeLists.txt`. The cap only exists so that a generated or
/// hostile file cannot turn the predicate into an unbounded read.
pub(crate) const MAX_CMAKE_INCLUDES: usize = 64;

/// Lowercased CMake marker that declares Qt: `find_package(Qt5 …)`,
/// `find_package(Qt6 …)` and `find_package(Qt …)` all contain it.
pub(crate) const QT_FIND_PACKAGE_MARKER: &str = "find_package(qt";

/// Upper bound on the size of one source file read for version evidence. A larger
/// file is **skipped**, not truncated: a partial read still could not prove a type
/// name absent from the rest of the file, and a source file this large is a
/// generated or vendored artifact rather than hand-written project code.
pub(crate) const MAX_PROJECT_VERSION_FILE_BYTES: u64 = 512 * 1024;

// ---------------------------------------------------------------------------
// Qt kit detection

/// Whether a kit root is an **OHOS target kit** rather than a desktop host kit:
pub fn is_ohos_target_kit(kit_root: &Path) -> bool {
    kit_root.join(QT_OHOS_PLATFORM_PLUGIN).is_file()
}

/// Detected Qt major version of a kit root, or `None` when the on-disk layout
/// does not identify one.
pub fn detect_qt_major(kit_root: &Path) -> Option<u8> {
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
pub(crate) fn resolve_kit_root(hit_dir: &Path) -> &Path {
    let parent = hit_dir.parent().unwrap_or(hit_dir);
    if detect_qt_major(parent).is_some() || is_ohos_target_kit(parent) {
        parent
    } else {
        hit_dir
    }
}

/// Kit root a directory belongs to, when its location identifies one: the
/// directory itself or one of its ancestors is a kit root.
pub(crate) fn resolve_kit_root_above(dir: &Path) -> Option<&Path> {
    dir.ancestors()
        .find(|ancestor| detect_qt_major(ancestor).is_some() || is_ohos_target_kit(ancestor))
}

pub(crate) fn resolve_bound_kit_root(value: &Path) -> Option<PathBuf> {
    let direct = resolve_kit_root(value);
    if detect_qt_major(direct).is_some() {
        return Some(direct.to_path_buf());
    }
    if let Some(kit) = value
        .ancestors()
        .find(|ancestor| detect_qt_major(ancestor).is_some())
    {
        return Some(kit.to_path_buf());
    }
    let mut kits: Vec<PathBuf> = scan_qmake_hits(value)
        .into_iter()
        .map(|bin_dir| resolve_kit_root(&bin_dir).to_path_buf())
        .filter(|kit| kit_qt_major(kit).is_some())
        .collect();
    kits.sort();
    kits.dedup();
    if kits.len() <= 1 {
        return kits.pop();
    }
    let mut majors = majors_of(&kits);
    if majors.len() == 1 {
        return kits.into_iter().next();
    }
    // An installer root holding several generations names no single toolchain.
    // Only a generation that runs here is the answer; two runnable generations
    // stay ambiguous.
    let mut runnable: Vec<PathBuf> = kits
        .iter()
        .filter(|kit| kit_tools_run_on_host(kit) == Some(true))
        .cloned()
        .collect();
    runnable.sort();
    runnable.dedup();
    majors = majors_of(&runnable);
    if majors.len() == 1 {
        return runnable.into_iter().next();
    }
    None
}

fn majors_of(kits: &[PathBuf]) -> Vec<u8> {
    let mut majors: Vec<u8> = kits.iter().filter_map(|kit| kit_qt_major(kit)).collect();
    majors.sort_unstable();
    majors.dedup();
    majors
}

/// Qt major version a kit reports: its CMake package layout when that identifies
/// one, else the answer its own `qmake` gives. The fallback executes the kit's
/// tool, so it is cached per kit until the tool is replaced.
pub(crate) fn kit_qt_major(kit_root: &Path) -> Option<u8> {
    if let Some(major) = detect_qt_major(kit_root) {
        return Some(major);
    }
    let qmake = find_kit_qmake(kit_root)?;
    probe_kit_qt_major(kit_root, &qmake)
}

fn find_kit_qmake(kit_root: &Path) -> Option<PathBuf> {
    let bin_dir = kit_root.join("bin");
    crate::scan::QMAKE_PROBE_EXECUTABLES
        .iter()
        .map(|name| bin_dir.join(name))
        .find(|path| path.is_file())
}

fn probe_kit_qt_major(kit_root: &Path, qmake: &Path) -> Option<u8> {
    let stamp = std::fs::metadata(qmake)
        .and_then(|metadata| metadata.modified())
        .ok();
    let cache = KIT_VERSION_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some((cached_stamp, major)) = cache
        .lock()
        .ok()
        .and_then(|cache| cache.get(kit_root).cloned())
    {
        if cached_stamp == stamp {
            return major;
        }
    }
    let major = run_qmake_qt_major(qmake);
    if let Ok(mut cache) = cache.lock() {
        cache.insert(kit_root.to_path_buf(), (stamp, major));
    }
    major
}

fn run_qmake_qt_major(qmake: &Path) -> Option<u8> {
    let mut command = bitfun_services_core::process_manager::create_command(qmake);
    command
        .arg("-query")
        .arg("QT_VERSION")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command.spawn().ok()?;
    let deadline = Instant::now() + KIT_VERSION_PROBE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => {
                // Reading on this thread could wait on a pipe that a background
                // process of a launcher script still holds open, which is the
                // one wait the deadline above does not cover.
                let stdout = child.stdout.take()?;
                let (sender, receiver) = std::sync::mpsc::channel();
                std::thread::spawn(move || {
                    let mut stdout = stdout;
                    let mut output = String::new();
                    let _ = std::io::Read::read_to_string(&mut stdout, &mut output);
                    let _ = sender.send(output);
                });
                let remaining = deadline.saturating_duration_since(Instant::now());
                let output = receiver.recv_timeout(remaining).ok()?;
                return qt_major_from_version(&output);
            }
            Ok(Some(_)) => return None,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(KIT_VERSION_PROBE_POLL);
            }
            Err(_) => return None,
        }
    }
}

fn qt_major_from_version(version: &str) -> Option<u8> {
    match version.trim().as_bytes().first()? {
        b'5' => Some(5),
        b'6' => Some(6),
        _ => None,
    }
}

pub(crate) fn kit_tools_run_on_host(kit_root: &Path) -> Option<bool> {
    let bin_dir = kit_root.join("bin");
    for name in crate::scan::QMAKE_PROBE_EXECUTABLES {
        let path = bin_dir.join(name);
        if !path.is_file() {
            continue;
        }
        if let Some(format) = executable_format(&path) {
            return Some(format == host_binary_format());
        }
    }
    None
}

fn executable_format(path: &Path) -> Option<BinaryFormat> {
    let mut magic = [0u8; 4];
    let mut file = std::fs::File::open(path).ok()?;
    std::io::Read::read_exact(&mut file, &mut magic).ok()?;
    binary_format(magic)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BinaryFormat {
    MachO,
    Pe,
    Elf,
}

fn binary_format(magic: [u8; 4]) -> Option<BinaryFormat> {
    match magic {
        [0x7f, b'E', b'L', b'F'] => Some(BinaryFormat::Elf),
        [b'M', b'Z', _, _] => Some(BinaryFormat::Pe),
        [0xfe, 0xed, 0xfa, 0xce]
        | [0xfe, 0xed, 0xfa, 0xcf]
        | [0xce, 0xfa, 0xed, 0xfe]
        | [0xcf, 0xfa, 0xed, 0xfe]
        | [0xca, 0xfe, 0xba, 0xbe]
        | [0xbe, 0xba, 0xfe, 0xca] => Some(BinaryFormat::MachO),
        _ => None,
    }
}

fn host_binary_format() -> BinaryFormat {
    if cfg!(target_env = "ohos") {
        BinaryFormat::Elf
    } else if cfg!(target_os = "macos") {
        BinaryFormat::MachO
    } else if cfg!(windows) {
        BinaryFormat::Pe
    } else {
        BinaryFormat::Elf
    }
}

/// Whether `dir` belongs to a Qt installation rather than to a user project: it
/// sits under a kit root, or it is one of the installer's version-named example
/// collections (`<install-root>/Examples/Qt-6.12.0/`). The version-shaped name is
/// what separates that collection from a user's own `Examples/<app>` folder.
///
/// Both carry project shapes — the example collection ships an `examples.pro`
/// subdirectory manifest and CMake build declarations — so shape alone cannot
/// tell them apart from the application the user means.
pub(crate) fn is_inside_qt_installation(dir: &Path) -> bool {
    if resolve_kit_root_above(dir).is_some() {
        return true;
    }
    let version_named = dir
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.get(..3))
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("qt-"));
    version_named
        && dir
            .parent()
            .and_then(|parent| parent.file_name())
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("examples"))
}

/// Detected Qt major version of a **Qt source project**, from a Qt6-only CMake
/// declaration or its C++ code.
pub fn detect_project_qt_major(project_dir: &Path) -> u8 {
    detect_project_qt_major_within(project_dir, MAX_PROJECT_VERSION_FILES)
}

/// [`detect_project_qt_major`] with an explicit file budget, so the budget itself
/// is testable without building a fixture of thousands of files.
pub fn detect_project_qt_major_within(project_dir: &Path, file_budget: usize) -> u8 {
    if cmake_declares_qt6_only(project_dir) {
        return 6;
    }
    let mut guard = ScanGuard::new(file_budget);
    let mut examined = 0usize;
    if project_uses_qt6_only_type(project_dir, &mut guard, &mut examined) {
        6
    } else {
        5
    }
}

/// Whether the root `CMakeLists.txt` (or a module it includes) requests Qt6 and
/// never mentions Qt5. Dual-generation and Qt5 declarations are left to the code.
pub(crate) fn cmake_declares_qt6_only(dir: &Path) -> bool {
    let Some(root) = read_cmake_file(&dir.join("CMakeLists.txt")) else {
        return false;
    };
    let mut texts = vec![root];
    for include in cmake_include_targets(&texts[0]) {
        if let Some(text) = read_cmake_file(&dir.join(include)) {
            texts.push(text);
        }
    }
    let mut declares_qt6 = false;
    for text in &texts {
        for arguments in cmake_find_package_arguments(text) {
            if arguments.iter().any(|argument| argument == "qt5") {
                return false;
            }
            if arguments.first().map(String::as_str) == Some("qt6") {
                declares_qt6 = true;
            }
        }
    }
    declares_qt6
}

fn read_cmake_file(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if metadata.len() > MAX_PROJECT_VERSION_FILE_BYTES {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// Lowercased arguments of every `find_package(...)` call, ignoring `#` comments.
pub(crate) fn cmake_find_package_arguments(contents: &str) -> Vec<Vec<String>> {
    let code = contents
        .lines()
        .map(|line| line.split_once('#').map_or(line, |(code, _)| code))
        .collect::<Vec<_>>()
        .join("\n")
        .to_ascii_lowercase();
    let mut calls = Vec::new();
    let mut rest = code.as_str();
    while let Some(start) = rest.find("find_package") {
        let after = &rest[start + "find_package".len()..];
        let preceded_by_identifier = code[..code.len() - rest.len() + start]
            .chars()
            .next_back()
            .map(|previous| previous.is_alphanumeric() || previous == '_')
            .unwrap_or(false);
        rest = after;
        if preceded_by_identifier {
            continue;
        }
        let Some(open) = after.trim_start().strip_prefix('(') else {
            continue;
        };
        let Some(end) = open.find(')') else {
            break;
        };
        calls.push(
            open[..end]
                .split_whitespace()
                .map(|argument| argument.trim_matches('"').to_string())
                .collect(),
        );
    }
    calls
}

/// Whether any source file under `dir` uses a Qt6-only type, stopping at the first
/// hit — the criterion is existence, so a hit needs no further traversal.
pub(crate) fn project_uses_qt6_only_type(
    dir: &Path,
    guard: &mut ScanGuard,
    examined: &mut usize,
) -> bool {
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
pub(crate) fn is_project_version_source_file(name: &str) -> bool {
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
pub(crate) fn file_uses_qt6_only_type(path: &Path) -> bool {
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
pub(crate) fn contains_qt6_only_type_name(haystack: &str, name: &str) -> bool {
    haystack.match_indices(name).any(|(index, _)| {
        !haystack[..index]
            .chars()
            .next_back()
            .map(|previous| previous.is_alphanumeric() || previous == '_')
            .unwrap_or(false)
    })
}

/// The `source_project` candidates of a request: the paths the model read out of
/// the workspace, mechanically validated and ranked. The backend does not scan
/// the workspace for Qt projects.
///
/// Which directory is the user's project is a judgement about intent, and the
/// disk cannot carry it: a Qt installation root, the example containers shipped
/// inside it (`Examples/<version>/` with its `examples.pro` subdirectory
/// manifest), a build tree, and a real project all look alike to a file-level
/// predicate. Naming the project is the model's job — it reads the workspace and
/// sends what it found as `candidates.source_project`. A named path outside the
/// workspace is accepted as sent (a project may live anywhere); nothing is
/// harvested from its surroundings.
///
/// The one judgement the disk *does* carry is installation membership: a path
/// under a kit root, or the installer's version-named `Examples/Qt-*` collection,
/// is the Qt installation's own tree, never the user's application, so it is
/// dropped rather than offered as a candidate the user has to recognize and
/// reject.
pub(crate) fn probe_source_projects(workspace: &Path, model_candidates: &[String]) -> Vec<String> {
    let mut found: Vec<(usize, PathBuf)> = Vec::new();
    let mut unconfirmed: Vec<PathBuf> = Vec::new();
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
        // A named path only has to be a Qt project, not a migration artifact, and
        // not part of a Qt installation.
        if is_inside_migrated_harmony_project(&path) || is_inside_qt_installation(&path) {
            continue;
        }
        if !is_qt_source_project(&path) {
            if !path.exists() {
                unconfirmed.push(path);
            }
            continue;
        }
        let depth = path
            .strip_prefix(workspace)
            .map(|relative| relative.components().count())
            .unwrap_or(MAX_PROBE_DEPTH + 1);
        found.push((depth, path));
    }
    // The model's candidate is preferred as the default. The ranking keeps a
    // migration artifact last (a project merely named `<app>-ohos` is still
    // offered, just not as the default) and a workspace-resolved project ahead of
    // one that lives outside.
    found.sort_by(|a, b| {
        (is_migration_artifact(&a.1) as u8)
            .cmp(&(is_migration_artifact(&b.1) as u8))
            .then_with(|| a.0.cmp(&b.0))
            .then_with(|| path_key(&a.1).cmp(&path_key(&b.1)))
    });
    let mut roots: Vec<PathBuf> = Vec::new();
    for (_, path) in found {
        if roots
            .iter()
            .any(|root| is_inside_dir(&path, root) || is_inside_dir(root, &path))
        {
            continue;
        }
        roots.push(path);
    }
    let mut candidates = roots
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    candidates.extend(
        unconfirmed
            .into_iter()
            .map(|path| path.to_string_lossy().into_owned()),
    );
    dedup_paths(&mut candidates);
    candidates.truncate(MAX_SOURCE_PROJECTS);
    candidates
}

fn is_inside_dir(path: &Path, dir: &Path) -> bool {
    let path = path_key(path);
    let dir = path_key(dir);
    path == dir || path.starts_with(&format!("{dir}/"))
}

/// CMake-based Qt project marker: a CMakeLists.txt that resolves Qt via
/// `find_package(Qt…)`, directly or through a module it includes. One of the two
/// build systems the ohos-qt-skills pre-flight (阶段零) recognizes — qmake `.pro`
/// is the other. Detection criteria deliberately mirror the skill's analyzer
/// workflow so the backend probe and the model-driven migration flow agree on what
/// a Qt project is.
pub(crate) fn is_qt_cmake_project(dir: &Path) -> bool {
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
pub(crate) fn cmake_include_targets(contents: &str) -> Vec<String> {
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
pub(crate) fn included_cmake_module_declares_qt(cmake_dir: &Path, include: &str) -> bool {
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

pub(crate) fn is_qt_source_project(dir: &Path) -> bool {
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

