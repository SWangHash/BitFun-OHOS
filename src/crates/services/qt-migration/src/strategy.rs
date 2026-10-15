//! Version-strategy decisions for the Qt migration intake: measure the
//! generation mismatch between the bound source project and the bound
//! toolchain, read the user's strategy answer, and derive the follow-up
//! instruction and toolchain recommendation facts.

use std::path::Path;

use crate::detect::{
    detect_project_qt_major, detect_qt_major, is_qt_source_project, resolve_kit_root,
};
use crate::scan::{QtScanCandidate, MAX_TOOLCHAINS};
use crate::state::{
    qt_migration_is_skill_managed_value, qt_migration_set_version_strategy,
    QtMigrationFieldResolutionState, QtMigrationIntakeFieldState, QtMigrationIntakeStateSnapshot,
    QtMigrationVersionStrategy,
};
use crate::templates::QT_MIGRATION_PATHS_TEMPLATE_ID;

/// How the bound source project's generation relates to the bound toolchain's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QtMigrationGenerationMismatch {
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
    pub fn strategy_instruction(self) -> Option<String> {
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
                QT_MIGRATION_PATHS_TEMPLATE_ID,
        ))
    }

    /// What the *accept* option means in this direction, as the requirement the model
    /// has to satisfy when it writes (or re-writes) the question.
    pub fn strategy_accept_semantics(self) -> Option<String> {
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
    pub fn from_generations(project: u8, toolchain: u8) -> Self {
        match project.cmp(&toolchain) {
            std::cmp::Ordering::Equal => Self::Matching(project),
            std::cmp::Ordering::Greater => Self::ProjectNewer { project, toolchain },
            std::cmp::Ordering::Less => Self::ProjectOlder { project, toolchain },
        }
    }

    /// The two measured generations, when this is a real mismatch.
    pub fn measured_generations(self) -> Option<(u8, u8)> {
        match self {
            Self::ProjectNewer { project, toolchain }
            | Self::ProjectOlder { project, toolchain } => Some((project, toolchain)),
            Self::Unknown | Self::Matching(_) => None,
        }
    }
}

/// Option value the runtime reads as "the user accepted this migration".
pub const QT_MIGRATION_STRATEGY_PROCEED_VALUE: &str = "continue_migration";

/// Option value the runtime reads as "the user refused to migrate this project".
pub const QT_MIGRATION_STRATEGY_ABORT_VALUE: &str = "abort";

/// The decision a submitted version-strategy answer carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QtMigrationStrategyAnswer {
    /// The user accepted the migration even though the generations differ.
    Proceed,
    /// The user refused to migrate this project.
    Abort,
}

/// Read the decision out of a submitted answer group, or `None` when it carries
/// neither value.
pub fn read_version_strategy_answer(
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

/// Qt kit typed into a strategy question's free-text answer; a file path resolves
/// to its directory.
pub fn read_replacement_toolchain_answer(answers: &serde_json::Value) -> Option<String> {
    let answers = answers.as_object()?;
    for value in answers.values() {
        let tokens: Vec<&str> = match value {
            serde_json::Value::String(token) => vec![token.as_str()],
            serde_json::Value::Array(items) => {
                items.iter().filter_map(|item| item.as_str()).collect()
            }
            _ => continue,
        };
        for token in tokens {
            let token = token.trim();
            if token.is_empty()
                || token == QT_MIGRATION_STRATEGY_ABORT_VALUE
                || token == QT_MIGRATION_STRATEGY_PROCEED_VALUE
            {
                continue;
            }
            let path = Path::new(token);
            let dir = if path.is_file() {
                match path.parent() {
                    Some(parent) => parent,
                    None => continue,
                }
            } else {
                path
            };
            if detect_qt_major(resolve_kit_root(dir)).is_some() {
                return Some(dir.to_string_lossy().into_owned());
            }
        }
    }
    None
}

/// Bind `toolchain` and re-measure the generation mismatch.
pub fn rebind_strategy_toolchain(
    snapshot: &QtMigrationIntakeStateSnapshot,
    toolchain: &str,
    official_qt_major: Option<u8>,
) -> QtMigrationIntakeStateSnapshot {
    let mut next = snapshot.clone();
    next.fields.insert(
        "toolchain".to_string(),
        QtMigrationIntakeFieldState {
            state: QtMigrationFieldResolutionState::Resolved,
            value: Some(toolchain.to_string()),
        },
    );
    let strategy = match measure_bound_generation_mismatch(&next, official_qt_major) {
        Some((project, toolchain)) => QtMigrationVersionStrategy::Pending { project, toolchain },
        None => QtMigrationVersionStrategy::NotNeeded,
    };
    qt_migration_set_version_strategy(&next, strategy)
}

/// The measured `(project, toolchain)` generations of the bound intake values, when
/// both sides are measurable and disagree.
pub fn measure_bound_generation_mismatch(
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
pub fn pending_generation_mismatch(
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
pub enum QtMigrationStrategyFollowUp {
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
    pub fn measured_generations(self) -> Option<(u8, u8)> {
        match self {
            Self::MissingAnswer { mismatch }
            | Self::NotRecorded { mismatch }
            | Self::Decided { mismatch, .. } => mismatch.measured_generations(),
        }
    }

    /// The mismatch this fact was built from, for the surfaces that need the
    /// direction (downgrade vs continue) rather than just the two numbers.
    pub fn mismatch(self) -> QtMigrationGenerationMismatch {
        match self {
            Self::MissingAnswer { mismatch }
            | Self::NotRecorded { mismatch }
            | Self::Decided { mismatch, .. } => mismatch,
        }
    }

    /// What the question's *accept* option has to mean, for the re-ask instructions
    /// that must not drop the direction the first instruction stated.
    pub fn strategy_accept_semantics(self) -> Option<String> {
        self.mismatch().strategy_accept_semantics()
    }
}

/// The version-strategy fact an answered non-template question carries, or `None`
/// when this session measured no mismatch (nothing to say about any question).
pub fn version_strategy_follow_up(
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
pub(crate) fn bound_intake_value<'a>(
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
pub fn compare_bound_generations(
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
    let toolchain_major = if qt_migration_is_skill_managed_value(toolchain) {
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
pub fn recommend_toolchains(
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
pub fn official_toolchain_serves_a_project(
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
