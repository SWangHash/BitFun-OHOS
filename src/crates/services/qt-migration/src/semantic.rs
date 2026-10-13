//! Qt migration intent semantics: the deterministic request analyzer, the
//! LLM-backed intent contract (system prompt, output schema, user-prompt
//! assembly, output validation), and the intent-analysis contribution the
//! host orchestrator dispatches through.
//!
//! The host owns the one structured model call and the per-turn cache; this
//! module owns everything about what is asked and how the answer is judged.

use std::collections::BTreeMap;

use bitfun_runtime_ports::{DomainStateReader, IntentAnalysisContribution, TurnIntentDecision};
use serde_json::{json, Value};

use crate::admission::QT_MIGRATION_SLOT_INTAKE_STATE;
use crate::instructions::QT_MIGRATION_AGENT_TYPE;
use crate::state::{
    intake_snapshot_from_slot_value, QtMigrationIntakeStatus, QT_MIGRATION_INTAKE_REQUIRED_FIELDS,
};

/// Main task priority for compound requests.
const TASK_PRIORITY: &[&str] = &[
    "app_migration",
    "build_troubleshooting",
    "api_mapping",
    "module_support",
    "window_issue",
    "lifecycle",
    "third_party_dependency",
    "toolchain_setup",
    "demo_generation",
];

const TASK_TYPES: &[&str] = &[
    "app_migration",
    "api_mapping",
    "module_support",
    "window_issue",
    "lifecycle",
    "third_party_dependency",
    "toolchain_setup",
    "build_troubleshooting",
    "demo_generation",
    "ambiguous",
    "other",
];

const PROMPT_MAX_CHARS: usize = 4000;

pub const INTENT_SYSTEM_PROMPT: &str = r#"你是 Qt → HarmonyOS(OpenHarmony) 迁移请求的语义分析器。分析用户消息，只输出一个 JSON 对象，不要输出任何其他内容：
{
  "taskType": "app_migration|api_mapping|module_support|window_issue|lifecycle|third_party_dependency|toolchain_setup|build_troubleshooting|demo_generation|ambiguous|other",
  "fields": {
    "source_project": {"state": "resolved|referenced|missing", "path": "<绝对路径或null>"},
    "output_project": {"state": "resolved|referenced|missing", "path": "<绝对路径或null>"},
    "toolchain": {"state": "resolved|referenced|missing", "path": "<绝对路径或null>"},
    "template": {"state": "resolved|referenced|missing", "path": "<绝对路径或null>"}
  }
}
判定规则：
- app_migration 必须同时满足：Qt 语境 + 迁移动作 + HarmonyOS/OpenHarmony 目标；
- 延续性例外：若用户消息未提及 HarmonyOS/OpenHarmony，但"会话迁移上下文"表明本会话正在/刚完成一个 Qt→鸿蒙迁移任务，且用户消息是在要求把其余/另一个工程也按同样方式迁移（如"其余工程也迁移"、"下一个也这样处理"），判定为 app_migration；此时用户未给出路径的字段用 missing（将触发路径确认卡片）；
- 结合上下文后，若用户消息只是对上一任务结果的追问、修改意见或无关话题，不要判定为 app_migration；
- state=resolved 仅当该输入给出了具体路径；只提到名称（如"官方工具链"、"模板工程"）而没有路径时用 referenced；
- 用户用口语指代路径（如"D 盘 qt-test 下的 telegram"、"工作区里那个记事本工程"）时，结合上下文尽力解析为绝对路径；解析不出具体路径就用 referenced；
- path 必须原样保留用户写法，不要改写、不要展开环境变量、不要拼凑不存在的路径；
- 与迁移无关的请求 taskType 用 other。"#;

/// JSON Schema for the intent call's structured output. Kept conservative
/// (no unions, no strict mode): providers compile `output_schema` differently
/// and the domain validation tolerates missing fields regardless.
pub fn intent_output_schema() -> Value {
    fn field_schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "state": {
                    "type": "string",
                    "enum": ["resolved", "referenced", "missing"],
                },
                "path": {"type": "string"},
            },
            "required": ["state"],
        })
    }
    json!({
        "type": "object",
        "properties": {
            "taskType": {"type": "string", "enum": TASK_TYPES},
            "fields": {
                "type": "object",
                "properties": {
                    "source_project": field_schema(),
                    "output_project": field_schema(),
                    "toolchain": field_schema(),
                    "template": field_schema(),
                },
            },
        },
        "required": ["taskType", "fields"],
    })
}

/// User prompt for the intent call: the (truncated) raw prompt plus the
/// optional session migration context, closed by the JSON instruction.
pub fn intent_user_prompt(prompt: &str, context_summary: Option<&str>) -> String {
    let truncated = if prompt.chars().count() > PROMPT_MAX_CHARS {
        prompt.chars().take(PROMPT_MAX_CHARS).collect::<String>()
    } else {
        prompt.to_string()
    };
    match context_summary {
        Some(summary) => {
            format!("User message: {truncated}\n\n会话迁移上下文：{summary}\n\n请输出 JSON：")
        }
        None => format!("User message: {truncated}\n\n请输出 JSON："),
    }
}

/// Summary of the session's current/last migration task from an intake
/// snapshot. `None` when the session has no activated migration intake.
pub fn intent_context_summary(
    intake: &crate::state::QtMigrationIntakeStateSnapshot,
) -> Option<String> {
    if intake.status == QtMigrationIntakeStatus::NotApplicable {
        return None;
    }
    let bound = |field: &str| -> Option<String> {
        intake
            .fields
            .get(field)
            .filter(|f| f.state.can_bind_value())
            .and_then(|f| f.value.clone())
    };
    let mut parts = Vec::new();
    if let Some(v) = bound("source_project") {
        parts.push(format!("源工程 {}", v));
    }
    if let Some(v) = bound("output_project") {
        parts.push(format!("输出 {}", v));
    }
    if let Some(v) = bound("toolchain") {
        parts.push(format!("工具链 {}", v));
    }
    if let Some(v) = bound("template") {
        parts.push(format!("模板 {}", v));
    }
    if parts.is_empty() {
        return None;
    }
    Some(format!(
        "{}（任务状态 {:?}）",
        parts.join("，"),
        intake.status
    ))
}

/// Validate one model output and assemble the typed decision. Returns `None`
/// when the output is not a usable analysis so the caller can fall back.
pub fn build_intent_decision(output: &str) -> Option<TurnIntentDecision> {
    let parsed = parse_json_payload(output)?;
    let task_type = parsed.get("taskType")?.as_str()?;
    if !TASK_TYPES.contains(&task_type) {
        return None;
    }
    let fields_input = parsed.get("fields")?;

    let mut fields = serde_json::Map::new();
    let mut resolved_paths = serde_json::Map::new();
    let mut unclassified: Vec<Value> = Vec::new();
    for field in QT_MIGRATION_INTAKE_REQUIRED_FIELDS {
        let entry = fields_input.get(field).cloned().unwrap_or(Value::Null);
        let state = entry
            .get("state")
            .and_then(Value::as_str)
            .unwrap_or("missing");
        let path = entry
            .get("path")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|p| !p.is_empty());
        let normalized = match (state, path) {
            ("resolved", Some(path)) if !path.contains("..") => {
                if std::path::Path::new(path).exists() {
                    resolved_paths.insert(field.to_string(), json!(path));
                    unclassified.push(json!(path));
                    "resolved"
                } else {
                    // LLM claimed a path that does not exist locally: keep it
                    // as a candidate hint but never bind it blindly.
                    unclassified.push(json!(path));
                    "referenced"
                }
            }
            ("resolved", Some(path)) | ("referenced", Some(path)) => {
                unclassified.push(json!(path));
                "referenced"
            }
            // A field the model marked present without a usable path stays
            // "referenced" (mentioned but not bindable), never "missing".
            ("resolved", None) | ("referenced", None) => "referenced",
            _ => "missing",
        };
        fields.insert(field.to_string(), json!(normalized));
    }
    resolved_paths.insert("unclassifiedPaths".to_string(), json!(unclassified));

    Some(decision_from_analyze_json(json!({
        "taskType": task_type,
        "secondaryTaskTypes": [],
        "requiresClarification": task_type == "ambiguous",
        "fields": Value::Object(fields),
        "resolvedPaths": Value::Object(resolved_paths),
        "reason": format!("LLM 语义分析：{}。", task_type),
        "source": "llm",
    })))
}

/// Deterministic decision used when the pre-filter rejects or the model call
/// fails.
pub fn fallback_intent_decision(prompt: &str) -> TurnIntentDecision {
    decision_from_analyze_json(analyze_request(prompt))
}

/// Project a decision JSON (the `analyze_request` shape, shared by the
/// deterministic and LLM paths) into the typed port decision.
fn decision_from_analyze_json(value: Value) -> TurnIntentDecision {
    let flow_enabled = value["taskType"].as_str() == Some("app_migration");
    let mut field_states = BTreeMap::new();
    for field in QT_MIGRATION_INTAKE_REQUIRED_FIELDS {
        if let Some(state) = value["fields"].get(field).and_then(Value::as_str) {
            field_states.insert(field.to_string(), state.to_string());
        }
    }
    let resolved_paths = value["resolvedPaths"].clone();
    let unclassified_paths = resolved_paths["unclassifiedPaths"]
        .as_array()
        .map(|paths| {
            paths
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    TurnIntentDecision {
        value,
        flow_enabled,
        resolved_paths,
        field_states,
        unclassified_paths,
    }
}

/// Facts the turn-instruction contribution renders, derived from the typed
/// intent decision plus the host's binding outcome for this turn. The engine
/// passes the binding results; every field-level judgment stays domain-owned.
pub fn instruction_facts(
    decision: &TurnIntentDecision,
    prompt_starts_new_task: bool,
    all_bound: bool,
) -> Value {
    let pending: Vec<&str> = QT_MIGRATION_INTAKE_REQUIRED_FIELDS
        .iter()
        .copied()
        .filter(|field| {
            matches!(
                decision.field_states.get(*field).map(String::as_str),
                Some("missing" | "referenced")
            )
        })
        .collect();
    let missing_or_referenced = prompt_starts_new_task || !all_bound || !pending.is_empty();
    json!({
        "missing_or_referenced": missing_or_referenced,
        "pending_fields": pending.join("、"),
        "unclassified_paths": decision.unclassified_paths,
    })
}

/// Extract the JSON object from a model reply, tolerating ```json fences and
/// stray prose around it.
fn parse_json_payload(output: &str) -> Option<Value> {
    let trimmed = output.trim();
    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    if end < start {
        return None;
    }
    serde_json::from_str(&trimmed[start..=end]).ok()
}

/// Full deterministic decision: taskType + per-field minimum-input state.
/// Same JSON shape as the LLM-path decision (minus its `source: "llm"` mark).
pub fn analyze_request(request: &str) -> Value {
    let (task_type, secondary, requires_clarification, fields, reason) = analyze_internal(request);
    let resolved_paths = extract_resolved_paths(request);
    json!({
        "taskType": task_type,
        "secondaryTaskTypes": secondary,
        "requiresClarification": requires_clarification,
        "fields": fields,
        "resolvedPaths": resolved_paths,
        "reason": reason,
    })
}

/// Case-insensitive word-boundary search for ASCII tokens. `report`,
/// `portable`, `support`, `viewport` must NOT match `port`.
fn has_word_ci(text: &str, needle: &str) -> bool {
    let lower = text.to_lowercase();
    let needle_lower = needle.to_lowercase();
    let bytes = lower.as_bytes();
    let nbytes = needle_lower.as_bytes();
    if nbytes.is_empty() {
        return false;
    }
    let mut start = 0;
    while let Some(relative) = lower[start..].find(&needle_lower) {
        let index = start + relative;
        let before_ok =
            index == 0 || (!bytes[index - 1].is_ascii_alphanumeric() && bytes[index - 1] != b'_');
        let end = index + nbytes.len();
        let after_ok =
            end >= bytes.len() || (!bytes[end].is_ascii_alphanumeric() && bytes[end] != b'_');
        if before_ok && after_ok {
            return true;
        }
        start = index + 1;
    }
    false
}

/// Chinese-substring / ASCII-substring containment without word boundaries
/// (Chinese has no spaces to split on).
fn contains_ci(text: &str, needle: &str) -> bool {
    text.to_lowercase().contains(&needle.to_lowercase())
}

pub fn has_qt_context(text: &str) -> bool {
    let lower = text.to_lowercase();
    ["qt", "qml", "qwidget", "qmake", "qt5", "qt6"]
        .iter()
        .any(|token| has_word_ci(&lower, token))
}

pub fn has_migration_action(text: &str) -> bool {
    let lower = text.to_lowercase();
    ["迁移", "移植", "搬", "鸿蒙化"]
        .iter()
        .any(|token| contains_ci(text, token))
        || ["migrate", "migration", "migrating", "port"]
            .iter()
            .any(|token| has_word_ci(&lower, token))
}

fn has_harmonyos_target(text: &str) -> bool {
    contains_ci(text, "鸿蒙")
        || ["harmonyos", "openharmony", "ohos"]
            .iter()
            .any(|token| has_word_ci(&text.to_lowercase(), token))
}

pub fn has_any_task_signal(text: &str) -> bool {
    has_qt_context(text) || has_migration_action(text) || has_harmonyos_target(text)
}

/// Field-level resolution produced by the string-layer analyzer. The value
/// "validated" is intentionally absent here (execution boundary's job).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FieldLevel {
    Missing,
    Referenced,
    Resolved,
}

impl FieldLevel {
    fn as_str(self) -> &'static str {
        match self {
            Self::Missing => "missing",
            Self::Referenced => "referenced",
            Self::Resolved => "resolved",
        }
    }
}

fn classify_secondary_tasks(text: &str, primary: &str) -> Vec<String> {
    let mut found = Vec::new();
    let lower = text.to_lowercase();
    let build = contains_ci(&lower, "编译失败")
        || contains_ci(&lower, "构建失败")
        || contains_ci(&lower, "编译错误")
        || contains_ci(text, "build error")
        || contains_ci(text, "build fails")
        || contains_ci(text, "cannot compile");
    let api =
        contains_ci(&lower, "api") || contains_ci(&lower, "映射") || contains_ci(text, "mapping");
    let module = contains_ci(&lower, "模块") || has_word_ci(&lower, "module");
    let window =
        contains_ci(&lower, "窗口") || has_word_ci(&lower, "window") || has_word_ci(&lower, "界面");
    let lifecycle = contains_ci(&lower, "生命周期") || has_word_ci(&lower, "lifecycle");
    let third = contains_ci(&lower, "三方")
        || contains_ci(&lower, "第三方")
        || contains_ci(&lower, "dependency");
    let toolchain = contains_ci(&lower, "工具链")
        || has_word_ci(&lower, "toolchain")
        || contains_ci(&lower, "sdk");
    let demo = contains_ci(&lower, "demo") || contains_ci(&lower, "示例");

    let mut candidates: Vec<(&str, bool)> = vec![
        ("build_troubleshooting", build),
        ("api_mapping", api),
        ("module_support", module),
        ("window_issue", window),
        ("lifecycle", lifecycle),
        ("third_party_dependency", third),
        ("toolchain_setup", toolchain),
        ("demo_generation", demo),
    ];
    candidates.sort_by_key(|(task, _)| {
        TASK_PRIORITY
            .iter()
            .position(|priority| priority == task)
            .unwrap_or(TASK_PRIORITY.len())
    });
    for (task, hit) in candidates {
        if hit && task != primary {
            found.push(task.to_string());
        }
    }
    found
}

/// Guess a single primary task among the signal types when app_migration does
/// not hold, using the fixed priority order.
fn classify_non_migration_primary(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    let build = contains_ci(&lower, "编译失败")
        || contains_ci(&lower, "构建失败")
        || contains_ci(&lower, "编译错误")
        || contains_ci(text, "build error")
        || contains_ci(text, "build fails");
    let api = contains_ci(&lower, "api") || contains_ci(&lower, "映射");
    let module = contains_ci(&lower, "模块") || has_word_ci(&lower, "module");
    let window = contains_ci(&lower, "窗口") || has_word_ci(&lower, "window");
    let lifecycle = contains_ci(&lower, "生命周期") || has_word_ci(&lower, "lifecycle");
    let third = contains_ci(&lower, "三方") || contains_ci(&lower, "第三方");
    let toolchain = contains_ci(&lower, "工具链") || has_word_ci(&lower, "toolchain");
    let demo = contains_ci(&lower, "demo") || contains_ci(&lower, "示例");

    let candidates: Vec<(usize, &str, bool)> = vec![
        (0, "app_migration", false),
        (1, "build_troubleshooting", build),
        (2, "api_mapping", api),
        (3, "module_support", module),
        (4, "window_issue", window),
        (5, "lifecycle", lifecycle),
        (6, "third_party_dependency", third),
        (7, "toolchain_setup", toolchain),
        (8, "demo_generation", demo),
    ];
    let mut best: Option<(usize, &str)> = None;
    for (priority, task, hit) in candidates {
        if hit && best.is_none_or(|(best_priority, _)| priority < best_priority) {
            best = Some((priority, task));
        }
    }
    best.map(|(_, task)| task.to_string())
}

/// Extract absolute-path-like tokens: Windows `X:\...`/`X:/...`, or a token
/// starting with `/`/`\` on the executing host. Kept conservative: bare words,
/// URLs' path fragments and query strings are ignored.
fn find_absolute_paths(text: &str) -> Vec<String> {
    let mut paths = Vec::new();
    for token in text.split_whitespace() {
        let cleaned = token.trim_matches(|c: char| {
            "。，,;；：:\"'()[]{}《》〈〉\u{201C}\u{201D}\u{2018}\u{2019}「」『』【】".contains(c)
        });
        if cleaned.len() < 3 {
            continue;
        }
        let bytes = cleaned.as_bytes();
        let is_windows = bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/');
        let is_unix = bytes[0] == b'/' || bytes[0] == b'\\';
        if is_windows || is_unix {
            // Heuristic URL check: skip tokens that clearly are web URLs.
            if cleaned.contains("://") || cleaned.starts_with("http") {
                continue;
            }
            paths.push(cleaned.to_string());
        }
    }
    paths
}

/// Classify each of the four minimum inputs independently.
fn classify_fields(text: &str) -> Value {
    let lower = text.to_lowercase();
    let paths = find_absolute_paths(text);

    let mut source = FieldLevel::Missing;
    let mut output = FieldLevel::Missing;
    let mut toolchain = FieldLevel::Missing;
    let mut template = FieldLevel::Missing;

    // --- source / output from path tokens (independent, never shared) ---
    for (idx, path) in paths.iter().enumerate() {
        let is_output = output_anchor_here(idx, path, text);
        if is_output {
            output = FieldLevel::Resolved;
        } else {
            source = FieldLevel::Resolved;
        }
    }
    // A named source mention without a path: "source 是 myqt 工程" -> Referenced
    if source == FieldLevel::Missing
        && (contains_ci(&lower, "源工程")
            || contains_ci(&lower, "原始工程")
            || contains_ci(&lower, "原工程")
            || has_word_ci(&lower, "source"))
    {
        source = FieldLevel::Referenced;
    }
    if output == FieldLevel::Missing
        && (contains_ci(&lower, "输出")
            || contains_ci(&lower, "目标")
            || has_word_ci(&lower, "output"))
        && (contains_ci(&lower, "输出到")
            || contains_ci(&lower, "输出目录")
            || contains_ci(&lower, "输出路径")
            || contains_ci(&lower, "输出工程"))
    {
        output = FieldLevel::Referenced;
    }

    // Build-file references (`.pro`, `CMakeLists.txt`) count as a source
    // reference only when they are actually bound to the migration source;
    // they never satisfy `output`.
    if source == FieldLevel::Missing
        && (contains_ci(&lower, ".pro") || contains_ci(&lower, "cmakelists"))
    {
        source = FieldLevel::Referenced;
    }

    // --- toolchain (needs a path or a registered ID, not a bare keyword) ---
    let mentions_toolchain = contains_ci(&lower, "工具链")
        || contains_ci(&lower, "toolchain")
        || contains_ci(&lower, "编译器")
        || has_word_ci(&lower, "sdk");
    if mentions_toolchain
        && paths
            .iter()
            .any(|p| has_toolchain_anchor_here_text(p, text))
    {
        toolchain = FieldLevel::Resolved;
    } else if has_word_ci(&lower, "toolchain") || contains_ci(&lower, "工具链") {
        // Named mention only (e.g. "使用官方工具链") -> no bindable value.
        toolchain = FieldLevel::Referenced;
    }

    // --- template (needs a path or a registered ID) ---
    let mentions_template = contains_ci(&lower, "模板")
        || has_word_ci(&lower, "template")
        || contains_ci(&lower, "模版");
    if mentions_template && paths.iter().any(|p| has_template_anchor_here_text(p, text)) {
        template = FieldLevel::Resolved;
    } else if has_word_ci(&lower, "template")
        || contains_ci(&lower, "模板")
        || contains_ci(&lower, "模版")
    {
        template = FieldLevel::Referenced;
    }

    json!({
        "source_project": source.as_str(),
        "output_project": output.as_str(),
        "toolchain": toolchain.as_str(),
        "template": template.as_str(),
    })
}

fn output_anchor_here(idx: usize, path: &str, text: &str) -> bool {
    // Direct prefix: `output:D:/out` / `out:D:/out`
    if path.starts_with("output:") || path.starts_with("out:") {
        return true;
    }
    // Window scan before the path for an output anchor.
    let Some(index) = text.find(path) else {
        return false;
    };
    let start = index.saturating_sub(60);
    let window = &text[start..index];
    let window_lower = window.to_lowercase();
    let _ = idx;
    [
        "输出到",
        "输出为",
        "输出目录",
        "输出路径",
        "输出工程",
        "输出",
        "目标",
        "destination",
    ]
    .iter()
    .any(|anchor| window_lower.contains(anchor))
        || ["output", "out"]
            .iter()
            .any(|anchor| has_word_ci(&window_lower, anchor))
}

fn has_toolchain_anchor_here_text(path: &str, text: &str) -> bool {
    let Some(index) = text.find(path) else {
        return false;
    };
    let start = index.saturating_sub(80);
    let window = text[start..index].to_lowercase();
    [
        "工具链",
        "toolchain",
        "编译器",
        "sdk",
        "用",
        "使用",
        "路径为",
        "路径是",
    ]
    .iter()
    .any(|anchor| window.contains(anchor))
}

fn has_template_anchor_here_text(path: &str, text: &str) -> bool {
    let Some(index) = text.find(path) else {
        return false;
    };
    let start = index.saturating_sub(80);
    let window = text[start..index].to_lowercase();
    ["模板", "template", "模版"]
        .iter()
        .any(|anchor| window.contains(anchor))
}

fn extract_resolved_paths(text: &str) -> Value {
    let paths = find_absolute_paths(text);
    let mut resolved = serde_json::Map::new();
    let mut unclassified: Vec<String> = Vec::new();
    for path in &paths {
        if output_anchor_here(0, path, text) {
            resolved.insert("output_project".to_string(), json!(path));
        } else if has_toolchain_anchor_here_text(path, text) {
            resolved.insert("toolchain".to_string(), json!(path));
        } else if has_template_anchor_here_text(path, text) {
            resolved.insert("template".to_string(), json!(path));
        } else {
            resolved
                .entry("source_project".to_string())
                .or_insert(json!(path));
            unclassified.push(path.clone());
        }
    }
    resolved.insert("unclassifiedPaths".to_string(), json!(unclassified));
    Value::Object(resolved)
}

/// Pure decision used by both the tool and the engine turn gate.
fn analyze_internal(request: &str) -> (String, Vec<String>, bool, Value, String) {
    let fields = classify_fields(request);
    let is_app_migration =
        has_qt_context(request) && has_migration_action(request) && has_harmonyos_target(request);

    if is_app_migration {
        let secondary = classify_secondary_tasks(request, "app_migration");
        let missing_fields: Vec<&str> = [
            (
                "source_project",
                fields["source_project"].as_str().unwrap_or("missing"),
            ),
            (
                "output_project",
                fields["output_project"].as_str().unwrap_or("missing"),
            ),
            (
                "toolchain",
                fields["toolchain"].as_str().unwrap_or("missing"),
            ),
            ("template", fields["template"].as_str().unwrap_or("missing")),
        ]
        .iter()
        .filter(|(_, state)| *state == "missing")
        .map(|(id, _)| *id)
        .collect();

        let reason = if missing_fields.is_empty() {
            "app_migration 已识别且四字段均有引用。".to_string()
        } else {
            format!(
                "app_migration 已识别，缺少以下迁移输入：{}。",
                missing_fields.join("、")
            )
        };
        return (
            "app_migration".to_string(),
            secondary,
            false,
            fields,
            reason,
        );
    }

    // Not a full migration. Non-migration routing only applies when the
    // request carries SOME Qt/migration/HarmonyOS signal; otherwise it is
    // plainly unrelated. When a signal exists but nothing routes cleanly we
    // return `ambiguous` (never force-map to app_migration or other).
    if !has_any_task_signal(request) {
        return (
            "other".to_string(),
            Vec::new(),
            false,
            fields,
            "未识别到 Qt 迁移或相关任务。".to_string(),
        );
    }

    if let Some(task) = classify_non_migration_primary(request) {
        let secondary = classify_secondary_tasks(request, &task);
        let reason = format!("已路由为非迁移任务：{}。", task);
        (task, secondary, false, fields, reason)
    } else {
        (
            "ambiguous".to_string(),
            Vec::new(),
            true,
            fields,
            "无法可靠分类，需要澄清。".to_string(),
        )
    }
}

/// Intent-analysis contribution for `QtMigration` turns. All domain knowledge
/// (pre-filter, prompts, schema, validation, deterministic fallback) lives in
/// this module; the host orchestrator supplies the model call and the cache.
pub struct QtMigrationIntentAnalyzer;

impl IntentAnalysisContribution for QtMigrationIntentAnalyzer {
    fn agent_type(&self) -> &'static str {
        QT_MIGRATION_AGENT_TYPE
    }

    fn has_task_signal(&self, prompt: &str) -> bool {
        has_any_task_signal(prompt)
    }

    fn context_summary(&self, state: &dyn DomainStateReader) -> Option<String> {
        let intake = intake_snapshot_from_slot_value(state.get(&QT_MIGRATION_SLOT_INTAKE_STATE));
        intent_context_summary(&intake)
    }

    fn system_prompt(&self) -> String {
        INTENT_SYSTEM_PROMPT.to_string()
    }

    fn user_prompt(&self, prompt: &str, context_summary: Option<&str>) -> String {
        intent_user_prompt(prompt, context_summary)
    }

    fn output_schema(&self) -> Option<Value> {
        Some(intent_output_schema())
    }

    fn build_decision(&self, output: &str) -> Option<TurnIntentDecision> {
        build_intent_decision(output)
    }

    fn fallback_decision(&self, prompt: &str) -> TurnIntentDecision {
        fallback_intent_decision(prompt)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{
        QtMigrationFieldResolutionState, QtMigrationIntakeFieldState, QtMigrationVersionStrategy,
    };

    fn fields_of(decision: &Value) -> (FieldLevel, FieldLevel, FieldLevel, FieldLevel) {
        let f = |key: &str| match decision["fields"][key].as_str().unwrap_or("missing") {
            "resolved" => FieldLevel::Resolved,
            "referenced" => FieldLevel::Referenced,
            _ => FieldLevel::Missing,
        };
        (
            f("source_project"),
            f("output_project"),
            f("toolchain"),
            f("template"),
        )
    }

    #[test]
    fn full_chinese_migration_request_is_app_migration() {
        let d = analyze_request("请我帮你把 Qt 工程搬到鸿蒙化，并且编译构建，部署，验证");
        assert_eq!(d["taskType"], "app_migration");
        assert_eq!(d["requiresClarification"], false);
        let (source, output, _tc, _tp) = fields_of(&d);
        assert_eq!(source, FieldLevel::Missing);
        assert_eq!(output, FieldLevel::Missing);
    }

    #[test]
    fn full_english_migration_request_is_app_migration() {
        let d = analyze_request("Migrate my Qt 5.15 project to OpenHarmony and build it.");
        assert_eq!(d["taskType"], "app_migration");
    }

    #[test]
    fn port_substring_collisions_do_not_trigger_migration() {
        // `report`, `portable`, `viewport`, `support` must not match `port`.
        let d = analyze_request("Why does my portable report render wrong?");
        assert_ne!(d["taskType"], "app_migration");
        let d2 = analyze_request("The viewport is broken on this page.");
        assert_ne!(d2["taskType"], "app_migration");
    }

    #[test]
    fn qt_only_query_routes_to_module_support_not_migration() {
        let d = analyze_request("Qt6 在鸿蒙上支持哪些模块？");
        assert_eq!(d["taskType"], "module_support");
        assert_ne!(d["taskType"], "app_migration");
    }
    #[test]
    fn compound_request_keeps_primary_and_secondary() {
        let d = analyze_request("把这个 Qt 工程迁移到鸿蒙，并且解决现有编译错误");
        assert_eq!(d["taskType"], "app_migration");
        assert!(d["secondaryTaskTypes"]
            .as_array()
            .expect("secondary keys array")
            .iter()
            .any(|v| v == "build_troubleshooting"));
    }

    #[test]
    fn harmonyos_only_mentions_are_ambiguous() {
        let d = analyze_request("鸿蒙上这个怎么处理？");
        assert_eq!(d["taskType"], "ambiguous");
        assert_eq!(d["requiresClarification"], true);
    }

    #[test]
    fn unrelated_request_is_other() {
        let d = analyze_request("帮我重构一下这个模块的接口设计");
        assert_eq!(d["taskType"], "other");
    }

    #[test]
    fn single_absolute_path_does_not_satisfy_output() {
        let d = analyze_request("把 D:/workspace/myqt 这个 Qt 工程迁移到鸿蒙");
        assert_eq!(d["taskType"], "app_migration");
        let (source, output, _tc, _tp) = fields_of(&d);
        assert_eq!(source, FieldLevel::Resolved);
        assert_eq!(
            output,
            FieldLevel::Missing,
            "output must not reuse source token"
        );
    }

    #[test]
    fn quoted_path_is_stripped_and_extracted() {
        // The strip set trims quote characters from a whitespace-delimited
        // token's ends, so the quoted path must stand as its own token.
        // (Glued CJK text like "把《path》这个" was never extractable; the
        // old bitfun-core test could not run to catch this because the core
        // lib test target does not compile.)
        let d = analyze_request("把 《D:/workspace/myqt》 这个 Qt 工程迁移到鸿蒙");
        assert_eq!(d["taskType"], "app_migration");
        assert_eq!(
            d["resolvedPaths"]["source_project"].as_str(),
            Some("D:/workspace/myqt"),
            "中文书名号包裹的路径必须剥除后提取"
        );
    }
    #[test]
    fn output_anchor_binds_path_to_output() {
        let d = analyze_request("把 D:/workspace/myqt 迁移到鸿蒙，输出到 D:/out");
        let (source, output, _tc, _tp) = fields_of(&d);
        assert_eq!(source, FieldLevel::Resolved);
        assert_eq!(output, FieldLevel::Resolved);
    }
    #[test]
    fn bound_toolchain_path_resolves() {
        let d = analyze_request("把 D:/proj 迁移到鸿蒙，工具链用 D:/sdk/ohos");
        assert_eq!(d["fields"]["toolchain"], "resolved");
    }

    #[test]
    fn incomplete_migration_semantics_remain_ordinary_requests() {
        for request in ["将QT工程迁移", "把工程迁移成鸿蒙工程", "看看这个Qt工程"]
        {
            let decision = analyze_request(request);
            assert_ne!(decision["taskType"], "app_migration", "request: {request}");
        }
    }

    // --- LLM contract -----------------------------------------------------

    #[test]
    fn code_fence_and_prose_are_stripped() {
        let output =
            "分析结果如下：\n```json\n{\"taskType\": \"other\", \"fields\": {}}\n```\n以上。";
        let decision = build_intent_decision(output).expect("usable analysis");
        assert_eq!(decision.value["taskType"], "other");
        assert!(!decision.flow_enabled);
    }

    #[test]
    fn invalid_task_type_falls_back() {
        let output = r#"{"taskType": "deploy_to_mars", "fields": {}}"#;
        assert!(build_intent_decision(output).is_none());
    }

    #[test]
    fn broken_json_falls_back() {
        assert!(build_intent_decision("不是 JSON").is_none());
        assert!(build_intent_decision("{\"taskType\":").is_none());
    }

    #[test]
    fn existing_path_is_resolved_and_missing_path_demotes_to_referenced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("myqt");
        std::fs::create_dir_all(&path).unwrap();
        let output = format!(
            r#"{{"taskType": "app_migration", "fields": {{
                "source_project": {{"state": "resolved", "path": "{}"}},
                "output_project": {{"state": "resolved", "path": "D:/definitely/not/here"}},
                "toolchain": {{"state": "referenced", "path": null}},
                "template": {{"state": "missing", "path": null}}
            }}}}"#,
            path.to_string_lossy().replace('\\', "/")
        );

        let decision = build_intent_decision(&output).expect("usable analysis");
        assert!(decision.flow_enabled, "app_migration enables the flow");
        assert_eq!(decision.value["fields"]["source_project"], "resolved");
        assert_eq!(
            decision.value["resolvedPaths"]["source_project"].as_str(),
            Some(path.to_string_lossy().replace('\\', "/").as_str())
        );
        assert_eq!(decision.value["fields"]["output_project"], "referenced");
        assert_eq!(decision.value["fields"]["toolchain"], "referenced");
        assert_eq!(decision.value["fields"]["template"], "missing");
        assert_eq!(decision.resolved_paths, decision.value["resolvedPaths"]);
        assert_eq!(
            decision
                .field_states
                .get("source_project")
                .map(String::as_str),
            Some("resolved")
        );

        let unclassified = decision.value["resolvedPaths"]["unclassifiedPaths"]
            .as_array()
            .expect("unclassified array");
        assert_eq!(unclassified.len(), 2, "识别到的路径全部透传给模型归类");
        assert_eq!(decision.unclassified_paths.len(), 2);
    }

    #[test]
    fn parent_dir_path_is_never_resolved() {
        let output = r#"{"taskType": "app_migration", "fields": {
            "source_project": {"state": "resolved", "path": "D:/ws/../secrets"}
        }}"#;
        let decision = build_intent_decision(output).expect("usable analysis");
        assert_eq!(decision.value["fields"]["source_project"], "referenced");
        assert!(decision.value["resolvedPaths"]
            .get("source_project")
            .is_none());
    }

    #[test]
    fn fallback_decision_projects_the_deterministic_analyzer() {
        let decision = fallback_intent_decision("把 D:/workspace/myqt 这个 Qt 工程迁移到鸿蒙");
        assert!(decision.flow_enabled);
        assert_eq!(decision.value["taskType"], "app_migration");
        assert_eq!(
            decision
                .field_states
                .get("source_project")
                .map(String::as_str),
            Some("resolved")
        );
        assert_eq!(
            decision.unclassified_paths,
            vec!["D:/workspace/myqt".to_string()],
            "deterministic extraction keeps unresolved-role paths for model classification"
        );
    }

    #[test]
    fn output_schema_covers_task_types_and_fields() {
        let schema = intent_output_schema();
        let task_enum = schema["properties"]["taskType"]["enum"]
            .as_array()
            .expect("taskType enum");
        assert_eq!(task_enum.len(), TASK_TYPES.len());
        assert!(
            schema["properties"]["fields"]["properties"]["source_project"]
                .get("properties")
                .is_some()
        );
        assert_eq!(schema["required"][0], "taskType");
    }

    #[test]
    fn user_prompt_truncates_long_prompts_and_carries_context() {
        let short = intent_user_prompt("migrate", Some("源工程 /a"));
        assert!(short.contains("User message: migrate"));
        assert!(short.contains("会话迁移上下文：源工程 /a"));

        let long = "x".repeat(PROMPT_MAX_CHARS + 10);
        let prompt = intent_user_prompt(&long, None);
        assert!(prompt.contains(&"x".repeat(PROMPT_MAX_CHARS)));
        assert!(!prompt.contains(&"x".repeat(PROMPT_MAX_CHARS + 1)));
        assert!(!prompt.contains("会话迁移上下文"));
    }

    fn snapshot_with(
        source: Option<&str>,
        status: QtMigrationIntakeStatus,
    ) -> crate::state::QtMigrationIntakeStateSnapshot {
        let mut fields = std::collections::BTreeMap::new();
        for field in QT_MIGRATION_INTAKE_REQUIRED_FIELDS {
            fields.insert(
                field.to_string(),
                QtMigrationIntakeFieldState {
                    state: QtMigrationFieldResolutionState::Resolved,
                    value: source.map(str::to_string),
                },
            );
        }
        crate::state::QtMigrationIntakeStateSnapshot {
            schema_version: 1,
            fields,
            status,
            loaded_skill_receipt: None,
            version_strategy: QtMigrationVersionStrategy::default(),
        }
    }

    #[test]
    fn context_summary_lists_bound_values_only_when_active() {
        let summary = intent_context_summary(&snapshot_with(
            Some("D:/work/myqt"),
            QtMigrationIntakeStatus::Ready,
        ))
        .expect("bound intake has a summary");
        assert!(summary.contains("源工程 D:/work/myqt"));
        assert!(summary.contains("工具链 D:/work/myqt"));

        assert!(
            intent_context_summary(&snapshot_with(None, QtMigrationIntakeStatus::Ready)).is_none()
        );
        assert!(
            intent_context_summary(&snapshot_with(
                Some("D:/work/myqt"),
                QtMigrationIntakeStatus::NotApplicable
            ))
            .is_none(),
            "no active migration intake means no migration context"
        );
    }

    #[test]
    fn instruction_facts_match_the_engine_semantics() {
        // Fully resolved decision: nothing pending when the binding succeeded.
        let value = json!({
            "taskType": "app_migration",
            "secondaryTaskTypes": [],
            "requiresClarification": false,
            "fields": {
                "source_project": "resolved",
                "output_project": "resolved",
                "toolchain": "resolved",
                "template": "resolved",
            },
            "resolvedPaths": {
                "source_project": "D:/a",
                "output_project": "D:/b",
                "toolchain": "D:/c",
                "template": "D:/d",
                "unclassifiedPaths": [],
            },
            "reason": "test",
        });
        let decision = decision_from_analyze_json(value);

        // All bound, no new task: not missing.
        let facts = instruction_facts(&decision, false, true);
        assert_eq!(facts["missing_or_referenced"], false);
        assert_eq!(facts["pending_fields"], "");

        // Binding failed even though the analyzer resolved everything: missing.
        let facts = instruction_facts(&decision, false, false);
        assert_eq!(facts["missing_or_referenced"], true);

        // A new-task prompt during an active migration counts as missing.
        let facts = instruction_facts(&decision, true, true);
        assert_eq!(facts["missing_or_referenced"], true);
    }

    #[test]
    fn instruction_facts_carry_unclassified_paths_and_pending_fields() {
        let output = format!(
            r#"{{"taskType": "app_migration", "fields": {{
                "source_project": {{"state": "referenced", "path": "D:/maybe/qt"}},
                "output_project": {{"state": "missing"}},
                "toolchain": {{"state": "missing"}},
                "template": {{"state": "missing"}}
            }}}}"#
        );
        let decision = build_intent_decision(&output).expect("usable analysis");
        let facts = instruction_facts(&decision, false, true);
        assert_eq!(facts["missing_or_referenced"], true);
        let pending = facts["pending_fields"].as_str().expect("pending fields");
        assert!(pending.contains("source_project"));
        assert!(pending.contains("output_project"));
        assert!(pending.contains("template"));
        let unclassified = facts["unclassified_paths"].as_array().expect("paths");
        assert_eq!(unclassified.len(), 1);
        assert_eq!(unclassified[0], "D:/maybe/qt");
    }
}
