//! The `qt-migration-paths` question card as a [`QuestionTemplateContribution`].
//!
//! The card is one backend-owned step: candidate preparation (seeding, probing,
//! workspace-output discovery) and rendering happen together so the probe-derived
//! context cannot drift from the rendered options. Submit-time validation and
//! the answer receipt travel with the same contribution.

use std::collections::{BTreeMap, HashMap};

use bitfun_product_domains::qt_migration::QT_MIGRATION_INTAKE_REQUIRED_FIELDS;
use bitfun_runtime_ports::{
    DomainStateReader, DomainStateSlot, QuestionTemplateContribution, ResolvedTemplate,
    SubmissionContext, TemplateContext, TemplateRejection, ToolResultFact,
};
use serde_json::Value;

use crate::admission::QT_MIGRATION_SLOT_INTAKE_STATE;
use crate::state::{
    intake_snapshot_from_slot_value, intake_snapshot_to_slot_value,
    qt_migration_apply_validated_answers, qt_migration_validate_answer_fields,
    QtMigrationIntakeStateSnapshot, QtMigrationVersionStrategy, QT_MIGRATION_OFFICIAL_VALUE,
};
#[cfg(feature = "qt-toolchain")]
use crate::strategy::official_toolchain_serves_a_project;
use crate::strategy::{
    pending_generation_mismatch, version_strategy_follow_up, QtMigrationGenerationMismatch,
    QtMigrationStrategyFollowUp, QT_MIGRATION_STRATEGY_ABORT_VALUE,
    QT_MIGRATION_STRATEGY_PROCEED_VALUE,
};
use crate::templates::{
    resolve_question_template_full, resolve_question_template_with_context,
    QtMigrationQuestionContext, QT_MIGRATION_PATHS_TEMPLATE_ID,
    QT_MIGRATION_PATHS_TEMPLATE_VERSION,
};

/// Session context key the turn gate stashes the migration-intent fact under.
pub const QT_MIGRATION_ENABLED_CONTEXT_KEY: &str = "qt_migration_enabled";
/// Session context key the turn gate stashes the prompt-resolved paths under.
pub const QT_MIGRATION_RESOLVED_PATHS_CONTEXT_KEY: &str = "qt_migration_resolved_paths";

/// Merge prompt-resolved Qt migration paths into the model-provided candidate
/// map. These paths come from the turn gate's semantic analyzer (stashed in
/// [`QT_MIGRATION_RESOLVED_PATHS_CONTEXT_KEY`]) and must reach the option list
/// even when the model calls the template without echoing them.
fn merge_prompt_resolved_paths(candidates: &mut HashMap<String, Vec<String>>, resolved: &Value) {
    for field in ["source_project", "output_project", "toolchain", "template"] {
        let Some(path) = resolved
            .get(field)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|path| !path.is_empty())
        else {
            continue;
        };
        let entry = candidates.entry(field.to_string()).or_default();
        if !entry.iter().any(|existing| existing == path) {
            entry.push(path.to_string());
        }
    }
}

/// Question-template contribution for the Qt migration intake card.
pub struct QtMigrationQuestionCard;

impl QtMigrationQuestionCard {
    /// The installed-toolchain fact for an intake answer, when the runtime installed
    /// the kit while applying that answer.
    ///
    /// `__official__` is a request, not a place: the runtime downloads the official
    /// package on submit (`qt_toolchain_provisioning`) and records the installed kit
    /// root in the session intake snapshot. The model has to build with that path, so it
    /// is stated as a fact on the answer's tool result instead of leaving `__official__`
    /// to travel one hop further. `None` when the answer bound a real toolchain path
    /// already, or when the provisioning has not produced a path yet (its failure path
    /// keeps the official binding, and the knowledge-base script stays the backstop for
    /// that case — the turn-start instruction carries it).
    fn installed_toolchain_fact(
        snapshot: &QtMigrationIntakeStateSnapshot,
        answers: &Value,
    ) -> Option<String> {
        let submitted_official = answers.as_object()?.values().any(|value| match value {
            Value::String(answer) => answer.trim() == QT_MIGRATION_OFFICIAL_VALUE,
            Value::Array(items) => items
                .iter()
                .any(|item| item.as_str().map(str::trim) == Some(QT_MIGRATION_OFFICIAL_VALUE)),
            _ => false,
        });
        if !submitted_official {
            return None;
        }
        let toolchain = snapshot.fields.get("toolchain")?;
        if !toolchain.state.can_bind_value() {
            return None;
        }
        let installed = toolchain.value.as_deref()?;
        if installed == QT_MIGRATION_OFFICIAL_VALUE {
            return None;
        }
        Some(format!(
            "## 工具链已就绪（系统事实，必须使用）\n\n本次提交的 toolchain 绑定是 __official__，运行时已经把它安装到 `{installed}`。\
             本次迁移的工具链就是这个路径：直接使用它，不要再运行任何工具链下载脚本，也不要再做存在性探索或检查，\
             不要在后续任何步骤里把 toolchain 当成 __official__。"
        ))
    }

    /// The Qt migration instruction an answered question must carry back, if any.
    ///
    /// Three answered questions have a consequence inside the same turn:
    ///
    /// - the intake card, when the runtime measured that the bound project and the
    ///   bound toolchain are different Qt generations while applying the answer: the
    ///   intake is `Pending` (derived `Blocked`, so no side effect may run) and the
    ///   model must ask the user about the migration strategy next;
    /// - the strategy question itself — written by the model, so it arrives as a plain
    ///   question with no template id — whose answer decides how the migration may run
    ///   (including "do not migrate", which the coordinator also acts on by stopping
    ///   the turn);
    /// - the same question answered without the required option values, or answered
    ///   with them while the session still records no decision: either way the intake
    ///   stays blocked and the model has to ask again.
    ///
    /// Every fact is read from the session intake snapshot and from the answer values
    /// through `version_strategy_follow_up`, never re-measured here, so the
    /// instruction cannot disagree with the decision the runtime recorded.
    fn follow_up_instruction(
        template_id: Option<&str>,
        answers: &Value,
        snapshot: &QtMigrationIntakeStateSnapshot,
    ) -> Option<String> {
        let intake_template = template_id == Some(QT_MIGRATION_PATHS_TEMPLATE_ID);

        if intake_template {
            let mut facts: Vec<String> = Vec::new();
            // The runtime installed the kit for an `__official__` binding and wrote the
            // kit path into the session snapshot before waking this tool, but the answer
            // the model is reading still carries `__official__` (the recorded user answer
            // is never rewritten). State the installed path here, or the model starts the
            // migration in this very turn without the path it has to build with.
            if let Some(installed) = Self::installed_toolchain_fact(snapshot, answers) {
                facts.push(installed);
            }
            // `None` when the generations agree: the answer stands on its own.
            if let Some(mismatch) = pending_generation_mismatch(snapshot) {
                if let Some(instruction) = mismatch.strategy_instruction() {
                    facts.push(instruction);
                }
            }
            return if facts.is_empty() {
                None
            } else {
                Some(facts.join("\n\n"))
            };
        }

        // Only a session that measured a generation mismatch has anything to say about a
        // plain question; any other question gets no Qt-specific note.
        let follow_up = version_strategy_follow_up(snapshot, answers)?;
        let (project, toolchain) = follow_up.measured_generations()?;
        // The direction the measurement recorded decides the wording in every branch: a
        // "proceed" answer means a downgrade for a newer project and a continue for an
        // older one. Both re-ask instructions have to carry it again, or the model
        // rewrites the same direction-agnostic question the first instruction replaced.
        let direction = follow_up.strategy_accept_semantics()?;

        match follow_up {
            QtMigrationStrategyFollowUp::MissingAnswer { .. } => Some(format!(
                "## 迁移策略未生效（系统约束，必须先处理）\n\n\
                 刚才那次提问的答案里没有运行时要求的选项取值，迁移仍然被阻断。\n\
                 - 如果用户在答案原文里指定了要改用的工具链：从原文中提取路径，信任用户的输入，不要再向用户提问确认。\
                 若路径是 Qt 安装根目录而不是 kit 的 bin 目录，先用 Glob 找到其中鸿蒙 kit（如 harmonyos_*）下含 qmake 的 bin 目录；\
                 然后调用 QtMigrationIntake 并传入 {{\"toolchain\": \"<该路径>\"}} 替换本次迁移绑定的工具链，按它的返回结果继续。\n\
                 - 否则请重新调用 AskUserQuestion，给出两个选项并带上取值：接受本次迁移的选项 value 必须是 \
                 \"{proceed}\"，不迁移的选项 value 必须是 \"{abort}\"（文案随你写）。\n\
                 {direction}\n\n\
                 在迁移被解除阻断之前，禁止执行任何迁移副作用（写文件、构建、部署、删除）、禁止加载技能。",
                proceed = QT_MIGRATION_STRATEGY_PROCEED_VALUE,
                abort = QT_MIGRATION_STRATEGY_ABORT_VALUE,
            )),
            QtMigrationStrategyFollowUp::NotRecorded { .. } => Some(format!(
                "## 迁移策略未记录（系统约束，必须重新提问）\n\n\
                 刚才那次提问的答案带有运行时要求的取值，但会话里仍然没有记录下任何迁移策略，迁移保持阻断。\
                 请重新调用 AskUserQuestion 提问同一件事（接受的选项 value 用 \"{proceed}\"，\
                 不迁移的选项 value 用 \"{abort}\"），并等待用户作答。\n\
                 {direction}\n\n\
                 在策略被记录之前，禁止执行任何迁移副作用（写文件、构建、部署、删除）、禁止加载技能。",
                proceed = QT_MIGRATION_STRATEGY_PROCEED_VALUE,
                abort = QT_MIGRATION_STRATEGY_ABORT_VALUE,
            )),
            QtMigrationStrategyFollowUp::Decided { mismatch, strategy } => {
                let downgrade = matches!(
                    mismatch,
                    QtMigrationGenerationMismatch::ProjectNewer { .. }
                );
                let body = match strategy {
                    QtMigrationVersionStrategy::Downgrade { .. }
                    | QtMigrationVersionStrategy::Continue { .. } => {
                        if downgrade {
                            format!(
                                "用户已确认：原始工程是 Qt{project}，但本次迁移按工具链的 Qt{toolchain} 执行（工程降级到工具链这一代）。\
                                 后续所有迁移动作，包括使用 ohos-qt-skills 时，都必须按 Qt{toolchain} 处理，不得按工程原本的 Qt{project} 处理，也不要重新询问。"
                            )
                        } else {
                            format!(
                                "用户已确认：原始工程是 Qt{project}，工具链是 Qt{toolchain}，两者版本不一致但用户要求继续迁移。\
                                 按工具链的 Qt{toolchain} 执行，并在最终结论中说明这一版本差异。"
                            )
                        }
                    }
                    QtMigrationVersionStrategy::Abort { .. } => format!(
                        "用户已选择不迁移这个 Qt{project} 工程（工具链为 Qt{toolchain}）。\
                         本次任务到此结束：禁止执行任何迁移动作（写文件、构建、部署、删除），也不要改用其他工程继续，只需简短说明已按用户选择终止。"
                    ),
                    // `measured_generations` is `Some` only for measured states, so a
                    // decision always carries a wording; anything else is not ours.
                    QtMigrationVersionStrategy::NotNeeded
                    | QtMigrationVersionStrategy::Pending { .. } => return None,
                };
                Some(format!("## 迁移策略已确认（系统事实，必须遵守）\n\n{body}"))
            }
        }
    }

    /// Instruction returned after the model rebinds the toolchain the user typed.
    pub fn replaced_toolchain_fact(snapshot: &QtMigrationIntakeStateSnapshot) -> Option<String> {
        let replaced = snapshot.fields.get("toolchain")?.value.as_deref()?;
        let header = format!(
            "## 工具链已替换（系统事实，必须使用）\n\n\
             已把 `{replaced}` 绑定为本次迁移的 toolchain，替换掉之前选择的工具链。后续所有迁移动作都必须使用这个路径。"
        );
        match pending_generation_mismatch(snapshot) {
            None => Some(format!(
                "{header}\n\n新工具链与原始工程的 Qt 版本一致，迁移策略问题已经解除：\
                 不要再询问迁移策略，也不要再次调用 {QT_MIGRATION_PATHS_TEMPLATE_ID}，直接继续迁移流程。"
            )),
            Some(mismatch) => {
                let instruction = mismatch.strategy_instruction()?;
                Some(format!("{header}\n\n{instruction}"))
            }
        }
    }

    /// Map a resolved Qt template onto the port result, serializing the
    /// template-owned question shape into the opaque payload.
    fn resolved_template(
        resolved: bitfun_product_domains::qt_migration::ResolvedQuestionTemplate,
    ) -> ResolvedTemplate {
        ResolvedTemplate {
            questions: resolved.questions,
            presentation: resolved.presentation,
            template_version: resolved.template_version,
            payload: resolved
                .qt_migration_questions
                .map(|questions| serde_json::to_value(questions).unwrap_or(Value::Null)),
        }
    }
}

impl QuestionTemplateContribution for QtMigrationQuestionCard {
    fn template_id(&self) -> &'static str {
        QT_MIGRATION_PATHS_TEMPLATE_ID
    }

    fn template_version(&self) -> &'static str {
        QT_MIGRATION_PATHS_TEMPLATE_VERSION
    }

    fn state_slot(&self) -> DomainStateSlot {
        QT_MIGRATION_SLOT_INTAKE_STATE
    }

    // This template's payload predates the generic `templatePayload` envelope:
    // older surfaces only read `qtMigrationQuestions`, so the host keeps
    // projecting the payload there alongside the generic field.
    fn legacy_payload_wire_field(&self) -> Option<&'static str> {
        Some("qtMigrationQuestions")
    }

    fn render(&self, ctx: &TemplateContext<'_>) -> Result<ResolvedTemplate, TemplateRejection> {
        if ctx.template_id != QT_MIGRATION_PATHS_TEMPLATE_ID {
            return Err(TemplateRejection::new(format!(
                "Unknown AskUserQuestion template: {}",
                ctx.template_id
            )));
        }
        let migration_enabled = ctx
            .context_vars
            .get(QT_MIGRATION_ENABLED_CONTEXT_KEY)
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !migration_enabled {
            return Err(TemplateRejection::new(
                "qt-migration-paths is available only for a classified Qt to HarmonyOS migration request",
            ));
        }

        // Backend-owned candidate processing for Qt migration combines
        // model-provided paths with paths discovered from local resources.
        // The backend validates, deduplicates, sorts, and caps the final list.
        let mut candidates = ctx.candidates.clone();

        // Backend-owned seeding: prompt-resolved paths reach the option list
        // even when the model calls the template without echoing them in
        // `candidates`.
        if let Some(resolved) = ctx
            .context_vars
            .get(QT_MIGRATION_RESOLVED_PATHS_CONTEXT_KEY)
        {
            merge_prompt_resolved_paths(&mut candidates, resolved);
        }
        // The session probe results (the model's `qmake` / `qmake6` /
        // `qt-cmake` hits) arrive under their dedicated key and are consumed
        // directly at the lowest priority tier:
        // 输入 > 工作区 > 托管 > 已知安装根 > 会话探测.
        let session_probe_dirs = crate::scan::take_session_probe_dirs(&mut candidates);

        let mut question_context = QtMigrationQuestionContext::default();
        if let Some(workspace) = ctx.workspace_root {
            if !ctx.workspace_is_remote {
                // Pre-probe prompt-named candidate map (model echo + seeded
                // paths); the scan replaces `candidates` and the output merge
                // below re-ranks from this snapshot.
                let prompt_named = candidates.clone();
                // The host hands its managed-resource root when it owns one.
                // Without one there is nothing to scan: probe a path that
                // exists nowhere so the managed tiers find nothing instead of
                // silently reading the caller's working directory.
                let managed_root = ctx.managed_resources_root.unwrap_or_else(|| {
                    std::path::Path::new("__bitfun_managed_resources_unavailable__")
                });
                // One shared scan for the card and the provisioning tool.
                // `extra_known_install_roots` is the reserved
                // hook for user-configurable roots; the
                // well-known roots are resolved inside the scan.
                let probe = crate::scan::probe_qt_migration_candidates(
                    workspace,
                    managed_root,
                    &candidates,
                    &session_probe_dirs,
                    &[],
                );
                // The official toolchain installs one fixed Qt generation, so
                // it can only be offered when a project the card lists is
                // written against that generation — for a Qt6-only list the
                // download would install a kit the migration cannot build
                // with. Any listed project counts, not just the first: a Qt5
                // project listed behind a Qt6 default otherwise has no
                // toolchain at all when no Qt5 kit is installed. `None` means
                // the fact is unknown — no measured source project, or a build
                // without the provisioning capability (`qt-toolchain`), where
                // there is no official install path and the card keeps its
                // previous behavior.
                let official_toolchain_serves_project_generation = {
                    #[cfg(feature = "qt-toolchain")]
                    {
                        ctx.official_toolchain_qt_major.and_then(|qt_major| {
                            official_toolchain_serves_a_project(&probe.project_versions, qt_major)
                        })
                    }
                    #[cfg(not(feature = "qt-toolchain"))]
                    {
                        let _ = &probe.project_versions;
                        None
                    }
                };
                question_context = QtMigrationQuestionContext {
                    managed_toolchain_available: probe.managed_toolchain_available,
                    managed_template_available: probe.managed_template_available,
                    // Candidate path -> measured Qt major version, so the
                    // rendered option can tell Qt5 from Qt6.
                    toolchain_versions: probe
                        .toolchain_candidates
                        .iter()
                        .filter_map(|candidate| {
                            candidate
                                .qt_major
                                .map(|qt_major| (candidate.path.clone(), qt_major))
                        })
                        .collect(),
                    // Source projects are measured from their own code, so
                    // they carry their own version list (design §6/§7).
                    project_versions: probe.project_versions,
                    official_toolchain_serves_project_generation,
                };
                candidates = probe.candidates;

                // `None` entries mean the host could not list the workspace
                // (no services, or the listing failed): the merge is skipped
                // entirely instead of treating the workspace as empty.
                if let Some(entries) = ctx.workspace_dir_entries {
                    let workspace_outputs = entries
                        .iter()
                        .filter(|entry| {
                            entry.is_dir
                                && !entry.is_symlink
                                && crate::output::is_output_container_name(&entry.name)
                        })
                        .map(|entry| entry.path.clone())
                        .collect::<Vec<_>>();
                    let source_candidates = candidates
                        .get("source_project")
                        .cloned()
                        .unwrap_or_default();
                    let model_outputs = prompt_named
                        .get("output_project")
                        .cloned()
                        .unwrap_or_default();
                    let output_candidates = crate::output::merge_workspace_output_candidates(
                        workspace,
                        &model_outputs,
                        &source_candidates,
                        &workspace_outputs,
                    );
                    candidates.insert("output_project".to_string(), output_candidates);
                }
            }
        }

        let resolved =
            resolve_question_template_with_context(ctx.template_id, &candidates, question_context)
                .ok_or_else(|| {
                    TemplateRejection::new(format!(
                        "Unknown AskUserQuestion template: {}",
                        ctx.template_id
                    ))
                })?;
        Ok(Self::resolved_template(resolved))
    }

    fn render_replay(&self, arguments: &Value) -> Option<ResolvedTemplate> {
        let template_id = arguments.get("templateId").and_then(Value::as_str)?;
        if template_id != QT_MIGRATION_PATHS_TEMPLATE_ID {
            return None;
        }
        let candidates: HashMap<String, Vec<String>> = arguments
            .get("candidates")
            .and_then(|value| serde_json::from_value(value.clone()).ok())
            .unwrap_or_default();
        let resolved = resolve_question_template_full(template_id, &candidates)?;
        Some(Self::resolved_template(resolved))
    }

    fn validate_submission(
        &self,
        ctx: &SubmissionContext<'_>,
    ) -> Result<BTreeMap<String, String>, String> {
        // Required fields come from the waiting template's presentation policy;
        // fall back to the canonical minimum-input set defensively.
        let required_fields: Vec<&str> = ctx
            .required_fields
            .map(|fields| fields.iter().map(String::as_str).collect())
            .unwrap_or_else(|| QT_MIGRATION_INTAKE_REQUIRED_FIELDS.to_vec());

        let normalized = qt_migration_validate_answer_fields(&required_fields, ctx.answers)
            .map_err(|error| format!("Migration answers rejected: {error}"))?;

        // Path existence check (local workspaces only; remote skips this).
        if !ctx.workspace_is_remote {
            for (field, value) in &normalized {
                if value == QT_MIGRATION_OFFICIAL_VALUE {
                    continue;
                }
                if !std::path::Path::new(value).exists() {
                    // Stable machine-parseable code so the web card can render
                    // a localized message (code + field id + path).
                    return Err(format!(
                        "qt_migration_path_not_found: field={field}; path={value}"
                    ));
                }
                // A migrated product directory must never be bound as the
                // output target: re-migration would overwrite the previous
                // result. Same artifact criteria the output-candidate probe
                // excludes, so typed-in paths cannot bypass candidate
                // filtering. The card renders the stable code with recovery
                // copy (choose another output directory).
                if field == "output_project"
                    && crate::output::is_migration_output_artifact(std::path::Path::new(value))
                {
                    return Err(format!(
                        "qt_migration_output_is_artifact: field={field}; path={value}"
                    ));
                }
            }
        }
        Ok(normalized)
    }

    fn apply_answers(&self, current: Value, normalized: &BTreeMap<String, String>) -> Value {
        let snapshot = intake_snapshot_from_slot_value(Some(current));
        let updated = qt_migration_apply_validated_answers(&snapshot, normalized);
        intake_snapshot_to_slot_value(&updated)
    }

    fn on_answers(
        &self,
        template_id: Option<&str>,
        answers: &Value,
        state: &dyn DomainStateReader,
    ) -> Vec<ToolResultFact> {
        let snapshot = intake_snapshot_from_slot_value(state.get(&QT_MIGRATION_SLOT_INTAKE_STATE));
        Self::follow_up_instruction(template_id, answers, &snapshot)
            .map(|text| vec![ToolResultFact { text }])
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitfun_runtime_ports::TemplateDirEntry;
    use serde_json::json;
    use std::path::Path;
    use std::sync::Arc;

    fn card() -> Arc<dyn QuestionTemplateContribution> {
        Arc::new(QtMigrationQuestionCard)
    }

    /// Build a render context that owns its data. The borrowed
    /// `TemplateContext` points into it for the duration of the call.
    struct OwnedContext {
        raw: Value,
        candidates: HashMap<String, Vec<String>>,
        vars: HashMap<String, Value>,
        entries: Vec<TemplateDirEntry>,
    }

    fn owned_context(
        candidates: HashMap<String, Vec<String>>,
        vars: Vec<(&str, Value)>,
        entries: Vec<TemplateDirEntry>,
    ) -> OwnedContext {
        OwnedContext {
            raw: json!({ "templateId": QT_MIGRATION_PATHS_TEMPLATE_ID }),
            candidates,
            vars: vars
                .into_iter()
                .map(|(key, value)| (key.to_string(), value))
                .collect(),
            entries,
        }
    }

    fn render_ctx<'a>(owned: &'a OwnedContext) -> TemplateContext<'a> {
        TemplateContext {
            template_id: QT_MIGRATION_PATHS_TEMPLATE_ID,
            candidates: &owned.candidates,
            raw_input: &owned.raw,
            context_vars: &owned.vars,
            workspace_root: None,
            workspace_is_remote: false,
            workspace_dir_entries: Some(&owned.entries),
            managed_resources_root: None,
            official_toolchain_qt_major: None,
        }
    }

    #[test]
    fn render_rejects_calls_outside_a_classified_migration_request() {
        let owned = owned_context(HashMap::new(), vec![], Vec::new());
        let error = card()
            .render(&render_ctx(&owned))
            .expect_err("an unclassified request must not show the intake card");
        assert_eq!(
            error.message,
            "qt-migration-paths is available only for a classified Qt to HarmonyOS migration request"
        );
    }

    #[test]
    fn render_resolves_the_card_with_the_template_owned_payload() {
        let owned = owned_context(
            HashMap::new(),
            vec![(QT_MIGRATION_ENABLED_CONTEXT_KEY, Value::Bool(true))],
            Vec::new(),
        );
        let resolved = card()
            .render(&render_ctx(&owned))
            .expect("a classified request renders the card");
        assert_eq!(resolved.questions.len(), 4);
        assert_eq!(
            resolved.template_version,
            QT_MIGRATION_PATHS_TEMPLATE_VERSION
        );
        assert!(!resolved.presentation.allow_timeout);
        let payload = resolved.payload.expect("the Qt shape travels as payload");
        let questions = payload.as_array().expect("payload is the question list");
        assert_eq!(questions.len(), 4);
        assert_eq!(questions[0]["field"], "source_project");
    }

    #[test]
    fn render_seeds_prompt_resolved_paths_into_the_option_lists() {
        let owned = owned_context(
            HashMap::new(),
            vec![
                (QT_MIGRATION_ENABLED_CONTEXT_KEY, Value::Bool(true)),
                (
                    QT_MIGRATION_RESOLVED_PATHS_CONTEXT_KEY,
                    json!({ "source_project": "D:/work/myqt" }),
                ),
            ],
            Vec::new(),
        );
        let resolved = card()
            .render(&render_ctx(&owned))
            .expect("a classified request renders the card");
        let source = &resolved.questions[0];
        assert_eq!(source.options.len(), 1);
        assert_eq!(source.options[0].description, "D:/work/myqt");
    }

    #[test]
    fn render_merges_workspace_output_containers_only_when_the_host_could_list() {
        // Listed workspace: the output container becomes an output candidate.
        let entries = vec![TemplateDirEntry {
            name: "output-project".to_string(),
            path: "D:/work/proj/output-project".to_string(),
            is_dir: true,
            is_symlink: false,
        }];
        let owned = owned_context(
            HashMap::new(),
            vec![(QT_MIGRATION_ENABLED_CONTEXT_KEY, Value::Bool(true))],
            entries,
        );
        let ctx = TemplateContext {
            workspace_root: Some(Path::new("D:/work/proj")),
            ..render_ctx(&owned)
        };
        let resolved = card().render(&ctx).expect("render succeeds");
        let payload = resolved.payload.expect("payload present");
        let output = payload
            .as_array()
            .unwrap()
            .iter()
            .find(|question| question["field"] == "output_project")
            .expect("output question present");
        // `ohos-build` is an output container name the domain owns; the merge
        // must reach the rendered options as a path, not a container keyword.
        assert!(
            serde_json::to_string(&output["options"])
                .unwrap()
                .contains("output-project"),
            "workspace output containers must reach the option list: {output}"
        );

        // Unlisted workspace (`None`): no output-discovery merge runs, so the
        // card keeps exactly the probe-only result (here the probe's
        // workspace-root fallback) instead of inventing container candidates.
        let owned = owned_context(
            HashMap::new(),
            vec![(QT_MIGRATION_ENABLED_CONTEXT_KEY, Value::Bool(true))],
            Vec::new(),
        );
        let ctx = TemplateContext {
            workspace_root: Some(Path::new("D:/work/proj")),
            workspace_dir_entries: None,
            ..render_ctx(&owned)
        };
        let resolved = card().render(&ctx).expect("render succeeds");
        let payload = resolved.payload.expect("payload present");
        let output = payload
            .as_array()
            .unwrap()
            .iter()
            .find(|question| question["field"] == "output_project")
            .expect("output question present");
        let output_options = output["options"].as_array().expect("options list");
        assert!(
            output_options
                .iter()
                .all(|option| option["path"] == "D:/work/proj"),
            "unlisted workspace falls back to the probe-only output result: {output_options:?}"
        );
    }

    #[test]
    fn render_replay_rebuilds_the_card_from_persisted_arguments() {
        let replayed = card()
            .render_replay(&json!({
                "templateId": QT_MIGRATION_PATHS_TEMPLATE_ID,
                "candidates": { "source_project": ["D:/work/myqt"] },
            }))
            .expect("the intake card rebuilds from persisted arguments");
        assert_eq!(replayed.questions.len(), 4);
        assert_eq!(
            replayed.template_version,
            QT_MIGRATION_PATHS_TEMPLATE_VERSION
        );
        let source = &replayed.questions[0];
        assert_eq!(source.options[0].description, "D:/work/myqt");

        assert!(
            card().render_replay(&json!({ "candidates": {} })).is_none(),
            "plain arguments are not this template's call"
        );
        assert!(
            card()
                .render_replay(&json!({ "templateId": "other-template" }))
                .is_none(),
            "other template ids are not this template's call"
        );
    }

    #[test]
    fn validate_submission_rejects_missing_required_fields_with_the_reject_prefix() {
        let required = ["source_project".to_string(), "output_project".to_string()];
        let ctx = SubmissionContext {
            required_fields: Some(&required),
            answers: &json!({ "source_project": "D:/work/myqt" }),
            workspace_is_remote: true,
        };
        let error = card()
            .validate_submission(&ctx)
            .expect_err("missing required fields must reject");
        assert!(error.starts_with("Migration answers rejected: "), "{error}");
        assert!(
            error.contains("missing required answer for field"),
            "{error}"
        );
    }

    #[test]
    fn validate_submission_checks_local_paths_and_skips_the_official_value() {
        let workspace = tempfile::tempdir().expect("workspace tempdir");
        let project = workspace.path().join("myqt");
        std::fs::create_dir(&project).expect("project dir");
        let source_required = ["source_project".to_string()];

        // Remote workspace: no local existence check.
        let ctx = SubmissionContext {
            required_fields: Some(&source_required),
            answers: &json!({ "source_project": "D:/definitely/missing" }),
            workspace_is_remote: true,
        };
        card()
            .validate_submission(&ctx)
            .expect("remote workspaces skip the existence check");

        // Local workspace: a missing path rejects with the stable code.
        let ctx = SubmissionContext {
            required_fields: Some(&source_required),
            answers: &json!({ "source_project": "D:/definitely/missing" }),
            workspace_is_remote: false,
        };
        let error = card()
            .validate_submission(&ctx)
            .expect_err("a missing local path must reject");
        assert_eq!(
            error,
            "qt_migration_path_not_found: field=source_project; path=D:/definitely/missing"
        );

        // The official value is a request, not a path: it skips the check.
        let toolchain_required = ["toolchain".to_string()];
        let ctx = SubmissionContext {
            required_fields: Some(&toolchain_required),
            answers: &json!({ "toolchain": QT_MIGRATION_OFFICIAL_VALUE }),
            workspace_is_remote: false,
        };
        card()
            .validate_submission(&ctx)
            .expect("__official__ is not a path");
    }

    #[test]
    fn validate_submission_rejects_a_migrated_artifact_as_output_target() {
        let workspace = tempfile::tempdir().expect("workspace tempdir");
        // A previous migration product: any path inside an output container.
        let output = workspace.path().join("output-project").join("my-ohos-app");
        std::fs::create_dir_all(&output).expect("migrated artifact layout");
        let output_required = ["output_project".to_string()];
        let ctx = SubmissionContext {
            required_fields: Some(&output_required),
            answers: &json!({ "output_project": output.to_string_lossy() }),
            workspace_is_remote: false,
        };
        let error = card()
            .validate_submission(&ctx)
            .expect_err("a migrated artifact must not become the output target");
        assert!(
            error.starts_with("qt_migration_output_is_artifact: field=output_project; path="),
            "{error}"
        );
    }

    #[test]
    fn apply_answers_binds_fields_and_derives_the_status() {
        let current = intake_snapshot_to_slot_value(&QtMigrationIntakeStateSnapshot::empty());
        let normalized: BTreeMap<String, String> = [
            ("source_project", "D:/work/myqt"),
            ("output_project", "D:/work/ohos"),
            ("toolchain", "D:/ohos/qt5"),
            ("template", "D:/ohos/template"),
        ]
        .into_iter()
        .map(|(field, value)| (field.to_string(), value.to_string()))
        .collect();
        let updated = card().apply_answers(current, &normalized);
        let snapshot = intake_snapshot_from_slot_value(Some(updated));
        assert_eq!(
            snapshot.fields["source_project"].value.as_deref(),
            Some("D:/work/myqt")
        );
        assert!(
            matches!(
                crate::state::qt_migration_derive_intake_status(&snapshot),
                crate::state::QtMigrationIntakeStatus::SkillRequired,
            ),
            "all fields bound and no receipt derives SkillRequired"
        );
    }

    #[test]
    fn on_answers_states_the_installed_toolchain_for_an_official_binding() {
        let mut snapshot = QtMigrationIntakeStateSnapshot::empty();
        snapshot.version_strategy = crate::state::QtMigrationVersionStrategy::NotNeeded;
        let mut toolchain = snapshot
            .fields
            .get_mut("toolchain")
            .expect("the snapshot pre-seeds its fields");
        toolchain.value = Some("D:/installed/qt5-kit".to_string());
        toolchain.state = crate::state::QtMigrationFieldResolutionState::Resolved;
        drop(toolchain);

        #[derive(Debug)]
        struct SnapshotReader(QtMigrationIntakeStateSnapshot);
        impl DomainStateReader for SnapshotReader {
            fn get(&self, slot: &DomainStateSlot) -> Option<Value> {
                assert_eq!(slot.namespace, QT_MIGRATION_SLOT_INTAKE_STATE.namespace);
                Some(intake_snapshot_to_slot_value(&self.0))
            }
        }

        let facts = card().on_answers(
            Some(QT_MIGRATION_PATHS_TEMPLATE_ID),
            &json!({ "toolchain": QT_MIGRATION_OFFICIAL_VALUE }),
            &SnapshotReader(snapshot),
        );
        assert_eq!(facts.len(), 1, "{facts:?}");
        assert!(
            facts[0].text.contains("D:/installed/qt5-kit"),
            "the fact must name the installed kit path: {}",
            facts[0].text
        );
    }

    #[test]
    fn on_answers_carries_the_strategy_reask_for_a_plain_question_with_pending_mismatch() {
        let mut snapshot = QtMigrationIntakeStateSnapshot::empty();
        snapshot.version_strategy = crate::state::QtMigrationVersionStrategy::Pending {
            project: 6,
            toolchain: 5,
        };

        #[derive(Debug)]
        struct SnapshotReader(QtMigrationIntakeStateSnapshot);
        impl DomainStateReader for SnapshotReader {
            fn get(&self, _slot: &DomainStateSlot) -> Option<Value> {
                Some(intake_snapshot_to_slot_value(&self.0))
            }
        }

        // A plain question (no template id) answered without the contract
        // values: the model must ask again.
        let facts = card().on_answers(None, &json!({ "answer": "好" }), &SnapshotReader(snapshot));
        assert_eq!(facts.len(), 1, "{facts:?}");
        assert!(
            facts[0].text.contains(QT_MIGRATION_STRATEGY_PROCEED_VALUE),
            "the re-ask instruction must carry the contract values: {}",
            facts[0].text
        );

        // No pending mismatch: a plain question gets no Qt note.
        let facts = card().on_answers(
            None,
            &json!({ "answer": "好" }),
            &SnapshotReader(QtMigrationIntakeStateSnapshot::empty()),
        );
        assert!(facts.is_empty(), "{facts:?}");
    }
}
