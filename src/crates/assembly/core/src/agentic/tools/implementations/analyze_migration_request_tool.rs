//! AnalyzeMigrationRequest tool implementation.
//!
//! Routes a Qt -> HarmonyOS request. It returns a structured
//! `taskType` (aligned with `ohos-qt-skills/_index/_task-routing.md`), a
//! per-field minimum-input state for the four migration fields, secondary
//! tasks for compound requests, and an `ambiguous` result instead of force
//! mapping unclear requests to `app_migration`.
//!
//! Classification rules:
//! - `app_migration` requires Qt 语境 AND 迁移动作 AND HarmonyOS 目标, matched
//!   with English word boundaries (no `report`/`portable`/`viewport` hits);
//! - compound requests keep the primary task by fixed priority and expose
//!   `secondaryTaskTypes`;
//! - field states are produced INDEPENDENTLY for the four inputs and never
//!   share a path-token decision. The analyzer only goes up to "resolved"
//!   (string layer); `validated` is produced by the execution boundary.
//!
//! The analyzer is a pure, synchronous function
//! ([`AnalyzeMigrationRequestTool::analyze_request`]) so the turn-level gate in
//! the execution engine can reuse it without constructing a `ToolUseContext`.
//! The same logic is also exposed as a normal (read-only, no-UI) tool.

use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::util::errors::BitFunResult;
use async_trait::async_trait;
use serde_json::{json, Value};

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

/// Field-level resolution produced by the string-layer analyzer. The value
/// "validated" is intentionally absent here (execution boundary's job).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldLevel {
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

/// AnalyzeMigrationRequest tool - routes a Qt migration request.
pub struct AnalyzeMigrationRequestTool;

impl Default for AnalyzeMigrationRequestTool {
    fn default() -> Self {
        Self::new()
    }
}

impl AnalyzeMigrationRequestTool {
    pub fn new() -> Self {
        Self
    }

    /// Full decision: taskType + per-field minimum-input state.
    pub fn analyze_request(request: &str) -> Value {
        let (task_type, secondary, requires_clarification, fields, reason) =
            analyze_internal(request);
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

fn has_any_task_signal(text: &str) -> bool {
    has_qt_context(text) || has_migration_action(text) || has_harmonyos_target(text)
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
        let cleaned = token.trim_matches(|c: char| "。，,;；：:\"'()[]{}".contains(c));
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
/// Rules:
/// - bare keywords with no binding stay `Missing` (placeholder words such as
///   "官方工具链" are not references);
/// - a concrete absolute path / registered-ID-like token -> `Resolved`;
/// - a domainful mention with a real name but no bindable value -> `Referenced`.
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
        }
    }
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

#[async_trait]
impl Tool for AnalyzeMigrationRequestTool {
    fn name(&self) -> &str {
        "AnalyzeMigrationRequest"
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok(r#"Analyze a user request to classify the Qt / HarmonyOS task type (app_migration, api_mapping, module_support, build_troubleshooting, window_issue, lifecycle, third_party_dependency, toolchain_setup, demo_generation, ambiguous, other) and the per-field minimum-input state for the four migration fields (source_project / output_project / toolchain / template). Use during Qt migration intake to decide whether to ask the user for missing path configuration via AskUserQuestion, or to proceed when inputs are present.

app_migration requires Qt context AND a migration action AND a HarmonyOS/OpenHarmony target. Compound requests return a primary task plus a secondaryTaskTypes list; unclear requests return taskType=ambiguous with requiresClarification=true."#
            .to_string())
    }

    fn short_description(&self) -> String {
        "Route a Qt/HarmonyOS request: taskType + per-field input state.".to_string()
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "request": {
                    "type": "string",
                    "description": "The user's raw request text to analyze."
                }
            },
            "required": ["request"],
            "additionalProperties": false
        })
    }

    fn is_readonly(&self) -> bool {
        true
    }

    fn is_concurrency_safe(&self, _input: Option<&Value>) -> bool {
        true
    }

    async fn call_impl(
        &self,
        input: &Value,
        _context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let request = input
            .get("request")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let data = Self::analyze_request(request);
        let result_for_assistant = data["reason"].as_str().unwrap_or_default().to_string();

        Ok(vec![ToolResult::Result {
            data,
            result_for_assistant: Some(result_for_assistant),
            image_attachments: None,
        }])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let d = AnalyzeMigrationRequestTool::analyze_request(
            "请我帮你把 Qt 工程搬到鸿蒙化，并且编译构建，部署，验证",
        );
        assert_eq!(d["taskType"], "app_migration");
        assert_eq!(d["requiresClarification"], false);
        let (source, output, _tc, _tp) = fields_of(&d);
        assert_eq!(source, FieldLevel::Missing);
        assert_eq!(output, FieldLevel::Missing);
    }

    #[test]
    fn full_english_migration_request_is_app_migration() {
        let d = AnalyzeMigrationRequestTool::analyze_request(
            "Migrate my Qt 5.15 project to OpenHarmony and build it.",
        );
        assert_eq!(d["taskType"], "app_migration");
    }

    #[test]
    fn port_substring_collisions_do_not_trigger_migration() {
        // `report`, `portable`, `viewport`, `support` must not match `port`.
        let d = AnalyzeMigrationRequestTool::analyze_request(
            "Why does my portable report render wrong?",
        );
        assert_ne!(d["taskType"], "app_migration");
        let d2 =
            AnalyzeMigrationRequestTool::analyze_request("The viewport is broken on this page.");
        assert_ne!(d2["taskType"], "app_migration");
    }

    #[test]
    fn qt_only_query_routes_to_module_support_not_migration() {
        let d = AnalyzeMigrationRequestTool::analyze_request("Qt6 在鸿蒙上支持哪些模块？");
        assert_eq!(d["taskType"], "module_support");
        assert_ne!(d["taskType"], "app_migration");
    }

    #[test]
    fn build_troubleshooting_without_migration_action_is_not_migration() {
        let d = AnalyzeMigrationRequestTool::analyze_request("Qt 工程编译失败，帮我排查");
        assert_eq!(d["taskType"], "build_troubleshooting");
    }

    #[test]
    fn compound_request_keeps_primary_and_secondary() {
        let d = AnalyzeMigrationRequestTool::analyze_request(
            "把这个 Qt 工程迁移到鸿蒙，并且解决现有编译错误",
        );
        assert_eq!(d["taskType"], "app_migration");
        assert!(d["secondaryTaskTypes"]
            .as_array()
            .expect("secondary keys array")
            .iter()
            .any(|v| v == "build_troubleshooting"));
    }

    #[test]
    fn harmonyos_only_mentions_are_ambiguous() {
        let d = AnalyzeMigrationRequestTool::analyze_request("鸿蒙上这个怎么处理？");
        assert_eq!(d["taskType"], "ambiguous");
        assert_eq!(d["requiresClarification"], true);
    }

    #[test]
    fn unrelated_request_is_other() {
        let d = AnalyzeMigrationRequestTool::analyze_request("帮我重构一下这个模块的接口设计");
        assert_eq!(d["taskType"], "other");
    }

    #[test]
    fn single_absolute_path_does_not_satisfy_output() {
        let d = AnalyzeMigrationRequestTool::analyze_request(
            "把 D:/workspace/myqt 这个 Qt 工程迁移到鸿蒙",
        );
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
    fn output_anchor_binds_path_to_output() {
        let d = AnalyzeMigrationRequestTool::analyze_request(
            "把 D:/workspace/myqt 迁移到鸿蒙，输出到 D:/out",
        );
        let (source, output, _tc, _tp) = fields_of(&d);
        assert_eq!(source, FieldLevel::Resolved);
        assert_eq!(output, FieldLevel::Resolved);
    }

    #[test]
    fn bare_keyword_toolchain_stays_missing_or_referenced_not_resolved() {
        // "官方工具链" is a placeholder word with no bindable value.
        let d =
            AnalyzeMigrationRequestTool::analyze_request("把 D:/proj 迁移到鸿蒙，使用官方工具链");
        assert_eq!(d["fields"]["toolchain"], "referenced");
        assert_ne!(d["fields"]["toolchain"], "resolved");
    }

    #[test]
    fn bound_toolchain_path_resolves() {
        let d = AnalyzeMigrationRequestTool::analyze_request(
            "把 D:/proj 迁移到鸿蒙，工具链用 D:/sdk/ohos",
        );
        assert_eq!(d["fields"]["toolchain"], "resolved");
    }

    #[test]
    fn incomplete_migration_semantics_remain_ordinary_requests() {
        for request in ["将QT工程迁移", "把工程迁移成鸿蒙工程", "看看这个Qt工程"]
        {
            let decision = AnalyzeMigrationRequestTool::analyze_request(request);
            assert_ne!(decision["taskType"], "app_migration", "request: {request}");
        }
    }

    #[test]
    fn complete_migration_semantics_are_app_migration() {
        let decision = AnalyzeMigrationRequestTool::analyze_request("将QT工程迁移成鸿蒙工程");
        assert_eq!(decision["taskType"], "app_migration");
    }

    #[test]
    fn ohos_is_a_harmonyos_target() {
        let decision = AnalyzeMigrationRequestTool::analyze_request("将QT工程迁移成OHOS工程");
        assert_eq!(decision["taskType"], "app_migration");
    }
}
