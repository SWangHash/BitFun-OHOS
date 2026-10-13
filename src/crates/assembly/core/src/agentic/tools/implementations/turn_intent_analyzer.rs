//! Turn-intent analysis orchestration: registry dispatch, the per-turn
//! decision cache, and the one structured model call. Domain facts come from
//! the registered [`IntentAnalysisContribution`]; no domain names appear here.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use bitfun_core_types::ModelRequestContext;
use bitfun_runtime_ports::{IntentAnalysisContribution, TurnIntentDecision};

use crate::agentic::coordination::get_global_coordinator;
use crate::agentic::tools::tool_admission::SessionDomainStateStore;
use crate::util::errors::{BitFunError, BitFunResult};

const ANALYSIS_TIMEOUT: Duration = Duration::from_secs(30);
const CACHE_CAPACITY: usize = 512;

/// Analyze one dialog turn's prompt through the intent-analysis contribution
/// registered for `agent_type`: keyword pre-filter → cached structured model
/// call → code validation, falling back to the contribution's deterministic
/// analyzer on any failure. `None` when no contribution is registered for the
/// agent type. Cached per (session, prompt, context-summary) so the
/// coordinator and the execution engine share one verdict per dialog turn.
pub async fn analyze_turn_intent(
    session_id: &str,
    agent_type: &str,
    prompt: &str,
) -> Option<TurnIntentDecision> {
    let registry = crate::agentic::tools::tool_admission::assemble_intent_analysis_registry();
    let contribution = registry.get(agent_type)?;
    if !contribution.has_task_signal(prompt) {
        return Some(contribution.fallback_decision(prompt));
    }
    let coordinator = get_global_coordinator()?;
    let session_manager = coordinator.get_session_manager();
    // The context summary joins the cache key: the same prompt must be
    // re-analyzed when domain state changes.
    let state = SessionDomainStateStore::new(Arc::clone(&session_manager), session_id.to_string());
    let context_summary = contribution.context_summary(&state);
    let key = (
        session_id.to_string(),
        prompt_cache_key(prompt, context_summary.as_deref()),
    );
    if let Some(cached) = cache_get(&key) {
        return Some(cached);
    }
    let decision = match run_intent_completion(
        session_manager,
        session_id,
        contribution.as_ref(),
        prompt,
        context_summary.as_deref(),
    )
    .await
    {
        Ok(output) => contribution
            .build_decision(&output)
            .unwrap_or_else(|| contribution.fallback_decision(prompt)),
        Err(error) => {
            log::warn!(
                "Turn intent analysis failed; falling back to the deterministic analyzer: {error}"
            );
            contribution.fallback_decision(prompt)
        }
    };
    cache_put(&key, &decision);
    Some(decision)
}

fn prompt_cache_key(prompt: &str, context_summary: Option<&str>) -> String {
    let combined = format!("{}\n---ctx---\n{}", prompt, context_summary.unwrap_or(""));
    crate::agentic::execution::edit_constraint_guard::message_sha256(&combined)
}

async fn run_intent_completion(
    session_manager: &Arc<crate::agentic::session::SessionManager>,
    session_id: &str,
    contribution: &dyn IntentAnalysisContribution,
    prompt: &str,
    context_summary: Option<&str>,
) -> BitFunResult<String> {
    let system_prompt = contribution.system_prompt();
    let user_prompt = contribution.user_prompt(prompt, context_summary);
    let request_context = ModelRequestContext {
        output_schema: contribution.output_schema(),
        ..Default::default()
    };
    let future = session_manager.session_quick_completion(
        session_id,
        &system_prompt,
        &user_prompt,
        Some(request_context),
    );
    tokio::time::timeout(ANALYSIS_TIMEOUT, future)
        .await
        .map_err(|_| BitFunError::AIClient("Turn intent analysis timed out".into()))?
}

fn cache_get(key: &(String, String)) -> Option<TurnIntentDecision> {
    INTENT_CACHE.lock().ok()?.0.get(key).cloned()
}

fn cache_put(key: &(String, String), decision: &TurnIntentDecision) {
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

static INTENT_CACHE: LazyLock<
    Mutex<(
        HashMap<(String, String), TurnIntentDecision>,
        VecDeque<(String, String)>,
    )>,
> = LazyLock::new(|| Mutex::new((HashMap::new(), VecDeque::new())));
