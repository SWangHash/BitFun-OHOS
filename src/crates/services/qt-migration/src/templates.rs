//! Static question templates for the `AskUserQuestion` tool.

use crate::state::QT_MIGRATION_OFFICIAL_VALUE;
use bitfun_product_domains::qt_migration::{
    QtMigrationOption, QtMigrationQuestion, ResolvedQuestionTemplate,
    QT_MIGRATION_INTAKE_REQUIRED_FIELDS,
};
use bitfun_product_domains::user_questions::{Question, QuestionPresentation};
use std::collections::HashMap;

/// Template id for the Qt migration path confirmation questions.
pub const QT_MIGRATION_PATHS_TEMPLATE_ID: &str = "qt-migration-paths";

/// i18n key for the explanatory text rendered immediately before the Qt path
/// question card.
pub const QT_MIGRATION_PATHS_INTRO_KEY: &str = "askUser.qtMigration.pathsIntro";

/// i18n key for the Qt template footer hint (rendered only because the backend
/// template declares it; plain questions never show it). The key is relative to
/// the `toolCards` namespace root (`toolCards.${hintKey}` on the web card), so
/// it must include the `askUser` segment that owns the card copy.
pub const QT_MIGRATION_PATHS_HINT_KEY: &str = "askUser.qtMigration.pathsHint";

/// Current template version. Bump whenever the question/policy shape changes;
/// submit-time binding checks this against the waiting request.
pub const QT_MIGRATION_PATHS_TEMPLATE_VERSION: &str = "1";

/// i18n key for the toolchain notice shown when every listed source project is
/// written against a Qt generation the official managed toolchain cannot build
/// (Qt6). BitFun cannot install that toolchain: the user installs it with the Qt
/// installer first and then picks its path.
pub const QT_MIGRATION_QT6_TOOLCHAIN_NOTICE_KEY: &str =
    "askUser.qtMigration.notice.qt6ToolchainManualInstall";

/// Installation guide for the Qt6 for HarmonyOS toolchain.
pub const QT_MIGRATION_QT6_TOOLCHAIN_GUIDE_URL: &str =
    "https://wiki.qt.io/Qt_for_HarmonyOS/development_with_6.12.0_Beta2_zh";

/// The Qt6 toolchain guide only covers Windows and macOS hosts, so the
/// manual-install notice is limited to those hosts; HarmonyOS builds never show it.
const QT6_TOOLCHAIN_GUIDE_HOST_SUPPORTED: bool =
    cfg!(any(target_os = "windows", target_os = "macos"));

/// Resolve the question list for a template id. Returns `None` for unknown ids
/// so callers can fail closed instead of showing an unexpected/empty dialog.
pub fn resolve_question_template(template_id: &str) -> Option<Vec<Question>> {
    resolve_question_template_full(template_id, &HashMap::new()).map(|resolved| resolved.questions)
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct QtMigrationQuestionContext {
    pub managed_toolchain_available: bool,
    pub managed_template_available: bool,
    /// Qt major version per toolchain candidate path, so the rendered option can
    /// tell Qt5 from Qt6. Keys are the candidate
    /// strings produced by the scan; a candidate without an entry (or a version
    /// the scan could not identify) is rendered without a version.
    pub toolchain_versions: Vec<(String, u8)>,
    /// Qt major version per **source project** candidate path, read from the
    /// project's own C++ sources instead of a kit layout. Kept
    /// beside `toolchain_versions` rather than merged into one "version" bag so
    /// "the version to build with" and "the version the project is written
    /// against" cannot be confused; the keys are `source_project` candidates, so a
    /// path shared with another field cannot pick up a project version.
    pub project_versions: Vec<(String, u8)>,
    /// Whether the official managed toolchain's Qt generation can serve **a project
    /// the card lists** — any candidate, not only the pre-selected one. `Some(false)`
    /// means no listed project is written against that generation, so the download
    /// would install a kit none of them can build with, and the option is hidden.
    pub official_toolchain_serves_project_generation: Option<bool>,
}

impl QtMigrationQuestionContext {
    /// Whether the card may offer the official toolchain download for this context.
    /// See [`Self::official_toolchain_serves_project_generation`].
    fn official_toolchain_is_offerable(&self) -> bool {
        self.official_toolchain_serves_project_generation
            .unwrap_or(true)
    }
}

/// Resolve questions plus backend presentation policy and version.
pub fn resolve_question_template_full(
    template_id: &str,
    candidates: &HashMap<String, Vec<String>>,
) -> Option<ResolvedQuestionTemplate> {
    resolve_question_template_with_context(
        template_id,
        candidates,
        QtMigrationQuestionContext::default(),
    )
}

pub fn resolve_question_template_with_context(
    template_id: &str,
    candidates: &HashMap<String, Vec<String>>,
    context: QtMigrationQuestionContext,
) -> Option<ResolvedQuestionTemplate> {
    match template_id {
        QT_MIGRATION_PATHS_TEMPLATE_ID => {
            let qt_migration_questions = qt_migration_intake_questions(candidates, context);
            Some(ResolvedQuestionTemplate {
                questions: qt_migration_questions
                    .iter()
                    .map(QtMigrationQuestion::to_question)
                    .collect(),
                presentation: QuestionPresentation {
                    layout: "wizard".to_string(),
                    allow_skip: false,
                    intro_key: Some(QT_MIGRATION_PATHS_INTRO_KEY.to_string()),
                    hint_key: Some(QT_MIGRATION_PATHS_HINT_KEY.to_string()),
                    required_fields: Some(
                        QT_MIGRATION_INTAKE_REQUIRED_FIELDS
                            .iter()
                            .map(|field| (*field).to_string())
                            .collect(),
                    ),
                    // A migration cannot start without its four paths, so the
                    // intake card blocks until the user answers instead of
                    // reporting a timeout that would skip required input.
                    allow_timeout: false,
                },
                template_version: QT_MIGRATION_PATHS_TEMPLATE_VERSION.to_string(),
                qt_migration_questions: Some(qt_migration_questions),
            })
        }
        _ => None,
    }
}

/// Candidate paths are rendered as options. The `toolchain` and `source_project`
/// fields additionally carry the Qt major version of each candidate, and both
/// `toolchain` and `template` expose the download option when nothing usable was
/// found.
pub fn qt_migration_intake_questions(
    candidates: &HashMap<String, Vec<String>>,
    context: QtMigrationQuestionContext,
) -> Vec<QtMigrationQuestion> {
    // Build option list from candidate paths. Fields without candidates get
    // an empty options vec so the UI shows only the text input.
    fn candidate_options(
        candidates: &HashMap<String, Vec<String>>,
        field: &str,
        managed_resource_available: bool,
        official_download_allowed: bool,
        versions: &[(String, u8)],
    ) -> Vec<QtMigrationOption> {
        // First candidate becomes the default (recommended, pre-selected by the
        // card), the rest become alternates. The path is a concrete value the
        // card renders as the option's second line; a candidate's Qt major
        // version travels in `version` instead of being appended to the path, so
        // the submitted answer stays a usable path.
        let mut options = Vec::new();
        if let Some(paths) = candidates.get(field) {
            for (i, path) in paths.iter().take(2).enumerate() {
                let label = if i == 0 {
                    "askUser.qtMigration.option.default"
                } else {
                    "askUser.qtMigration.option.alternate"
                };
                options.push(QtMigrationOption {
                    label: label.to_string(),
                    description: None,
                    path: path.clone(),
                    value: None,
                    version: candidate_qt_major(path, versions),
                });
            }
        }
        // Download option condition, one rule for both
        // fields: fewer than two candidates *and* none of them is the managed
        // resource. Two candidates are a real choice on their own, and a managed
        // candidate means the official resource is already on disk — offering
        // "download the official one" next to it (or next to two local ones) would
        // ask the user to fetch what is already resolved.

        // `official_download_allowed` is the second, independent reason to hide the
        // option: the official toolchain is one fixed Qt generation, so for a
        // recommended project of the other generation there is nothing to choose —
        // only a download that cannot build the project. The field then falls back
        // to the user's own path (the card shows the text input alone).
        if (field == "toolchain" || field == "template")
            && options.len() < 2
            && !managed_resource_available
            && official_download_allowed
        {
            options.push(managed_option(
                if field == "toolchain" {
                    // The toolchain kit is installed by the runtime on submit
                    // , so the option must not
                    // promise the skill flow.
                    "askUser.qtMigration.option.officialToolchain"
                } else {
                    "askUser.qtMigration.option.officialTemplate"
                },
                if field == "toolchain" {
                    "askUser.qtMigration.option.officialToolchainDescription"
                } else {
                    // Templates have no runtime provisioner: the skill still prepares
                    // them, so the description keeps saying so.
                    "askUser.qtMigration.option.officialDescription"
                },
            ));
        }
        options
    }

    /// The managed download option has no local path: it submits its explicit
    /// value and carries its own description key.
    fn managed_option(label: &str, description: &str) -> QtMigrationOption {
        QtMigrationOption {
            label: label.to_string(),
            description: Some(description.to_string()),
            path: String::new(),
            value: Some(QT_MIGRATION_OFFICIAL_VALUE.to_string()),
            version: None,
        }
    }

    /// Qt major version of a candidate, when the caller supplied one. Which list
    /// a field is resolved against is the caller's decision and stays separate:
    /// `toolchain` reads the measured kit versions, `source_project` the versions
    /// read from the project sources, and the remaining fields get none.
    fn candidate_qt_major(path: &str, versions: &[(String, u8)]) -> Option<u8> {
        versions
            .iter()
            .find(|(candidate, _)| candidate == path)
            .map(|(_, qt_major)| *qt_major)
    }

    let toolchain_versions = context.toolchain_versions.clone();
    let project_versions = context.project_versions.clone();
    // Only the toolchain has an official generation to compare against; the
    // template's download option keeps its own rule.
    let official_toolchain_download_allowed = context.official_toolchain_is_offerable();
    let toolchain_options = candidate_options(
        candidates,
        "toolchain",
        context.managed_toolchain_available,
        official_toolchain_download_allowed,
        &toolchain_versions,
    );
    // The listed source projects are all Qt6 and the scan found no toolchain path
    // to recommend for them, so the field cannot be answered with a candidate.
    // BitFun cannot provision a Qt6 toolchain: tell the user to install it with
    // the Qt installer first. A scanned Qt6 kit, or any Qt5 project (served by a
    // Qt5 kit or the official download), needs no notice. The guide only covers
    // Windows and macOS hosts, so other hosts (HarmonyOS) get no notice.
    let qt6_toolchain_must_be_installed_manually = QT6_TOOLCHAIN_GUIDE_HOST_SUPPORTED
        && !project_versions.is_empty()
        && project_versions.iter().all(|(_, qt_major)| *qt_major == 6)
        && !toolchain_options.iter().any(|option| {
            // A candidate path recommends a toolchain unless it is measured as
            // another generation.
            !option.path.is_empty() && !matches!(option.version, Some(qt_major) if qt_major != 6)
        });
    let (toolchain_notice, toolchain_notice_url) = if qt6_toolchain_must_be_installed_manually {
        (
            Some(QT_MIGRATION_QT6_TOOLCHAIN_NOTICE_KEY.to_string()),
            Some(QT_MIGRATION_QT6_TOOLCHAIN_GUIDE_URL.to_string()),
        )
    } else {
        (None, None)
    };
    // Four intake questions, each with candidate-path options (when available)
    // plus a real text input (placeholder). The backend owns requiredness.
    // Question/header/placeholder text is i18n-keyed (askUser.qtMigration.*).
    vec![
        QtMigrationQuestion {
            field: "source_project".to_string(),
            header: "askUser.qtMigration.field.sourceProject".to_string(),
            prompt: "askUser.qtMigration.question.sourceProject".to_string(),
            placeholder: Some("askUser.qtMigration.placeholder.sourceProject".to_string()),
            required: true,
            options: candidate_options(
                candidates,
                "source_project",
                false,
                false,
                &project_versions,
            ),
            notice: None,
            notice_url: None,
        },
        QtMigrationQuestion {
            field: "output_project".to_string(),
            header: "askUser.qtMigration.field.outputProject".to_string(),
            prompt: "askUser.qtMigration.question.outputProject".to_string(),
            placeholder: Some("askUser.qtMigration.placeholder.outputProject".to_string()),
            required: true,
            options: candidate_options(candidates, "output_project", false, false, &[]),
            notice: None,
            notice_url: None,
        },
        QtMigrationQuestion {
            field: "toolchain".to_string(),
            header: "askUser.qtMigration.field.toolchain".to_string(),
            prompt: "askUser.qtMigration.question.toolchain".to_string(),
            placeholder: Some("askUser.qtMigration.placeholder.toolchain".to_string()),
            required: true,
            options: toolchain_options,
            notice: toolchain_notice,
            notice_url: toolchain_notice_url,
        },
        QtMigrationQuestion {
            field: "template".to_string(),
            header: "askUser.qtMigration.field.template".to_string(),
            prompt: "askUser.qtMigration.question.template".to_string(),
            placeholder: Some("askUser.qtMigration.placeholder.template".to_string()),
            required: true,
            options: candidate_options(
                candidates,
                "template",
                context.managed_template_available,
                true,
                &[],
            ),
            notice: None,
            notice_url: None,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_qt_migration_paths_template_with_policy() {
        let resolved =
            resolve_question_template_full(QT_MIGRATION_PATHS_TEMPLATE_ID, &HashMap::new())
                .expect("known template must resolve");
        assert_eq!(resolved.questions.len(), 4);
        assert_eq!(resolved.template_version, "1");

        // The Qt template also ships its own question shape; the generic
        // projection must stay a faithful one-to-one view of it.
        let qt_questions = resolved
            .qt_migration_questions
            .as_ref()
            .expect("the Qt template ships its own question shape");
        assert_eq!(qt_questions.len(), resolved.questions.len());
        for (qt_question, question) in qt_questions.iter().zip(&resolved.questions) {
            assert_eq!(Some(&qt_question.field), question.field.as_ref());
            assert_eq!(qt_question.prompt, question.question);
            assert_eq!(qt_question.header, question.header);
            assert_eq!(qt_question.placeholder, question.input_placeholder);
            assert_eq!(qt_question.required, question.required);
            assert_eq!(qt_question.options.len(), question.options.len());
        }

        let presentation = &resolved.presentation;
        assert_eq!(presentation.layout, "wizard");
        assert!(!presentation.allow_skip, "Qt fields must not be skippable");
        assert!(
            !presentation.allow_timeout,
            "the Qt intake blocks until it is answered; a timeout would skip required paths"
        );
        assert_eq!(
            presentation.intro_key.as_deref(),
            Some(QT_MIGRATION_PATHS_INTRO_KEY)
        );
        assert_eq!(
            presentation.required_fields.as_deref(),
            Some(
                ["source_project", "output_project", "toolchain", "template"]
                    .map(str::to_string)
                    .as_slice()
            )
        );

        for question in &resolved.questions {
            assert!(!question.question.trim().is_empty());
            assert!(!question.header.trim().is_empty());
            assert!(question.required, "Qt path questions are all required");
            assert!(
                question.field.is_some(),
                "template questions must carry a field id"
            );
            // Toolchain and template expose the official managed option even
            // when no local candidate exists; other fields remain input-only.
            if matches!(question.field.as_deref(), Some("toolchain" | "template")) {
                assert_eq!(question.options.len(), 1);
                assert_eq!(
                    question.options[0].value.as_deref(),
                    Some(QT_MIGRATION_OFFICIAL_VALUE)
                );
                // The description must match who prepares the resource: the
                // runtime installs the toolchain on submit
                // , while templates still come from the skill flow.
                let is_toolchain = question.field.as_deref() == Some("toolchain");
                assert_eq!(
                    question.options[0].description,
                    if is_toolchain {
                        "askUser.qtMigration.option.officialToolchainDescription"
                    } else {
                        "askUser.qtMigration.option.officialDescription"
                    }
                );
            } else {
                assert!(question.options.is_empty());
            }
            assert!(
                question.input_placeholder.is_some(),
                "question must carry inputPlaceholder for the free-text input"
            );
        }
    }
    #[test]
    fn candidates_fill_option_labels() {
        let mut candidates = HashMap::new();
        candidates.insert(
            "source_project".to_string(),
            vec!["D:/work/myqt".to_string()],
        );
        candidates.insert(
            "toolchain".to_string(),
            vec!["D:/ohos/sdk".to_string(), "D:/ohos/sdk2".to_string()],
        );
        let resolved = resolve_question_template_full(QT_MIGRATION_PATHS_TEMPLATE_ID, &candidates)
            .expect("known template must resolve");
        let source = &resolved.questions[0];
        assert_eq!(source.options.len(), 1);
        assert_eq!(
            source.options[0].label,
            "askUser.qtMigration.option.default"
        );
        assert_eq!(source.options[0].description, "D:/work/myqt");
        let output = &resolved.questions[1];
        assert!(output.options.is_empty());
        let toolchain = &resolved.questions[2];
        assert_eq!(toolchain.options.len(), 2);
        assert_eq!(
            toolchain.options[0].label,
            "askUser.qtMigration.option.default"
        );
        assert_eq!(toolchain.options[0].description, "D:/ohos/sdk");
        assert_eq!(
            toolchain.options[1].label,
            "askUser.qtMigration.option.alternate"
        );
        assert_eq!(toolchain.options[1].description, "D:/ohos/sdk2");
    }

    #[test]
    fn managed_resources_hide_official_options() {
        let mut candidates = HashMap::new();
        let context = QtMigrationQuestionContext {
            managed_toolchain_available: true,
            managed_template_available: true,
            ..QtMigrationQuestionContext::default()
        };
        let resolved = resolve_question_template_with_context(
            QT_MIGRATION_PATHS_TEMPLATE_ID,
            &candidates,
            context,
        )
        .expect("known template must resolve");
        assert!(resolved.questions[2].options.is_empty());
        assert!(resolved.questions[3].options.is_empty());

        candidates.insert(
            "toolchain".to_string(),
            vec!["D:/shared/qt/bin".to_string()],
        );
        let resolved = resolve_question_template_with_context(
            QT_MIGRATION_PATHS_TEMPLATE_ID,
            &candidates,
            QtMigrationQuestionContext {
                managed_toolchain_available: true,
                managed_template_available: true,
                ..QtMigrationQuestionContext::default()
            },
        )
        .expect("known template must resolve");
        assert_eq!(
            resolved.questions[2].options[0].label,
            "askUser.qtMigration.option.default"
        );
    }
    #[test]
    fn download_option_needs_fewer_than_two_candidates_and_no_managed_one() {
        // 用户确认的规则：候选 < 2 且候选中没有托管工具链/模板时才显示下载项。
        let with_candidate = HashMap::from([(
            "toolchain".to_string(),
            vec!["D:/ohos/qt6-hmos".to_string()],
        )]);
        let resolved =
            resolve_question_template_full(QT_MIGRATION_PATHS_TEMPLATE_ID, &with_candidate)
                .expect("known template must resolve");
        let options = &resolved.questions[2].options;
        assert_eq!(options.len(), 2);
        assert_eq!(options[0].description, "D:/ohos/qt6-hmos");
        assert_eq!(
            options[1].value.as_deref(),
            Some(QT_MIGRATION_OFFICIAL_VALUE)
        );

        // 两个候选已经是完整选择，不再追加官方选项。
        let two_candidates = HashMap::from([(
            "toolchain".to_string(),
            vec!["D:/ohos/qt5-kit".to_string(), "D:/ohos/qt6-kit".to_string()],
        )]);
        let resolved =
            resolve_question_template_full(QT_MIGRATION_PATHS_TEMPLATE_ID, &two_candidates)
                .expect("known template must resolve");
        let options = &resolved.questions[2].options;
        assert_eq!(options.len(), 2);
        assert!(options.iter().all(|option| option.value.is_none()));

        // 一个候选但它是托管工具链：官方资源已在盘上，不再提示下载。
        let resolved = resolve_question_template_with_context(
            QT_MIGRATION_PATHS_TEMPLATE_ID,
            &with_candidate,
            QtMigrationQuestionContext {
                managed_toolchain_available: true,
                managed_template_available: false,
                toolchain_versions: Vec::new(),
                project_versions: Vec::new(),
                official_toolchain_serves_project_generation: None,
            },
        )
        .expect("known template must resolve");
        let options = &resolved.questions[2].options;
        assert_eq!(options.len(), 1);
        assert_eq!(options[0].description, "D:/ohos/qt6-hmos");

        // 无可用工具链：只给下载选项。
        let resolved =
            resolve_question_template_full(QT_MIGRATION_PATHS_TEMPLATE_ID, &HashMap::new())
                .expect("known template must resolve");
        let options = &resolved.questions[2].options;
        assert_eq!(options.len(), 1);
        assert_eq!(
            options[0].value.as_deref(),
            Some(QT_MIGRATION_OFFICIAL_VALUE)
        );

        // 托管工具链可用且没有候选时同样不提示下载（decision B：托管可用性本身是同一事实）。
        let resolved = resolve_question_template_with_context(
            QT_MIGRATION_PATHS_TEMPLATE_ID,
            &HashMap::new(),
            QtMigrationQuestionContext {
                managed_toolchain_available: true,
                managed_template_available: false,
                toolchain_versions: Vec::new(),
                project_versions: Vec::new(),
                official_toolchain_serves_project_generation: None,
            },
        )
        .expect("known template must resolve");
        assert!(resolved.questions[2].options.is_empty());
    }

    #[test]
    fn official_toolchain_option_is_hidden_when_its_generation_cannot_serve_the_project() {
        // 用户拍板：推荐的原始工程版本在盘上没有对应 kit 时，工具链字段不该再给
        // "下载官方工具链"——它装的是固定的一代（Qt5.12.12），对 Qt6 工程用不了，选了
        // 必然编不过。此时该字段只剩输入框，由用户自己填路径。
        let resolve_with = |candidates: &HashMap<String, Vec<String>>, serves: Option<bool>| {
            resolve_question_template_with_context(
                QT_MIGRATION_PATHS_TEMPLATE_ID,
                candidates,
                QtMigrationQuestionContext {
                    official_toolchain_serves_project_generation: serves,
                    ..QtMigrationQuestionContext::default()
                },
            )
            .expect("known template must resolve")
        };

        // 无候选 + 版本不匹配：工具链字段一个选项都没有（只剩输入框）。
        let mismatched = resolve_with(&HashMap::new(), Some(false));
        assert!(
            mismatched.questions[2].options.is_empty(),
            "版本不匹配时工具链字段不得出现任何选项"
        );

        // 未测出版本（`None`，例如无原始工程）：保持既有行为，仍给下载选项。
        let unknown = resolve_with(&HashMap::new(), None);
        assert_eq!(
            unknown.questions[2].options[0].value.as_deref(),
            Some(QT_MIGRATION_OFFICIAL_VALUE),
            "未测出版本时仍可下载官方工具链"
        );

        // 模板字段不受工具链这一事实影响：模板本轮不做版本匹配。
        for resolved in [&mismatched, &unknown] {
            assert_eq!(
                resolved.questions[3].options[0].value.as_deref(),
                Some(QT_MIGRATION_OFFICIAL_VALUE),
                "模板的下载选项规则不变"
            );
        }

        // 一个 Qt6 kit 候选 + 版本不匹配：只给这个候选，不追加官方下载。
        let qt6_kit =
            HashMap::from([("toolchain".to_string(), vec!["D:/ohos/qt6-kit".to_string()])]);
        let resolved = resolve_with(&qt6_kit, Some(false));
        let options = &resolved.questions[2].options;
        assert_eq!(options.len(), 1);
        assert_eq!(options[0].description, "D:/ohos/qt6-kit");
        assert!(options.iter().all(|option| option.value.is_none()));
    }

    #[test]
    fn qt6_only_projects_ask_the_user_to_install_the_toolchain_first() {
        // 原始工程全为 Qt6 且扫描不到可推荐的工具链路径（只剩输入框）时，
        // 提示用户先按官方文档用 Qt installer 自行安装 Qt6 工具链。
        let candidates = HashMap::from([(
            "source_project".to_string(),
            vec!["D:/proj/qt6-app".to_string()],
        )]);
        let resolve_with = |project_versions: Vec<(String, u8)>, serves: Option<bool>| {
            resolve_question_template_with_context(
                QT_MIGRATION_PATHS_TEMPLATE_ID,
                &candidates,
                QtMigrationQuestionContext {
                    project_versions,
                    official_toolchain_serves_project_generation: serves,
                    ..QtMigrationQuestionContext::default()
                },
            )
            .expect("known template must resolve")
            .qt_migration_questions
            .expect("the Qt template ships its own question shape")
        };

        let qt6 = resolve_with(vec![("D:/proj/qt6-app".to_string(), 6)], Some(false));
        let toolchain = &qt6[2];
        assert_eq!(toolchain.field, "toolchain");
        assert!(toolchain.options.is_empty());
        for (index, question) in qt6.iter().enumerate() {
            if index != 2 {
                assert!(question.notice.is_none() && question.notice_url.is_none());
            }
        }
        // 提示只在 Windows / macOS 主机上出现；鸿蒙（及其他主机）没有该安装文档，
        // 不提示。
        if !QT6_TOOLCHAIN_GUIDE_HOST_SUPPORTED {
            assert!(toolchain.notice.is_none() && toolchain.notice_url.is_none());
            return;
        }
        assert_eq!(
            toolchain.notice.as_deref(),
            Some(QT_MIGRATION_QT6_TOOLCHAIN_NOTICE_KEY)
        );
        assert_eq!(
            toolchain.notice_url.as_deref(),
            Some(QT_MIGRATION_QT6_TOOLCHAIN_GUIDE_URL)
        );

        // 官方下载仍可用（Qt5 工程或版本未知）时不提示。
        let qt5 = resolve_with(vec![("D:/proj/qt6-app".to_string(), 5)], Some(true));
        assert!(qt5[2].notice.is_none() && qt5[2].notice_url.is_none());
        let unknown = resolve_with(Vec::new(), None);
        assert!(unknown[2].notice.is_none());
        // Qt5、Qt6 工程混合时，工具链不必只靠 Qt6，不提示。
        let mixed = resolve_with(
            vec![
                ("D:/proj/qt6-app".to_string(), 6),
                ("D:/proj/qt5-app".to_string(), 5),
            ],
            Some(true),
        );
        assert!(mixed[2].notice.is_none());

        // 扫描到了 Qt6 工具链（能给出推荐路径）时不提示。
        let with_qt6_kit = HashMap::from([
            (
                "source_project".to_string(),
                vec!["D:/proj/qt6-app".to_string()],
            ),
            ("toolchain".to_string(), vec!["D:/ohos/qt6-kit".to_string()]),
        ]);
        let scanned = resolve_question_template_with_context(
            QT_MIGRATION_PATHS_TEMPLATE_ID,
            &with_qt6_kit,
            QtMigrationQuestionContext {
                toolchain_versions: vec![("D:/ohos/qt6-kit".to_string(), 6)],
                project_versions: vec![("D:/proj/qt6-app".to_string(), 6)],
                official_toolchain_serves_project_generation: Some(false),
                ..QtMigrationQuestionContext::default()
            },
        )
        .expect("known template must resolve")
        .qt_migration_questions
        .expect("the Qt template ships its own question shape");
        assert_eq!(scanned[2].options[0].path, "D:/ohos/qt6-kit");
        assert!(scanned[2].notice.is_none() && scanned[2].notice_url.is_none());

        // 线上形状：字段为 camelCase 的 noticeUrl，旧载荷缺字段时可反序列化。
        let encoded = serde_json::to_value(toolchain).expect("serialize");
        assert_eq!(
            encoded["noticeUrl"].as_str(),
            Some(QT_MIGRATION_QT6_TOOLCHAIN_GUIDE_URL)
        );
        let encoded = serde_json::to_value(&qt5[2]).expect("serialize");
        assert!(encoded.get("notice").is_none() && encoded.get("noticeUrl").is_none());
    }

    #[test]
    fn toolchain_candidate_carries_the_qt_major_version_as_its_own_field() {
        // 候选项必须能区分 Qt5 与 Qt6。版本是结构化字段，
        // **不能**再拼进路径文本（旧实现拼 " (Qt5)"，会随提交值一起落库）。
        let candidates = HashMap::from([(
            "toolchain".to_string(),
            vec!["D:/ohos/qt5-kit".to_string(), "D:/ohos/qt6-kit".to_string()],
        )]);
        let context = QtMigrationQuestionContext {
            managed_toolchain_available: false,
            managed_template_available: false,
            toolchain_versions: vec![
                ("D:/ohos/qt5-kit".to_string(), 5),
                ("D:/ohos/qt6-kit".to_string(), 6),
            ],
            project_versions: Vec::new(),
            official_toolchain_serves_project_generation: None,
        };
        let resolved = resolve_question_template_with_context(
            QT_MIGRATION_PATHS_TEMPLATE_ID,
            &candidates,
            context,
        )
        .expect("known template must resolve");

        let qt_questions = resolved
            .qt_migration_questions
            .as_ref()
            .expect("the Qt template ships its own question shape");
        assert_eq!(qt_questions.len(), 4);
        assert_eq!(qt_questions[2].field, "toolchain");
        let toolchain = &qt_questions[2].options;
        assert_eq!(toolchain[0].path, "D:/ohos/qt5-kit");
        assert_eq!(toolchain[0].version, Some(5));
        assert_eq!(toolchain[1].path, "D:/ohos/qt6-kit");
        assert_eq!(toolchain[1].version, Some(6));
        // 候选路径不带版本文本，两条线（Qt 专用 + 通用投影）都必须干净。
        for option in toolchain {
            assert!(
                !option.path.contains("Qt"),
                "candidate path must stay clean: {}",
                option.path
            );
        }
        let projected = &resolved.questions[2].options;
        assert_eq!(projected[0].description, "D:/ohos/qt5-kit");
        assert_eq!(projected[1].description, "D:/ohos/qt6-kit");
        // 提交值取自 path（`value` 为空），所以落库值也是干净路径。
        assert!(projected.iter().all(|option| option.value.is_none()));

        // 非工具链字段不带版本；未知版本的候选保持 None。
        let templates = HashMap::from([("template".to_string(), vec!["D:/tpl".to_string()])]);
        let resolved = resolve_question_template_with_context(
            QT_MIGRATION_PATHS_TEMPLATE_ID,
            &templates,
            QtMigrationQuestionContext::default(),
        )
        .expect("known template must resolve");
        let templates = resolved.qt_migration_questions.as_ref().unwrap();
        assert_eq!(templates[3].options[0].path, "D:/tpl");
        assert_eq!(templates[3].options[0].version, None);

        let candidates = HashMap::from([("toolchain".to_string(), vec!["D:/sdk".to_string()])]);
        let resolved = resolve_question_template_with_context(
            QT_MIGRATION_PATHS_TEMPLATE_ID,
            &candidates,
            QtMigrationQuestionContext::default(),
        )
        .expect("known template must resolve");
        let toolchain = &resolved.qt_migration_questions.as_ref().unwrap()[2].options;
        assert_eq!(toolchain[0].path, "D:/sdk");
        assert_eq!(toolchain[0].version, None, "未测出版本时保持 None");
    }

    #[test]
    fn source_project_candidates_carry_the_project_version_and_no_other_field_does() {
        // 源工程候选显示"代码写的是哪一代 Qt"，与"工具链是哪一代"
        // 是两份事实。共用一个路径也不得互相串味。
        let shared = "D:/shared/path";
        let candidates = HashMap::from([
            (
                "source_project".to_string(),
                vec!["D:/proj/qt6-app".to_string(), "D:/proj/qt5-app".to_string()],
            ),
            ("toolchain".to_string(), vec![shared.to_string()]),
            ("template".to_string(), vec![shared.to_string()]),
        ]);
        let context = QtMigrationQuestionContext {
            managed_toolchain_available: false,
            managed_template_available: false,
            toolchain_versions: vec![(shared.to_string(), 6)],
            project_versions: vec![
                (shared.to_string(), 5),
                ("D:/proj/qt6-app".to_string(), 6),
                ("D:/proj/qt5-app".to_string(), 5),
            ],
            official_toolchain_serves_project_generation: None,
        };
        let resolved = resolve_question_template_with_context(
            QT_MIGRATION_PATHS_TEMPLATE_ID,
            &candidates,
            context,
        )
        .expect("known template must resolve");
        let questions = resolved
            .qt_migration_questions
            .as_ref()
            .expect("the Qt template ships its own question shape");

        let source = &questions[0].options;
        assert_eq!(source[0].path, "D:/proj/qt6-app");
        assert_eq!(source[0].version, Some(6));
        assert_eq!(source[1].path, "D:/proj/qt5-app");
        assert_eq!(source[1].version, Some(5));

        // 同一路径在 `toolchain` 上取的是工具链版本，在 `template` 上没有版本：
        // 工程版本表不参与这两个字段。
        let toolchain = &questions[2].options;
        assert_eq!(toolchain[0].path, shared);
        assert_eq!(toolchain[0].version, Some(6));
        assert_eq!(questions[3].options[0].version, None);
    }
    #[test]
    fn unknown_template_resolves_to_none() {
        assert!(resolve_question_template("does-not-exist").is_none());
        assert!(resolve_question_template_full("does-not-exist", &HashMap::new()).is_none());
    }

    #[test]
    fn qt_template_questions_round_trip_from_the_wire_shape() {
        // 前端按 Qt 自己的类型解析信封里的 `qtMigrationQuestions`，所以这个
        // 形状必须能原样反序列化回来。
        let encoded = serde_json::json!({
            "field": "toolchain",
            "header": "askUser.qtMigration.field.toolchain",
            "prompt": "askUser.qtMigration.question.toolchain",
            "placeholder": "askUser.qtMigration.placeholder.toolchain",
            "required": true,
            "options": [{
                "label": "askUser.qtMigration.option.default",
                "path": "D:/ohos/qt6-kit",
                "version": 6,
            }],
        });
        let question: QtMigrationQuestion =
            serde_json::from_value(encoded).expect("Qt question must deserialize");
        assert_eq!(question.field, "toolchain");
        assert_eq!(question.options[0].version, Some(6));
        assert_eq!(question.options[0].value, None);
        assert_eq!(question.options[0].description, None);
    }
}
