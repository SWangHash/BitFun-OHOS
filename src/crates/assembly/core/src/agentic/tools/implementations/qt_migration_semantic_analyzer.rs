//! LLM-backed semantic analysis for Qt migration intake.
//!
//! Layering: keyword pre-filter → per-turn cached LLM call (30s timeout) →
//! code validation → fallback to the deterministic analyzer in
//! [`QtMigrationIntakeTool`]. The LLM only classifies the request and extracts
//! candidate paths; the side-effect gate and input binding stay code-owned and
//! model-independent. Every LLM-produced path is verified against the local
//! filesystem before it may count as `Resolved`.

use crate::agentic::coordination::get_global_coordinator;
use crate::agentic::tools::implementations::qt_migration_intake_tool::{
    has_any_task_signal, QtMigrationIntakeTool,
};
use crate::util::errors::BitFunResult;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

const ANALYSIS_TIMEOUT: Duration = Duration::from_secs(30);
const CACHE_CAPACITY: usize = 512;
const PROMPT_MAX_CHARS: usize = 4000;

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

const SEMANTIC_ANALYZER_SYSTEM_PROMPT: &str = r#"你是 Qt → HarmonyOS(OpenHarmony) 迁移请求的语义分析器。分析用户消息，只输出一个 JSON 对象，不要输出任何其他内容：
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

/// Per-turn decision cache keyed by (session, prompt-hash): the coordinator
/// and the execution engine both need the same verdict within one dialog
/// turn, and the real turn id is not yet assigned when the coordinator runs.
/// Entries are never re-queried after the turn ends, so the cache is bounded.
static INTENT_CACHE: LazyLock<
    Mutex<(HashMap<(String, String), Value>, VecDeque<(String, String)>)>,
> = LazyLock::new(|| Mutex::new((HashMap::new(), VecDeque::new())));

/// Analyze a QtMigration turn prompt: keyword pre-filter → cached LLM call →
/// code validation, falling back to the deterministic analyzer on any failure.
pub async fn analyze_qt_migration_intent(session_id: &str, prompt: &str) -> Value {
    if !has_any_task_signal(prompt) {
        return fallback_decision(prompt);
    }
    // The migration context summary participates in the cache key: the same
    // prompt must be re-analyzed when the intake state changes (e.g. the same
    // wording means "keep going" only after a migration has run).
    let context_summary = session_migration_context_summary(session_id);
    let key = (
        session_id.to_string(),
        prompt_cache_key(prompt, context_summary.as_deref()),
    );
    if let Some(cached) = cache_get(&key) {
        return cached;
    }
    let decision = match run_llm_analysis(session_id, prompt, context_summary.as_deref()).await {
        Ok(output) => {
            build_decision_from_llm_output(&output).unwrap_or_else(|| fallback_decision(prompt))
        }
        Err(error) => {
            log::warn!(
                "Qt migration LLM intent analysis failed; falling back to the deterministic analyzer: {error}"
            );
            fallback_decision(prompt)
        }
    };
    cache_put(&key, &decision);
    decision
}

fn prompt_cache_key(prompt: &str, context_summary: Option<&str>) -> String {
    let combined = format!("{}\n---ctx---\n{}", prompt, context_summary.unwrap_or(""));
    crate::agentic::execution::edit_constraint_guard::message_sha256(&combined)
}

fn fallback_decision(prompt: &str) -> Value {
    QtMigrationIntakeTool::analyze_request(prompt)
}

/// Summary of the session's current/last migration task from the intake
/// snapshot. `None` when the session has no activated migration intake.
fn session_migration_context_summary(session_id: &str) -> Option<String> {
    let coordinator = get_global_coordinator()?;
    let session_manager = coordinator.get_session_manager();
    let intake = session_manager.qt_migration_intake_state(session_id)?;
    if intake.status
        == bitfun_agent_runtime::qt_migration_intake_state::QtMigrationIntakeStatus::NotApplicable
    {
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

async fn run_llm_analysis(
    session_id: &str,
    prompt: &str,
    context_summary: Option<&str>,
) -> BitFunResult<String> {
    let coordinator = get_global_coordinator().ok_or_else(|| {
        crate::util::errors::BitFunError::AIClient("Coordinator unavailable".into())
    })?;
    let truncated = if prompt.chars().count() > PROMPT_MAX_CHARS {
        prompt.chars().take(PROMPT_MAX_CHARS).collect::<String>()
    } else {
        prompt.to_string()
    };
    let session_manager = coordinator.get_session_manager();
    let user_prompt = match context_summary {
        Some(summary) => {
            format!("User message: {truncated}\n\n会话迁移上下文：{summary}\n\n请输出 JSON：")
        }
        None => format!("User message: {truncated}\n\n请输出 JSON："),
    };
    let future = session_manager.session_quick_completion(
        session_id,
        SEMANTIC_ANALYZER_SYSTEM_PROMPT,
        &user_prompt,
    );
    tokio::time::timeout(ANALYSIS_TIMEOUT, future)
        .await
        .map_err(|_| {
            crate::util::errors::BitFunError::AIClient(
                "Qt migration intent analysis timed out".into(),
            )
        })?
}

/// Validate the LLM output and assemble the decision JSON (same shape as
/// [`QtMigrationIntakeTool::analyze_request`]). Returns `None` when the output
/// is not a usable analysis so the caller can fall back.
pub(crate) fn build_decision_from_llm_output(output: &str) -> Option<Value> {
    let parsed = parse_json_payload(output)?;
    let task_type = parsed.get("taskType")?.as_str()?;
    if !TASK_TYPES.contains(&task_type) {
        return None;
    }
    let fields_input = parsed.get("fields")?;

    let mut fields = serde_json::Map::new();
    let mut resolved_paths = serde_json::Map::new();
    let mut unclassified: Vec<Value> = Vec::new();
    for field in ["source_project", "output_project", "toolchain", "template"] {
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
            _ => "missing",
        };
        fields.insert(field.to_string(), json!(normalized));
    }
    resolved_paths.insert("unclassifiedPaths".to_string(), json!(unclassified));

    Some(json!({
        "taskType": task_type,
        "secondaryTaskTypes": [],
        "requiresClarification": task_type == "ambiguous",
        "fields": Value::Object(fields),
        "resolvedPaths": Value::Object(resolved_paths),
        "reason": format!("LLM 语义分析：{}。", task_type),
        "source": "llm",
    }))
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

fn cache_get(key: &(String, String)) -> Option<Value> {
    INTENT_CACHE.lock().ok()?.0.get(key).cloned()
}

fn cache_put(key: &(String, String), decision: &Value) {
    let mut guard = match INTENT_CACHE.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    if guard.0.len() >= CACHE_CAPACITY {
        if let Some(oldest) = guard.1.pop_front() {
            guard.0.remove(&oldest);
        }
    }
    guard.1.push_back(key.clone());
    guard.0.insert(key.clone(), decision.clone());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_fence_and_prose_are_stripped() {
        let output =
            "分析结果如下：\n```json\n{\"taskType\": \"other\", \"fields\": {}}\n```\n以上。";
        let decision = build_decision_from_llm_output(output).expect("usable analysis");
        assert_eq!(decision["taskType"], "other");
    }

    #[test]
    fn invalid_task_type_falls_back() {
        let output = r#"{"taskType": "deploy_to_mars", "fields": {}}"#;
        assert!(build_decision_from_llm_output(output).is_none());
    }

    #[test]
    fn broken_json_falls_back() {
        assert!(build_decision_from_llm_output("不是 JSON").is_none());
        assert!(build_decision_from_llm_output("{\"taskType\":").is_none());
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

        let decision = build_decision_from_llm_output(&output).expect("usable analysis");
        assert_eq!(decision["fields"]["source_project"], "resolved");
        assert_eq!(
            decision["resolvedPaths"]["source_project"].as_str(),
            Some(path.to_string_lossy().replace('\\', "/").as_str())
        );
        assert_eq!(decision["fields"]["output_project"], "referenced");
        assert_eq!(decision["fields"]["toolchain"], "referenced");
        assert_eq!(decision["fields"]["template"], "missing");

        let unclassified = decision["resolvedPaths"]["unclassifiedPaths"]
            .as_array()
            .expect("unclassified array");
        assert_eq!(unclassified.len(), 2, "识别到的路径全部透传给模型归类");
    }

    #[test]
    fn parent_dir_path_is_never_resolved() {
        let output = r#"{"taskType": "app_migration", "fields": {
            "source_project": {"state": "resolved", "path": "D:/ws/../secrets"}
        }}"#;
        let decision = build_decision_from_llm_output(output).expect("usable analysis");
        assert_eq!(decision["fields"]["source_project"], "referenced");
        assert!(decision["resolvedPaths"].get("source_project").is_none());
    }
}
