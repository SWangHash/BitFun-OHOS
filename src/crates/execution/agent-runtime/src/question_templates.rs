//! Static question templates for the `AskUserQuestion` tool.
//!
//! A template lets an agent reference a fixed set of questions by `templateId`
//! instead of re-emitting long JSON through the model. Template content is owned
//! by the backend so models cannot rephrase, rename, reorder, or drop fields
//! (e.g. `inputPlaceholder`). Add entries here and expose them via
//! [`resolve_question_template`].
//!
//! Qt template policy:
//! - questions are field-keyed (`field` id), carrying default/alternate
//!   options plus a real text input (`inputPlaceholder`) so the ask card shows
//!   both choices and a free-text path box;
//! - `presentation` (layout/allowSkip/hintKey/requiredFields) is produced only
//!   by this backend template; inline model `presentation` is ignored;
//! - the template is versioned so submit-time re-validation is bound to the
//!   exact waiting request.

use crate::user_questions::{Question, QuestionOption, QuestionPresentation};
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

/// Everything resolved from a template: questions plus backend presentation
/// policy plus version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedQuestionTemplate {
    pub questions: Vec<Question>,
    pub presentation: QuestionPresentation,
    pub template_version: String,
}

/// Resolve the question list for a template id. Returns `None` for unknown ids
/// so callers can fail closed instead of showing an unexpected/empty dialog.
pub fn resolve_question_template(template_id: &str) -> Option<Vec<Question>> {
    resolve_question_template_full(template_id, &HashMap::new()).map(|resolved| resolved.questions)
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct QtMigrationQuestionContext {
    pub managed_toolchain_available: bool,
    pub managed_template_available: bool,
}

/// Resolve questions plus backend presentation policy and version.
///
/// `candidates` maps field id -> list of candidate paths probed by the Agent.
/// For each question, candidate paths become option labels so the user can
/// click to select instead of typing; fields without candidates get empty
/// options and the frontend shows only the text input.
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
        QT_MIGRATION_PATHS_TEMPLATE_ID => Some(ResolvedQuestionTemplate {
            questions: qt_migration_paths_questions(candidates, context),
            presentation: QuestionPresentation {
                layout: "wizard".to_string(),
                allow_skip: false,
                intro_key: Some(QT_MIGRATION_PATHS_INTRO_KEY.to_string()),
                hint_key: Some(QT_MIGRATION_PATHS_HINT_KEY.to_string()),
                required_fields: Some(vec![
                    "source_project".to_string(),
                    "output_project".to_string(),
                    "toolchain".to_string(),
                    "template".to_string(),
                ]),
            },
            template_version: QT_MIGRATION_PATHS_TEMPLATE_VERSION.to_string(),
        }),
        _ => None,
    }
}

/// Candidate value used by the official skill-managed option.
pub const QT_MIGRATION_OFFICIAL_VALUE: &str = "__official__";

/// Candidate paths are rendered as options; toolchain and template also expose
/// the skill-managed option when fewer than two concrete candidates exist.
pub fn qt_migration_paths_questions(
    candidates: &HashMap<String, Vec<String>>,
    context: QtMigrationQuestionContext,
) -> Vec<Question> {
    // Build option list from candidate paths. Fields without candidates get
    // an empty options vec so the frontend shows only the text input.
    fn candidate_options(
        candidates: &HashMap<String, Vec<String>>,
        field: &str,
        managed_resource_available: bool,
    ) -> Vec<QuestionOption> {
        // First candidate becomes "默认路径" (recommended, pre-selected by the
        // frontend), the rest become "备选路径". The actual path goes into
        // `description` so the UI shows description on line 1 and the path on
        // line 2.
        let mut options = Vec::new();
        if let Some(paths) = candidates.get(field) {
            for (i, path) in paths.iter().take(2).enumerate() {
                let label = if i == 0 {
                    "默认路径"
                } else {
                    "备选路径"
                };
                options.push(QuestionOption {
                    label: label.to_string(),
                    description: path.clone(),
                    value: None,
                });
            }
        }
        if matches!(field, "toolchain" | "template")
            && options.len() < 2
            && !managed_resource_available
        {
            options.push(QuestionOption {
                label: if field == "toolchain" {
                    "鸿蒙OS推荐工具链".to_string()
                } else {
                    "鸿蒙OS推荐模板".to_string()
                },
                description: "由 ohos-qt-skills 负责准备".to_string(),
                value: Some(QT_MIGRATION_OFFICIAL_VALUE.to_string()),
            });
        }
        options
    }
    // Four intake questions, each with candidate-path options (when available)
    // plus a real text input (inputPlaceholder). The backend owns requiredness.
    vec![
        Question {
            question: "你希望从哪个原始工程开始迁移？".to_string(),
            header: "原始工程".to_string(),
            options: candidate_options(candidates, "source_project", false),
            multi_select: false,
            input_placeholder: Some("请填写您原始工程路径".to_string()),
            field: Some("source_project".to_string()),
            required: true,
        },
        Question {
            question: "迁移后的鸿蒙工程输出在哪里？".to_string(),
            header: "输出路径".to_string(),
            options: candidate_options(candidates, "output_project", false),
            multi_select: false,
            input_placeholder: Some("请填写输出工程路径".to_string()),
            field: Some("output_project".to_string()),
            required: true,
        },
        Question {
            question: "使用哪个QT迁移工具链？".to_string(),
            header: "迁移工具链".to_string(),
            options: candidate_options(
                candidates,
                "toolchain",
                context.managed_toolchain_available,
            ),
            multi_select: false,
            input_placeholder: Some("请填写QT迁移工具链路径".to_string()),
            field: Some("toolchain".to_string()),
            required: true,
        },
        Question {
            question: "使用哪个鸿蒙模板工程？".to_string(),
            header: "模板工程".to_string(),
            options: candidate_options(candidates, "template", context.managed_template_available),
            multi_select: false,
            input_placeholder: Some("请填写模板工程路径".to_string()),
            field: Some("template".to_string()),
            required: true,
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

        let presentation = &resolved.presentation;
        assert_eq!(presentation.layout, "wizard");
        assert!(!presentation.allow_skip, "Qt fields must not be skippable");
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
    fn legacy_resolve_returns_questions_only() {
        let questions = resolve_question_template(QT_MIGRATION_PATHS_TEMPLATE_ID)
            .expect("known template must resolve");
        assert_eq!(questions.len(), 4);
        assert_eq!(questions[0].field.as_deref(), Some("source_project"));
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
        assert_eq!(source.options[0].label, "默认路径");
        assert_eq!(source.options[0].description, "D:/work/myqt");
        let output = &resolved.questions[1];
        assert!(output.options.is_empty());
        let toolchain = &resolved.questions[2];
        assert_eq!(toolchain.options.len(), 2);
        assert_eq!(toolchain.options[0].label, "默认路径");
        assert_eq!(toolchain.options[0].description, "D:/ohos/sdk");
        assert_eq!(toolchain.options[1].label, "备选路径");
        assert_eq!(toolchain.options[1].description, "D:/ohos/sdk2");
    }

    #[test]
    fn managed_resources_hide_official_options() {
        let mut candidates = HashMap::new();
        let context = QtMigrationQuestionContext {
            managed_toolchain_available: true,
            managed_template_available: true,
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
            context,
        )
        .expect("known template must resolve");
        assert_eq!(resolved.questions[2].options[0].label, "默认路径");
    }

    #[test]
    fn official_option_is_lowest_priority_and_default_when_no_candidates() {
        let resolved =
            resolve_question_template_full(QT_MIGRATION_PATHS_TEMPLATE_ID, &HashMap::new())
                .expect("known template must resolve");
        for index in [2, 3] {
            let options = &resolved.questions[index].options;
            assert_eq!(options.len(), 1);
            assert_eq!(
                options[0].value.as_deref(),
                Some(QT_MIGRATION_OFFICIAL_VALUE)
            );
        }

        let mut candidates = HashMap::new();
        candidates.insert("toolchain".to_string(), vec!["D:/ohos/sdk".to_string()]);
        let resolved = resolve_question_template_full(QT_MIGRATION_PATHS_TEMPLATE_ID, &candidates)
            .expect("known template must resolve");
        let options = &resolved.questions[2].options;
        assert_eq!(options.len(), 2);
        assert!(options[0].value.is_none());
        assert_eq!(
            options[1].value.as_deref(),
            Some(QT_MIGRATION_OFFICIAL_VALUE)
        );

        candidates.insert(
            "toolchain".to_string(),
            vec!["D:/ohos/sdk".to_string(), "D:/ohos/sdk2".to_string()],
        );
        let resolved = resolve_question_template_full(QT_MIGRATION_PATHS_TEMPLATE_ID, &candidates)
            .expect("known template must resolve");
        assert_eq!(resolved.questions[2].options.len(), 2);
        assert!(resolved.questions[2]
            .options
            .iter()
            .all(|option| option.value.is_none()));
    }

    #[test]
    fn unknown_template_resolves_to_none() {
        assert!(resolve_question_template("does-not-exist").is_none());
        assert!(resolve_question_template_full("does-not-exist", &HashMap::new()).is_none());
    }
}
