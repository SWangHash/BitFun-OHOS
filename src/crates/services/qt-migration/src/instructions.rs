//! Qt migration turn instructions: the per-turn activation message, the
//! input-collection confirmation instruction, the skill gate, the `__official__`
//! binding guidance, and the bound-inputs snapshot instruction.
//!
//! All Qt instruction text lives here so the host engine holds no domain
//! constants. The contribution reads this turn's analyzer facts from the host
//! context stash and the session intake snapshot through `DomainStateReader`.

use std::borrow::Cow;

use bitfun_runtime_ports::{
    DomainStateSlot, TurnInstructionContext, TurnInstructionContribution, TurnInstructionTexts,
};
use serde_json::Value;

use super::admission::{
    QT_MIGRATION_SLOT_INTAKE_STATE, QT_MIGRATION_SLOT_SKILL_DIR, QT_MIGRATION_SLOT_TEMPLATES_DIR,
    QT_MIGRATION_SLOT_TOOLCHAINS_DIR,
};
use crate::state::{QtMigrationIntakeStateSnapshot, QT_MIGRATION_OFFICIAL_VALUE};

/// Agent type that routes turns through the Qt migration flow.
pub const QT_MIGRATION_AGENT_TYPE: &str = "QtMigration";

/// Host context-stash key holding `"true"`/`"false"`: whether the semantic
/// analyzer classified this turn's prompt as an app-migration task. Written by
/// the host engine before contributions run; read-only here.
pub const CTX_QT_MIGRATION_ENABLED: &str = "qt_migration_enabled";
/// Host context-stash key holding the analyzer's `resolvedPaths` JSON. The
/// AskUserQuestion backend also consumes it; documented here because both
/// sides share the key name.
pub const CTX_QT_MIGRATION_RESOLVED_PATHS: &str = "qt_migration_resolved_paths";
/// Host context-stash key holding this turn's instruction facts JSON:
/// `{"missing_or_referenced": bool, "pending_fields": String,
/// "unclassified_paths": [String]}`. The JSON is computed by
/// `semantic::instruction_facts` in this crate; the engine only runs the
/// binding outcome through it and stashes the result here.
pub const CTX_QT_MIGRATION_INSTRUCTION_FACTS: &str = "qt_migration_instruction_facts";

/// QtMigration intake gate: only requests classified as `app_migration` by the
/// full analyzer receive migration input and skill constraints.
pub const CONFIRM_INSTRUCTION: &str = r#"## 迁移前置输入（系统约束，必须立即执行）

用户请求已分类为 Qt → HarmonyOS 应用迁移任务。在四项最小输入（source_project、output_project、toolchain、template）全部达到 Validated 之前，禁止执行任何迁移副作用（写文件、构建、部署、删除），禁止加载技能、禁止做任何其它事情。

你的下一步必须且只能按以下顺序执行：

1. 调用 ExecCommand 工具执行 `command -v qmake`。这是四项输入绑定前唯一允许的 shell 命令，用于解析用户配置在环境变量中的工具链。
2. 立即调用 AskUserQuestion 工具，参数传入 {"templateId": "qt-migration-paths", "candidates": {...}}，并按以下规则填充 candidates：
   - 第 1 步命中路径时，取其父目录放入 `candidates.toolchain_env`（专用字段——环境变量命中的工具链优先级最低，后端会排在输入/工作区/托管候选之后；不要放入 `candidates.toolchain`）。未命中则不传该字段（卡片会显示输入框）。
   - 用户当前指定或明确指代的 Qt 工程：其工程目录或 `.pro` 文件路径放入 `candidates.source_project`，且置于数组第一项（Qt 工程判定标准见 ohos-qt-skills 阶段零预检：qmake `.pro` 工程，或含 `find_package(Qt…)` 的 CMakeLists.txt 工程）。用户在 prompt 中明确写出的其他路径（输出目录、模板工程）也必须分别放入对应的 `candidates.output_project` / `candidates.template`；这些路径即使位于当前工作区之外，也必须原样放入候选，不得丢弃或替换。
   - 其他已探测候选也应按字段传入。不得只在分析文字中描述候选而省略 `candidates`。不要自行构造 questions，不要在工具调用前后输出说明文字，也不能用纯文本提示代替工具调用。

除上述第 1 步外，四项输入绑定前禁止执行任何其他 shell 命令。调用 AskUserQuestion 后等待用户提交答案；答案返回的四项绑定值就是本次迁移的唯一输入事实，必须直接采用，不得重新询问或替换为其他路径。"#;

/// Engine-level constraint ensuring Qt migration work always uses the
/// `ohos-qt-skills` knowledge base. Gate semantics only: which skill must load
/// and that side effects are forbidden before the skill is loaded - not a copy
/// of the skill's domain flow.
pub const SKILL_GATE_INSTRUCTION: &str = r#"## 必用技能（系统约束，必须遵守）

这是一个 Qt → HarmonyOS(OpenHarmony) 迁移任务。在每个新的迁移任务开始前（包括同一会话中迁移另一个 Qt 工程），你**必须**先调用 Skill 工具加载技能 ohos-qt-skills，并遵循该技能当前版本的流程（以其 _index/_task-routing 与 procedural 页面为准）。上一次迁移任务中已经加载过的技能不满足本次任务的要求。

技能未加载、技能不可用或加载失败时，禁止产生任何迁移副作用。领域流程细节本系统不重复提供，一律以 ohos-qt-skills 当前版本为唯一事实源。"#;

/// Host platform value expected by the skill's download scripts
/// (`--platform=<macos|windows|linux|harmonyos>`).
///
/// Layout platform token used by the Qt migration knowledge-base download scripts
/// and by the runtime toolchain provisioner, so both name the same target.
pub fn download_platform() -> &'static str {
    if cfg!(target_env = "ohos") {
        "harmonyos"
    } else {
        match std::env::consts::OS {
            "macos" => "macos",
            "linux" => "linux",
            _ => "windows",
        }
    }
}

/// Per-turn activation message stating whether this turn runs the Qt →
/// HarmonyOS migration flow. Inserted for every `QtMigration` turn with a
/// non-empty prompt, migration-classified or not.
pub fn activation_message(is_migration: bool) -> String {
    format!(
        "当前轮是否启用 Qt 到鸿蒙迁移流程：{}。{}",
        if is_migration { "是" } else { "否" },
        if is_migration {
            "只有此状态为“是”时，才执行迁移专属输入收集、技能加载和迁移操作。"
        } else {
            "当前请求按普通 Agentic 请求处理，不要加载 ohos-qt-skills，不要调用 qt-migration-paths，也不要执行迁移专属输入收集。"
        }
    )
}

/// Guidance for an `__official__` **toolchain** binding.
///
/// The runtime, not the model, owns the install (provisioning plan D5): the kit is
/// downloaded when the binding is submitted. This paragraph is therefore rendered
/// **only while the binding is still `__official__`** — after a successful install the
/// field carries the installed kit path
/// (`qt_toolchain_provisioning::resolve_bound_toolchain_field`) and there is nothing
/// left to explain. The state that still needs it is a runtime that could not install
/// the kit, where the BitFun acquisition script stays the documented backstop.
pub fn official_toolchain_guidance(
    toolchains_dir: &str,
    skill_dir: &str,
    platform: &str,
) -> String {
    format!(
        "- 工具链绑定值仍是 __official__，说明运行时还没有把工具链装好。工具链由运行时负责安装到 `{toolchains_dir}`（Qt 5.12.12，平台 `{platform}`），**不要**运行任何工具链下载脚本，也不要再做存在性探索或检查。备份路径：若运行时供给失败（绑定仍为 __official__ 且 `{toolchains_dir}` 下没有任何可用工具链），才回退到 BitFun 供给脚本 `bash \"{skill_dir}/scripts/bitfun-download-qt-sdk.sh\" --platform={platform}`（Bash 工具已注入 BITFUN_QT_MIGRATION_ROOT，脚本据此安装到 `{toolchains_dir}` 下，不要用 --dest 改到其他位置，也不要改用技能基线里 vendored 的上游 download-qt-sdk.sh），安装完成后使用脚本输出的 QT5_12_OHOS_SDK。\n"
    )
}

/// Guidance for an `__official__` **template** binding: there is no template
/// provisioner, so the BitFun acquisition script stays the install flow.
pub fn official_template_guidance(templates_dir: &str, skill_dir: &str, platform: &str) -> String {
    format!(
        "- 模板：运行时尚未提供模板供给，仍需按 BitFun 供给脚本安装：`bash \"{skill_dir}/scripts/bitfun-download-template.sh\" --platform={platform}`，安装目标目录 `{templates_dir}`（脚本按 BITFUN_QT_MIGRATION_ROOT 落盘，不要用 --dest 改到其他位置，也不要改用技能基线里 vendored 的上游 download-template.sh：它要求显式 --dest，会装到迁移扫描不到的目录），安装完成后使用脚本输出的 OHOS_TEMPLATE_SRC，该路径也必须是后续迁移使用的模板源（OHOS_TEMPLATE_SRC）。\n"
    )
}

/// Guidance for the `__official__` bindings that still need it, one paragraph per
/// field.
///
/// Each paragraph appears only for the field whose value **is still** `__official__`:
/// the card offers that value when fewer than two candidates were found, the runtime
/// installs the toolchain at submit time, and a field that carries a real path has
/// nothing left to explain. `None` when neither field is official, so a fully resolved
/// migration carries no download semantics at all.
pub fn official_input_guidance(
    toolchains_dir: &str,
    templates_dir: &str,
    skill_dir: &str,
    platform: &str,
    toolchain_official: bool,
    template_official: bool,
) -> Option<String> {
    if !toolchain_official && !template_official {
        return None;
    }
    let mut text = String::from(
        "### __official__ 绑定的执行方式\n\n绑定值为 __official__ 时表示使用鸿蒙OS官方推荐版本。绑定值即最终输入事实：不要因为本机还存在其它候选就改用它们，也不要在四项输入之外重新探测路径。\n",
    );
    if toolchain_official {
        text.push_str(&official_toolchain_guidance(
            toolchains_dir,
            skill_dir,
            platform,
        ));
    }
    if template_official {
        text.push_str(&official_template_guidance(
            templates_dir,
            skill_dir,
            platform,
        ));
    }
    Some(text)
}

/// Skill-gate instruction plus the `__official__` guidance for the bindings that still
/// need it.
pub fn skill_gate_instruction(
    toolchains_dir: &str,
    templates_dir: &str,
    skill_dir: &str,
    platform: &str,
    toolchain_official: bool,
    template_official: bool,
) -> String {
    match official_input_guidance(
        toolchains_dir,
        templates_dir,
        skill_dir,
        platform,
        toolchain_official,
        template_official,
    ) {
        Some(guidance) => format!("{}\n\n{}", SKILL_GATE_INSTRUCTION, guidance),
        None => SKILL_GATE_INSTRUCTION.to_string(),
    }
}

/// Snapshot instruction listing the four bound inputs once all of them are
/// resolved. Returns `None` while any field is still unresolved.
pub fn bound_inputs_instruction(
    snapshot: &QtMigrationIntakeStateSnapshot,
    toolchains_dir: &str,
    templates_dir: &str,
    skill_dir: &str,
    platform: &str,
) -> Option<String> {
    use crate::state::{QtMigrationFieldResolutionState, QtMigrationVersionStrategy};

    let mut values = std::collections::BTreeMap::new();
    for field in crate::state::QT_MIGRATION_INTAKE_REQUIRED_FIELDS {
        let state = snapshot.fields.get(field)?;
        if state.state != QtMigrationFieldResolutionState::Resolved {
            return None;
        }
        values.insert(field, state.value.as_deref()?);
    }

    let mut text = String::from(
        "## 迁移绑定输入（系统事实，必须使用）\n\n用户已通过问题卡片确认本次迁移的四项最小输入。迁移操作必须使用以下绑定值，不得替换为其他路径，不得重新询问：\n",
    );
    for field in crate::state::QT_MIGRATION_INTAKE_REQUIRED_FIELDS {
        let value = values[field];
        if value == QT_MIGRATION_OFFICIAL_VALUE {
            text.push_str(&format!(
                "- {field}：__official__（使用鸿蒙OS官方推荐版本，执行方式见下方）\n"
            ));
        } else {
            text.push_str(&format!("- {field}：{value}\n"));
        }
    }
    let toolchain_official = values["toolchain"] == QT_MIGRATION_OFFICIAL_VALUE;
    let template_official = values["template"] == QT_MIGRATION_OFFICIAL_VALUE;
    // A field the runtime already resolved (the installed kit root) is a plain path
    // here: the download semantics belong to the fields that are still `__official__`.
    if let Some(guidance) = official_input_guidance(
        toolchains_dir,
        templates_dir,
        skill_dir,
        platform,
        toolchain_official,
        template_official,
    ) {
        text.push_str("\n\n");
        text.push_str(&guidance);
    }
    // Generation strategy: a project and a toolchain of different Qt generations only
    // migrate on the user's decision, and that decision is what every later step —
    // including the knowledge base (ohos-qt-skills) — has to follow. It is stated on
    // every turn the migration runs, not only on the answer that produced it, so a
    // restarted or resumed session cannot drift back to the project's own generation.
    match snapshot.version_strategy {
        QtMigrationVersionStrategy::Pending { project, toolchain } => text.push_str(&format!(
            "\n\n### 版本策略待用户确认（系统约束）\n\n\
             原始工程是 Qt{project}，绑定的工具链是 Qt{toolchain}，两者代不一致。\
             在用户通过版本策略问题作出选择之前，禁止执行任何迁移副作用（写文件、构建、部署、删除），\
             也禁止按其中任何一代开始迁移；迁移的唯一入口是用户对那个问题的作答。"
        )),
        QtMigrationVersionStrategy::Downgrade { project, toolchain } => text.push_str(&format!(
            "\n\n### 本次迁移的版本策略：用户已确认降级\n\n\
             原始工程按 Qt{project} 写就，用户已确认**降级到工具链的 Qt{toolchain}** 迁移。\
             迁移（包括使用 ohos-qt-skills 时的流程与参数）必须按 Qt{toolchain} 处理，\
             不得按工程原本的 Qt{project} 处理，也不要重新询问用户。"
        )),
        QtMigrationVersionStrategy::Continue { project, toolchain } => text.push_str(&format!(
            "\n\n### 本次迁移的版本策略：用户已确认继续\n\n\
             原始工程是 Qt{project}，工具链是 Qt{toolchain}，用户已知版本不一致并确认继续迁移。\
             按工具链的 Qt{toolchain} 执行，并在交付结论中明确说明这一版本差异。"
        )),
        QtMigrationVersionStrategy::Abort { project, toolchain } => text.push_str(&format!(
            "\n\n### 本次迁移已按用户选择终止（系统约束）\n\n\
             用户已选择不迁移这个 Qt{project} 工程（工具链为 Qt{toolchain}）。\
             禁止执行任何迁移动作，也不要改用其他工程继续；如需迁移请由用户重新发起。"
        )),
        QtMigrationVersionStrategy::NotNeeded => {}
    }
    Some(text)
}

/// Turn-instruction contribution for `QtMigration` turns.
///
/// `is_active` keeps the agent_type-driven determination exactly as relocated
/// from the engine (unifying it with the intake-driven admission gate is a
/// separately confirmed behavior change).
#[derive(Debug, Default)]
pub struct QtMigrationTurnInstructions;

impl QtMigrationTurnInstructions {
    /// Session intake snapshot as remembered by the host (post-binding).
    fn intake(context: &TurnInstructionContext<'_>) -> QtMigrationIntakeStateSnapshot {
        context
            .state
            .get(&QT_MIGRATION_SLOT_INTAKE_STATE)
            .and_then(|value| serde_json::from_value::<QtMigrationIntakeStateSnapshot>(value).ok())
            .unwrap_or_else(QtMigrationIntakeStateSnapshot::empty)
    }

    fn slot_string(context: &TurnInstructionContext<'_>, slot: &DomainStateSlot) -> String {
        context
            .state
            .get(slot)
            .and_then(|value| value.as_str().map(str::to_string))
            .unwrap_or_default()
    }

    /// Facts stash with historical-behavior fallbacks for absent fields;
    /// production always writes the full object.
    fn facts(context: &TurnInstructionContext<'_>) -> Value {
        context
            .context_vars
            .get(CTX_QT_MIGRATION_INSTRUCTION_FACTS)
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
            .unwrap_or_else(|| {
                serde_json::json!({
                    "missing_or_referenced": false,
                    "pending_fields": "",
                    "unclassified_paths": []
                })
            })
    }

    /// The migration body: CONFIRM (inputs pending) or bound-inputs snapshot,
    /// always followed by the skill gate. `None` when this turn is not a
    /// migration turn.
    fn body(&self, context: &TurnInstructionContext<'_>) -> Option<String> {
        let enabled = context
            .context_vars
            .get(CTX_QT_MIGRATION_ENABLED)
            .map(|value| value == "true")
            .unwrap_or(false);
        if !enabled {
            return None;
        }
        let facts = Self::facts(context);
        let missing_or_referenced = facts
            .get("missing_or_referenced")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let toolchains_dir = Self::slot_string(context, &QT_MIGRATION_SLOT_TOOLCHAINS_DIR);
        let templates_dir = Self::slot_string(context, &QT_MIGRATION_SLOT_TEMPLATES_DIR);
        // The managed skill bundle owns the BitFun acquisition scripts, so the
        // `__official__` guidance names them absolutely. A host that does not
        // resolve the slot keeps the skill-relative placeholder the bundle's own
        // documents use.
        let skill_dir: String = match Self::slot_string(context, &QT_MIGRATION_SLOT_SKILL_DIR) {
            dir if dir.trim().is_empty() => "<skill>".to_string(),
            dir => dir,
        };
        let platform = download_platform();
        let intake = Self::intake(context);
        let mut instruction = String::new();
        if missing_or_referenced {
            let pending_fields = facts
                .get("pending_fields")
                .and_then(Value::as_str)
                .unwrap_or_default();
            instruction.push_str(CONFIRM_INSTRUCTION);
            instruction.push_str(&format!(
                "\n\n当前缺少或仅有引用而未提供具体路径/ID 的输入项：{}。\n",
                pending_fields
            ));
            let unclassified = facts
                .get("unclassified_paths")
                .and_then(Value::as_array)
                .map(|paths| {
                    paths
                        .iter()
                        .filter_map(|value| value.as_str())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if !unclassified.is_empty() {
                instruction.push_str(&format!(
                    "\n\n以下路径出现在用户 prompt 中但未能自动归类，请结合语义分别放入对应的 candidates 字段（通常第一个为源工程路径）：{}。\n",
                    unclassified.join("、")
                ));
            }
            instruction.push_str("\n\n输入收集完成后，迁移工作必须遵守下面的必用技能约束：\n");
        } else if let Some(bound_inputs) =
            bound_inputs_instruction(&intake, &toolchains_dir, &templates_dir, &skill_dir, platform)
        {
            instruction.push_str(&bound_inputs);
            instruction.push_str("\n\n迁移工作必须遵守下面的必用技能约束：\n");
        }
        // The `__official__` download semantics follow the *current* bindings:
        // once the runtime installed the toolchain, the field holds the kit
        // path and there is nothing left to instruct.
        let still_official = |field: &str| {
            intake
                .fields
                .get(field)
                .and_then(|state| state.value.as_deref())
                == Some(QT_MIGRATION_OFFICIAL_VALUE)
        };
        instruction.push_str(&skill_gate_instruction(
            &toolchains_dir,
            &templates_dir,
            &skill_dir,
            platform,
            still_official("toolchain"),
            still_official("template"),
        ));
        Some(instruction)
    }
}

impl TurnInstructionContribution for QtMigrationTurnInstructions {
    fn namespace(&self) -> &'static str {
        "qt_migration"
    }

    fn is_active(&self, context: &TurnInstructionContext<'_>) -> bool {
        context.agent_type == QT_MIGRATION_AGENT_TYPE
            && !context.original_user_input.trim().is_empty()
    }

    fn turn_instructions(&self, context: &TurnInstructionContext<'_>) -> TurnInstructionTexts {
        let enabled = context
            .context_vars
            .get(CTX_QT_MIGRATION_ENABLED)
            .map(|value| value == "true")
            .unwrap_or(false);
        TurnInstructionTexts {
            activation: Some(Cow::Owned(activation_message(enabled))),
            body: self.body(context).map(Cow::Owned),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{
        QtMigrationFieldResolutionState, QtMigrationIntakeFieldState, QtMigrationIntakeStatus,
        QtMigrationVersionStrategy, QT_MIGRATION_SKILL_DIR,
    };
    use bitfun_runtime_ports::DomainStateReader;
    use std::collections::BTreeMap;

    #[test]
    fn download_platform_matches_host_family() {
        if cfg!(target_env = "ohos") {
            assert_eq!(download_platform(), "harmonyos");
        } else {
            assert!(matches!(download_platform(), "windows" | "macos" | "linux"));
        }
    }

    #[test]
    fn activation_message_switches_on_classification() {
        assert!(activation_message(true).contains("是"));
        assert!(activation_message(false).contains("否"));
        assert!(
            activation_message(false).contains("不要加载 ohos-qt-skills"),
            "non-migration turn must forbid the migration skill"
        );
    }

    /// Installed path of the managed skill bundle, which owns the BitFun
    /// acquisition scripts the `__official__` guidance hands to the model.
    const SKILL_DIR: &str = "/root/skills/.system/ohos-qt-skills";

    fn bound_snapshot(toolchain: &str, template: &str) -> QtMigrationIntakeStateSnapshot {
        let mut snapshot = QtMigrationIntakeStateSnapshot::empty();
        for field in crate::state::QT_MIGRATION_INTAKE_REQUIRED_FIELDS {
            let value = match field {
                "source_project" => "D:/work/myqt",
                "output_project" => "D:/out/hm",
                "toolchain" => toolchain,
                _ => template,
            };
            snapshot.fields.insert(
                field.to_string(),
                QtMigrationIntakeFieldState {
                    state: QtMigrationFieldResolutionState::Resolved,
                    value: Some(value.to_string()),
                },
            );
        }
        snapshot.status = QtMigrationIntakeStatus::Ready;
        snapshot
    }

    /// A bound snapshot carrying a decided generation strategy for the tests that
    /// check the downgrade/continue/abort facts the engine states to the model.
    fn bound_snapshot_with_strategy(
        toolchain: &str,
        template: &str,
        strategy: QtMigrationVersionStrategy,
    ) -> QtMigrationIntakeStateSnapshot {
        let mut snapshot = bound_snapshot(toolchain, template);
        snapshot = crate::state::qt_migration_set_version_strategy(&snapshot, strategy);
        snapshot
    }

    #[test]
    fn bound_inputs_instruction_states_the_decided_generation_strategy() {
        // 代不一致的迁移只在用户决策后运行，而且后续每一轮（含使用 ohos-qt-skills 时）都必须
        // 按这个决策走；因此绑定输入指令要带上策略事实，而不是只靠提问那一轮的上下文。
        let cases = [
            (
                QtMigrationVersionStrategy::Downgrade {
                    project: 6,
                    toolchain: 5,
                },
                ["用户已确认降级", "降级到工具链的 Qt5", "Qt6"],
            ),
            (
                QtMigrationVersionStrategy::Continue {
                    project: 5,
                    toolchain: 6,
                },
                ["用户已确认继续", "按工具链的 Qt6 执行", "Qt5"],
            ),
            (
                QtMigrationVersionStrategy::Abort {
                    project: 6,
                    toolchain: 5,
                },
                ["已按用户选择终止", "禁止执行任何迁移动作", "Qt6"],
            ),
            (
                QtMigrationVersionStrategy::Pending {
                    project: 6,
                    toolchain: 5,
                },
                ["版本策略待用户确认", "禁止执行任何迁移副作用", "Qt6"],
            ),
        ];

        for (strategy, expected) in cases {
            let snapshot =
                bound_snapshot_with_strategy("/root/toolchains/qt5.12.12", "D:/tpl", strategy);
            let text = bound_inputs_instruction(
                &snapshot,
                "/root/toolchains",
                "/root/templates",
                SKILL_DIR,
                "harmonyos",
            )
            .expect("all resolved");

            for needle in expected {
                assert!(
                    text.contains(needle),
                    "{strategy:?} 的绑定指令缺少 {needle}"
                );
            }
        }
    }

    #[test]
    fn bound_inputs_instruction_has_no_strategy_block_when_generations_agree() {
        let snapshot = bound_snapshot_with_strategy(
            "/root/toolchains/qt5.12.12",
            "D:/tpl",
            QtMigrationVersionStrategy::NotNeeded,
        );
        let text = bound_inputs_instruction(
            &snapshot,
            "/root/toolchains",
            "/root/templates",
            SKILL_DIR,
            "harmonyos",
        )
        .expect("all resolved");

        assert!(!text.contains("版本策略"));
        assert!(!text.contains("用户已确认"));
    }

    #[test]
    fn bound_inputs_instruction_guides_only_the_still_official_toolchain() {
        // 工具链没装好（绑定仍是 __official__）才讲工具链的安装语义；模板不是 official 时
        // 不能再把模板脚本一起塞进来。
        let snapshot = bound_snapshot(QT_MIGRATION_OFFICIAL_VALUE, "D:/tpl");
        let text = bound_inputs_instruction(
            &snapshot,
            "/root/toolchains",
            "/root/templates",
            SKILL_DIR,
            "harmonyos",
        )
        .expect("all resolved");

        assert!(text.contains("source_project：D:/work/myqt"));
        assert!(text.contains("output_project：D:/out/hm"));
        assert!(text.contains("toolchain：__official__"));
        assert!(text.contains("template：D:/tpl"));
        // official 语义：工具链由运行时安装（不让模型跑下载脚本），BitFun 供给脚本只作为
        // 供给失败时的备份，并且必须按技能目录的绝对路径与 --platform 调用。
        assert!(text.contains("也不要再做存在性探索或检查"));
        assert!(text.contains("工具链由运行时负责安装"));
        assert!(text.contains("备份路径"));
        assert!(text.contains(&format!(
            "bash \"{SKILL_DIR}/scripts/bitfun-download-qt-sdk.sh\" --platform=harmonyos"
        )));
        assert!(text.contains("/root/toolchains"));
        assert!(text.contains("BITFUN_QT_MIGRATION_ROOT"));
        assert!(
            !text.contains("bitfun-download-template.sh"),
            "模板不是 official，不得出现模板安装指令"
        );
    }

    #[test]
    fn bound_inputs_instruction_stops_passing_official_down_once_installed() {
        // 用户要求：工具链由运行时装好后，指令里给的是**安装后的真实路径**，不再出现
        // __official__ 与工具链下载语义；此时只有模板仍是 official，才讲模板安装。
        let snapshot = bound_snapshot("/root/toolchains/qt5.12.12", QT_MIGRATION_OFFICIAL_VALUE);
        let text = bound_inputs_instruction(
            &snapshot,
            "/root/toolchains",
            "/root/templates",
            SKILL_DIR,
            "harmonyos",
        )
        .expect("all resolved");

        assert!(text.contains("toolchain：/root/toolchains/qt5.12.12"));
        assert!(!text.contains("toolchain：__official__"));
        assert!(text.contains("template：__official__"));
        // 已装好的工具链：不该再提下载/安装/备份。
        assert!(!text.contains("工具链由运行时负责安装"));
        assert!(!text.contains("bitfun-download-qt-sdk.sh"));
        assert!(!text.contains("BITFUN_QT_MIGRATION_ROOT"));
        // 模板仍走 BitFun 供给脚本流程。
        assert!(text.contains(&format!(
            "bash \"{SKILL_DIR}/scripts/bitfun-download-template.sh\" --platform=harmonyos"
        )));
        assert!(text.contains("/root/templates"));
    }

    #[test]
    fn bound_inputs_instruction_resolved_toolchain_keeps_the_real_path() {
        // After a successful runtime provisioning the binding is the installed kit
        // root, so the instruction carries the real path and no longer asks
        // for any install step.
        let snapshot = bound_snapshot("/root/toolchains/qt5.12.12", "D:/tpl");
        let text = bound_inputs_instruction(
            &snapshot,
            "/root/toolchains",
            "/root/templates",
            SKILL_DIR,
            "harmonyos",
        )
        .expect("all resolved");

        assert!(text.contains("toolchain：/root/toolchains/qt5.12.12"));
        assert!(!text.contains("toolchain：__official__"));
        assert!(
            !text.contains("__official__"),
            "已装好就不该再出现 official 语义"
        );
        assert!(!text.contains("download-qt-sdk.sh"));
    }

    #[test]
    fn bound_inputs_instruction_skips_official_guidance_without_official_value() {
        let snapshot = bound_snapshot("D:/sdk/qt", "D:/tpl");
        let text = bound_inputs_instruction(
            &snapshot,
            "/root/toolchains",
            "/root/templates",
            SKILL_DIR,
            "windows",
        )
        .expect("all resolved");

        assert!(!text.contains("__official__"));
        assert!(!text.contains("download-qt-sdk.sh"));
    }

    #[test]
    fn bound_inputs_instruction_returns_none_when_any_field_unresolved() {
        let mut snapshot = bound_snapshot("D:/sdk/qt", "D:/tpl");
        if let Some(state) = snapshot.fields.get_mut("output_project") {
            state.state = QtMigrationFieldResolutionState::Missing;
            state.value = None;
        }
        assert!(bound_inputs_instruction(
            &snapshot,
            "/root/toolchains",
            "/root/templates",
            SKILL_DIR,
            "windows",
        )
        .is_none());
    }

    #[test]
    fn skill_gate_instruction_carries_official_download_targets() {
        // 只有仍是 official 的字段才带下载语义。
        let both = skill_gate_instruction(
            "/root/toolchains",
            "/root/templates",
            SKILL_DIR,
            "harmonyos",
            true,
            true,
        );
        assert!(both.contains("必须**先调用 Skill 工具加载技能 ohos-qt-skills"));
        // The runtime owns the toolchain install; the BitFun acquisition script
        // remains only as the documented backstop, the template still uses it.
        assert!(both.contains(&format!(
            "bash \"{SKILL_DIR}/scripts/bitfun-download-qt-sdk.sh\" --platform=harmonyos"
        )));
        assert!(both.contains(&format!(
            "bash \"{SKILL_DIR}/scripts/bitfun-download-template.sh\" --platform=harmonyos"
        )));
        assert!(both.contains("/root/toolchains"));
        assert!(both.contains("/root/templates"));
        // The vendored upstream copies are named only to steer the model away from
        // them: they need an explicit --dest outside the scanned root.
        assert!(both.contains("不要改用技能基线里 vendored 的上游 download-template.sh"));

        // 工具链装好后（绑定是真实路径）只保留模板语义。
        let template_only = skill_gate_instruction(
            "/root/toolchains",
            "/root/templates",
            SKILL_DIR,
            "harmonyos",
            false,
            true,
        );
        assert!(template_only.contains(&format!(
            "bash \"{SKILL_DIR}/scripts/bitfun-download-template.sh\" --platform=harmonyos"
        )));
        assert!(!template_only.contains("bitfun-download-qt-sdk.sh"));
        assert!(!template_only.contains("工具链由运行时负责安装"));

        // 两者都不是 official 时没有任何下载语义。
        let neither = skill_gate_instruction(
            "/root/toolchains",
            "/root/templates",
            SKILL_DIR,
            "harmonyos",
            false,
            false,
        );
        assert!(neither.contains("必须**先调用 Skill 工具加载技能 ohos-qt-skills"));
        assert!(!neither.contains("download-"));
        assert!(!neither.contains("__official__"));
    }

    #[test]
    fn confirm_instruction_carries_the_session_toolchain_probe() {
        // 回归：卡片的环境变量层工具链候选完全依赖模型按指令先跑
        // `command -v qmake` 并把命中目录放进专用 candidates 键。指令文本丢掉这
        // 一步后，probe 只剩进程 PATH 兜底（OHOS 沙箱里是应用的最小 PATH），用户
        // 配置在会话/登录 shell 环境变量中的工具链不再出现在候选里。
        let text = CONFIRM_INSTRUCTION;
        let key = crate::scan::SESSION_TOOLCHAIN_CANDIDATES_KEY;
        assert!(
            text.contains("command -v qmake"),
            "指令必须要求模型解析会话 qmake：这是四项输入绑定前 gate 唯一放行的 shell 命令"
        );
        assert!(
            text.contains(&format!("candidates.{key}")),
            "命中路径必须写入 take_session_toolchain_dir 读取的专用键 candidates.{key}"
        );
        assert!(
            text.contains("不要放入 `candidates.toolchain`"),
            "环境变量命中必须留在最低优先级层，不得被当成输入命中的 toolchain"
        );
    }

    /// Reader serving the intake slot from a fixed snapshot.
    #[derive(Debug)]
    struct IntakeReader {
        intake: QtMigrationIntakeStateSnapshot,
    }
    impl DomainStateReader for IntakeReader {
        fn get(&self, slot: &DomainStateSlot) -> Option<Value> {
            if slot != &crate::admission::QT_MIGRATION_SLOT_INTAKE_STATE {
                return None;
            }
            Some(serde_json::to_value(&self.intake).expect("serialize intake snapshot"))
        }
    }

    fn vars(facts: Value) -> std::collections::HashMap<String, String> {
        let mut map = std::collections::HashMap::new();
        map.insert(CTX_QT_MIGRATION_ENABLED.to_string(), "true".to_string());
        map.insert(
            CTX_QT_MIGRATION_INSTRUCTION_FACTS.to_string(),
            facts.to_string(),
        );
        map
    }

    fn empty_snapshot() -> QtMigrationIntakeStateSnapshot {
        let mut fields = BTreeMap::new();
        for field in crate::state::QT_MIGRATION_INTAKE_REQUIRED_FIELDS {
            fields.insert(
                field.to_string(),
                QtMigrationIntakeFieldState {
                    state: QtMigrationFieldResolutionState::Missing,
                    value: None,
                },
            );
        }
        QtMigrationIntakeStateSnapshot {
            schema_version: 1,
            fields,
            status: QtMigrationIntakeStatus::NeedsInput,
            loaded_skill_receipt: None,
            version_strategy: QtMigrationVersionStrategy::default(),
        }
    }

    fn receipt_snapshot() -> QtMigrationIntakeStateSnapshot {
        let mut snapshot = empty_snapshot();
        snapshot.status = QtMigrationIntakeStatus::Ready;
        for field in crate::state::QT_MIGRATION_INTAKE_REQUIRED_FIELDS {
            snapshot.fields.insert(
                field.to_string(),
                QtMigrationIntakeFieldState {
                    state: QtMigrationFieldResolutionState::Resolved,
                    value: Some(format!("/path/{field}")),
                },
            );
        }
        snapshot.loaded_skill_receipt = Some(crate::state::QtMigrationLoadedSkillReceipt {
            skill_key: "bitfun-system::harmony::ohos-qt-skills".to_string(),
            source_slot: "bitfun-system".to_string(),
            dir_name: QT_MIGRATION_SKILL_DIR.to_string(),
            content_hash: "deadbeef".to_string(),
        });
        snapshot
    }

    #[test]
    fn contribution_activation_follows_the_stash() {
        let contribution = QtMigrationTurnInstructions;
        let mut vars = std::collections::HashMap::new();
        vars.insert(CTX_QT_MIGRATION_ENABLED.to_string(), "false".to_string());
        let reader = IntakeReader {
            intake: empty_snapshot(),
        };
        let context = TurnInstructionContext {
            session_id: "session-1",
            dialog_turn_id: "turn-1",
            agent_type: QT_MIGRATION_AGENT_TYPE,
            original_user_input: "migrate my app",
            context_vars: &vars,
            state: &reader,
        };
        assert!(contribution.is_active(&context));
        let texts = contribution.turn_instructions(&context);
        assert!(texts
            .activation
            .as_deref()
            .is_some_and(|t| t.contains("否")));
        assert!(texts.body.is_none(), "non-migration turn has no body");
    }

    #[test]
    fn contribution_is_inactive_for_other_agent_types_or_empty_input() {
        let contribution = QtMigrationTurnInstructions;
        let vars = vars(serde_json::json!({}));
        let reader = IntakeReader {
            intake: empty_snapshot(),
        };
        let make = |agent_type: &'static str, input: &'static str| TurnInstructionContext {
            session_id: "session-1",
            dialog_turn_id: "turn-1",
            agent_type,
            original_user_input: input,
            context_vars: &vars,
            state: &reader,
        };
        assert!(!contribution.is_active(&make("Standard", "migrate my app")));
        assert!(!contribution.is_active(&make(QT_MIGRATION_AGENT_TYPE, "   ")));
    }

    #[test]
    fn contribution_body_prefers_confirm_branch_from_facts() {
        let contribution = QtMigrationTurnInstructions;
        let facts = serde_json::json!({
            "missing_or_referenced": true,
            "pending_fields": "toolchain、template",
            "unclassified_paths": ["/tmp/maybe"]
        });
        let vars = vars(facts);
        let reader = IntakeReader {
            intake: empty_snapshot(),
        };
        let context = TurnInstructionContext {
            session_id: "session-1",
            dialog_turn_id: "turn-1",
            agent_type: QT_MIGRATION_AGENT_TYPE,
            original_user_input: "migrate my app",
            context_vars: &vars,
            state: &reader,
        };
        let texts = contribution.turn_instructions(&context);
        let body = texts.body.expect("migration turn has a body");
        assert!(body.starts_with("## 迁移前置输入"));
        assert!(body.contains("toolchain、template"));
        assert!(body.contains("/tmp/maybe"));
        assert!(body.contains("## 必用技能"));
        // `body` must precede `activation` in the splice order the engine
        // applies (body inserted last at index 0).
        assert!(texts.activation.is_some());
    }

    #[test]
    fn contribution_body_falls_back_to_bound_inputs() {
        let contribution = QtMigrationTurnInstructions;
        let facts = serde_json::json!({
            "missing_or_referenced": false,
            "pending_fields": "",
            "unclassified_paths": []
        });
        let vars = vars(facts);
        let reader = IntakeReader {
            intake: receipt_snapshot(),
        };
        let context = TurnInstructionContext {
            session_id: "session-1",
            dialog_turn_id: "turn-1",
            agent_type: QT_MIGRATION_AGENT_TYPE,
            original_user_input: "migrate my app",
            context_vars: &vars,
            state: &reader,
        };
        let texts = contribution.turn_instructions(&context);
        let body = texts.body.expect("migration turn has a body");
        assert!(body.contains("## 迁移绑定输入"));
        assert!(body.contains("## 必用技能"));
    }
}
