//! The scanner's unit tests. They exercise private helpers, so they stay
//! in-tree as a `#[cfg(test)]` unit.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::detect::*;
use crate::layout::qt_managed_kit_roots;
use crate::output::*;
use crate::scan::*;
use crate::state::*;
use crate::strategy::*;

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
fn tiers_under_roots(scan: &QtMigrationScanResult, roots: &[&Path]) -> Vec<(QtScanSource, String)> {
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
            "find_package(Qt5 COMPONENTS Gui REQUIRED)",
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
        "find_package(Qt5 COMPONENTS Gui REQUIRED)",
        "QEventPointPrivate point;\n",
    );
    assert_eq!(detect_project_qt_major(&qt6_root), 6);
}

#[test]
fn project_qt_major_trusts_only_a_qt6_only_cmake_declaration() {
    let (_t, root) = tree();
    create_version_fixture(
        &root,
        "find_package(Qt6\n    REQUIRED\n        COMPONENTS\n            Core\n            Widgets\n)\nqt_standard_project_setup()",
        "#include <QApplication>\nint main() { return 0; }\n",
    );
    assert_eq!(detect_project_qt_major(&root), 6);

    let (_t2, included_root) = tree();
    create_version_fixture(
        &included_root,
        "include(cmake/qt.cmake)",
        "int main() { return 0; }\n",
    );
    std::fs::write(
        mkdir(&included_root, "cmake").join("qt.cmake"),
        "find_package(Qt6 COMPONENTS Widgets REQUIRED)\n",
    )
    .unwrap();
    assert_eq!(detect_project_qt_major(&included_root), 6);

    for declaration in [
        "find_package(QT NAMES Qt6 Qt5 REQUIRED COMPONENTS Widgets)\nfind_package(Qt${QT_VERSION_MAJOR} REQUIRED COMPONENTS Widgets)",
        "find_package(Qt6 COMPONENTS Widgets)\nif(NOT Qt6_FOUND)\n    find_package(Qt5 REQUIRED COMPONENTS Widgets)\nendif()",
        "# find_package(Qt6 COMPONENTS Widgets REQUIRED)\nfind_package(Qt5 COMPONENTS Widgets REQUIRED)",
    ] {
        let (_t, root) = tree();
        create_version_fixture(&root, declaration, "int main() { return 0; }\n");
        assert_eq!(detect_project_qt_major(&root), 5, "{declaration}");
    }
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
        "cmake_minimum_required(VERSION 3.16)\nfind_package(Qt5 COMPONENTS Gui REQUIRED)\n",
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
            QtMigrationIntakeFieldState {
                state: QtMigrationFieldResolutionState::Resolved,
                value: Some(value.to_string()),
            },
        );
    }
    snapshot.version_strategy = strategy;
    snapshot
}

#[test]
fn a_toolchain_typed_into_the_strategy_question_replaces_the_bound_one() {
    let (_t, root) = tree();
    let project = mkdir(&root, "qt6-app");
    create_version_fixture(
        &project,
        "find_package(Qt6 COMPONENTS Widgets REQUIRED)",
        "QAnyStringView view;\n",
    );
    let qt5_bin = create_qt5_ohos_kit(&mkdir(&root, "Qt5.15.2"));
    let qt6_bin = create_qt6_ohos_kit(&mkdir(&root, "Qt6.12.0"));
    let pending = bound_intake_snapshot(
        &project.to_string_lossy(),
        &qt5_bin.to_string_lossy(),
        QtMigrationVersionStrategy::Pending {
            project: 6,
            toolchain: 5,
        },
    );

    let qt6_bin_text = qt6_bin.to_string_lossy().into_owned();
    let matched = rebind_strategy_toolchain(&pending, &qt6_bin_text, None);
    assert_eq!(
        matched.fields["toolchain"].value.as_deref(),
        Some(qt6_bin_text.as_str())
    );
    assert_eq!(
        matched.version_strategy,
        QtMigrationVersionStrategy::NotNeeded
    );
    assert_ne!(matched.status, QtMigrationIntakeStatus::Blocked);
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
    let session = candidate_for(&scan.toolchains, &session_bin).expect("会话探测命中必须在结果里");
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
