use super::{common, OpenAIMessageConverter};
use crate::client::quirks::should_append_tool_stream;
use crate::client::sse::execute_sse_request;
use crate::client::{AIClient, StreamResponse};
use crate::providers::shared;
use crate::stream::handle_openai_stream;
use crate::trace::ModelExchangeTraceConfig;
use crate::types::{Message, ModelRequestContext, ToolDefinition};
use anyhow::Result;
use log::{debug, warn};

fn try_build_request_body_with_context(
    client: &AIClient,
    url: &str,
    openai_messages: Vec<serde_json::Value>,
    openai_tools: Option<Vec<serde_json::Value>>,
    extra_body: Option<serde_json::Value>,
    request_context: Option<&ModelRequestContext>,
) -> Result<serde_json::Value> {
    // Some OpenAI-compatible endpoints (the on-device model foundation
    // service, local inference servers) reject messages whose `content` is
    // null or absent even when tool_calls carry the payload — the OpenAI
    // spec allows null content for assistant tool-call messages, but strict
    // implementations require a string. Normalize every message to carry an
    // empty-string content when it has none so all endpoints accept the body.
    //
    // Role normalization and field stripping are ONLY applied to local
    // endpoints: cloud providers fully support the OpenAI spec (tool role,
    // tool_calls, name, tool_call_id), and stripping those would break
    // tool-calling conversations on every cloud model.
    let is_local_endpoint = shared::is_local_inference_endpoint(client, url);
    let openai_messages = if is_local_endpoint {
        // Local inference services have small context windows (4K–8K tokens
        // for on-device 7B/8B models) and do NOT report context overflow as
        // an HTTP error — they return an empty SSE stream instead, which the
        // round executor sees as "no effective output". Truncate the history
        // before normalization so the request stays within the window.
        //
        // The assembled agent system prompt (role definition, skills
        // catalogs, tool instructions) alone fills most of that window and
        // is useless to the on-device model: the strict service implements
        // no tool-calling protocol, so the model cannot act on skills or
        // tool schemas. Replace it with a compact local-specific prompt and
        // let the truncation budget go to conversation history instead.
        let prepared = prepare_messages_for_local_context(openai_messages);
        let truncated = truncate_messages_for_local_context(prepared);
        normalize_message_content(truncated)
    } else {
        // Cloud endpoints: only fill null/missing content (harmless).
        normalize_message_content_cloud(openai_messages)
    };

    let mut request_body = serde_json::json!({
        "model": client.config.model,
        "messages": openai_messages,
        "stream": true,
    });
    // OpenAI Chat Completions does not return usage in stream chunks unless
    // explicitly requested. Without this, token usage shows "Unavailable"
    // for every OpenAI-compatible endpoint. The on-device model foundation
    // service does not support `stream_options` (its request validation
    // rejects unknown top-level fields), so only cloud endpoints get it.
    if !is_local_endpoint {
        request_body["stream_options"] = serde_json::json!({ "include_usage": true });
    }

    let model_name = client.config.model.to_lowercase();

    if should_append_tool_stream(url, &model_name) {
        request_body["tool_stream"] = serde_json::Value::Bool(true);
    }

    let base_reasoning_fields = shared::capture_reasoning_fields(
        &request_body,
        &["thinking", "enable_thinking", "reasoning_effort"],
        &[],
    );

    if let Some(max_tokens) = client.config.max_tokens {
        // The on-device model foundation service only accepts
        // `max_completion_tokens`, while some cloud providers only recognize
        // the standard `max_tokens`. Use the field name each endpoint family
        // understands.
        let key = if is_local_endpoint { "max_completion_tokens" } else { "max_tokens" };
        request_body[key] = serde_json::json!(max_tokens);
    }

    let protected_keys = &[
        "model",
        "messages",
        "stream",
        "stream_options",
        "max_tokens",
        "max_completion_tokens",
        "tool_stream",
        "tools",
    ];
    if let Some(preset) = client.model_reasoning_preset.as_ref() {
        shared::apply_reasoning_actions(
            preset,
            &mut request_body,
            protected_keys,
            &[],
            |action, body| {
                common::compile_chat_reasoning_action(
                    preset,
                    action,
                    body,
                    url,
                    &client.config.model,
                )
            },
        )?;
    }

    let protected_body = shared::protect_request_body(
        client,
        &mut request_body,
        &["model", "messages", "stream", "stream_options", "max_tokens", "max_completion_tokens", "tool_stream"],
        &[],
    );

    if let Some(extra) = extra_body {
        if let Some(extra_obj) = extra.as_object() {
            shared::merge_extra_body(&mut request_body, extra_obj);
            shared::log_extra_body_keys("ai::openai_stream_request", extra_obj);
        }
    }

    shared::restore_protected_body(&mut request_body, protected_body);
    if let Some(preset) = client.selected_reasoning_preset.as_ref() {
        shared::reset_reasoning_fields(
            &mut request_body,
            base_reasoning_fields.as_ref(),
            &["thinking", "enable_thinking", "reasoning_effort"],
            &[],
        );
        shared::apply_reasoning_actions(
            preset,
            &mut request_body,
            protected_keys,
            &[],
            |action, body| {
                common::compile_chat_reasoning_action(
                    preset,
                    action,
                    body,
                    url,
                    &client.config.model,
                )
            },
        )?;
    }

    if let Some(request_obj) = request_body.as_object_mut() {
        if let Some(existing_n) = request_obj.remove("n") {
            warn!(
                target: "ai::openai_stream_request",
                "Removed custom request field n={} because the stream processor only handles the first choice",
                existing_n
            );
        }
    }
    if let Some(schema) = request_context.and_then(|context| context.output_schema.as_ref()) {
        request_body["response_format"] = serde_json::json!({
            "type": "json_schema",
            "json_schema": {
                "name": "bitfun_output",
                "strict": true,
                "schema": schema
            }
        });
    }

    shared::log_request_body(
        "ai::openai_stream_request",
        "OpenAI stream request body (excluding tools):",
        &request_body,
    );

    common::attach_tools(
        &mut request_body,
        // The strict on-device service implements no tool-calling protocol:
        // tool schemas would be ignored noise and displace conversation
        // history from the small context window. Only cloud endpoints
        // receive tools.
        if is_local_endpoint { None } else { openai_tools },
        "ai::openai_stream_request",
    );

    Ok(request_body)
}

pub(crate) fn try_build_request_body(
    client: &AIClient,
    url: &str,
    openai_messages: Vec<serde_json::Value>,
    openai_tools: Option<Vec<serde_json::Value>>,
    extra_body: Option<serde_json::Value>,
) -> Result<serde_json::Value> {
    try_build_request_body_with_context(
        client,
        url,
        openai_messages,
        openai_tools,
        extra_body,
        None,
    )
}

/// Compact system prompt that replaces the assembled agent prompt for local
/// endpoints. The full agent prompt (role definition, skills catalogs, tool
/// instructions) is sized for frontier models with large windows; the
/// on-device service implements no tool-calling protocol, so skills and tool
/// schemas are dead weight here. Tool RESULTS still reach the model inside
/// user messages (the role normalization maps tool turns to user).
const LOCAL_SYSTEM_PROMPT: &str = "You are the BitFun coding assistant running fully on this device. \
Reply in the user's language, concisely and correctly. \
Earlier conversation may be summarized or omitted because the on-device context window is small; \
if important details are missing, ask the user briefly. \
Tool results, when present, appear inside user messages.";

/// Replaces the assembled agent system prompt with the compact local one and
/// drops tool definitions for local endpoints (see `LOCAL_SYSTEM_PROMPT`).
/// Harness reminders appended to conversation turns (`<system_reminder>`
/// Tool Calling Guide / Skill Listing / Agent Listing, plus the legacy
/// hyphenated form) are stripped as well: the on-device model cannot act on
/// any of them, and user messages that end up empty after the strip are
/// removed entirely so strict local servers never see blank turns.
/// Cloud endpoints never run this.
fn prepare_messages_for_local_context(mut messages: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    if let Some(first) = messages.first_mut() {
        if first.get("role").and_then(|r| r.as_str()) == Some("system") {
            first["content"] = serde_json::Value::String(LOCAL_SYSTEM_PROMPT.to_string());
        }
    }
    for message in messages.iter_mut().skip(1) {
        strip_message_system_reminders(message);
    }
    messages.retain(|message| !is_blank_user_message(message));
    messages
}

const SYSTEM_REMINDER_OPEN: &str = "<system_reminder>";
const SYSTEM_REMINDER_CLOSE: &str = "</system_reminder>";
const SYSTEM_REMINDER_OPEN_LEGACY: &str = "<system-reminder>";
const SYSTEM_REMINDER_CLOSE_LEGACY: &str = "</system-reminder>";

/// Removes every `<tag>…</tag>` span for the given tag pair. Unclosed spans
/// are kept verbatim (never truncate a message on malformed markup).
fn remove_tag_spans(text: &str, opening: &str, closing: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    loop {
        let Some(start) = rest.find(opening) else {
            out.push_str(rest);
            break;
        };
        let after_opening = &rest[start + opening.len()..];
        let Some(close_rel) = after_opening.find(closing) else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..start]);
        rest = &after_opening[close_rel + closing.len()..];
    }
    out
}

fn strip_system_reminder_spans(text: &str) -> String {
    remove_tag_spans(
        &remove_tag_spans(text, SYSTEM_REMINDER_OPEN, SYSTEM_REMINDER_CLOSE),
        SYSTEM_REMINDER_OPEN_LEGACY,
        SYSTEM_REMINDER_CLOSE_LEGACY,
    )
}

fn strip_message_system_reminders(message: &mut serde_json::Value) {
    let Some(content) = message.get_mut("content") else {
        return;
    };
    match content {
        serde_json::Value::String(text) => {
            *content = serde_json::Value::String(strip_system_reminder_spans(text));
        }
        serde_json::Value::Array(parts) => {
            for part in parts.iter_mut() {
                if let Some(text) = part.get("text").and_then(serde_json::Value::as_str) {
                    let stripped = strip_system_reminder_spans(text);
                    part["text"] = serde_json::Value::String(stripped);
                }
            }
        }
        _ => {}
    }
}

fn is_blank_user_message(message: &serde_json::Value) -> bool {
    message.get("role").and_then(serde_json::Value::as_str) == Some("user")
        && message
            .get("content")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|content| content.trim().is_empty())
}

/// Truncates messages so the total stays within a local model's context
/// window. On-device inference services (hmmodelfoundation) do not report
/// context overflow as a 400 error — they silently return an empty SSE
/// stream, which the round executor interprets as "no effective output"
/// and retries in a futile loop. This function estimates the token cost
/// (chars ≈ tokens for CJK, chars/4 ≈ tokens for ASCII as a rough
/// heuristic) and drops the oldest non-system messages until the request
/// fits. The system prompt is always kept (it defines the agent's role);
/// the most recent messages are kept (they carry the active context).
///
/// The budget leaves headroom for the model's output: typical 7B/8B local
/// models have 4K–8K context windows, so we target ~4K tokens of input
/// and leave the rest for generation.
fn truncate_messages_for_local_context(messages: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    // Rough token budget for the input (prompt). A 7B/8B local model
    // typically has a 4K–8K token window; leave half for output.
    const LOCAL_CONTEXT_TOKEN_BUDGET: usize = 4096;
    // The BitFun agent system prompt is far larger than a local model's
    // window can carry while leaving room for history. Cap its estimated
    // share (keeping the head and tail sections) so conversation history
    // survives; without this the prompt alone consumed the whole budget and
    // the model received no history at all — its own reasoning would then
    // report that the user has no earlier messages.
    const LOCAL_SYSTEM_PROMPT_TOKEN_CAP: usize = 1200;

    // Always keep the first message if it is the system prompt.
    let mut result: Vec<serde_json::Value> = Vec::new();
    let mut remaining = messages;

    // Extract the system prompt (first message if role == "system").
    if let Some(first) = remaining.first() {
        if first.get("role").and_then(|r| r.as_str()) == Some("system") {
            let mut system = remaining.remove(0);
            cap_system_prompt(&mut system, LOCAL_SYSTEM_PROMPT_TOKEN_CAP);
            result.push(system);
        }
    }

    // Estimate the system prompt cost.
    let mut used_tokens: usize = result
        .iter()
        .map(|msg| estimate_message_tokens(msg))
        .sum();

    // Walk the remaining messages from newest to oldest, accumulating until
    // the budget is exhausted, then keep only what fits. The newest message
    // is the active input and is always kept: in long multi-round sessions
    // it can exceed the remaining budget on its own (a large tool result or
    // user input), and dropping it produced a system-only payload that
    // strict local servers reject with "the last 'message.role' must be
    // 'user'". When it does not fit, its content is capped instead.
    let history_len = remaining.len();
    let mut kept: Vec<serde_json::Value> = Vec::new();
    if let Some(mut newest) = remaining.pop() {
        let headroom = LOCAL_CONTEXT_TOKEN_BUDGET.saturating_sub(used_tokens);
        if estimate_message_tokens(&newest) > headroom {
            cap_message_content(&mut newest, headroom);
        }
        used_tokens = used_tokens.saturating_add(estimate_message_tokens(&newest));
        kept.push(newest);
    }
    for msg in remaining.into_iter().rev() {
        let cost = estimate_message_tokens(&msg);
        if used_tokens + cost > LOCAL_CONTEXT_TOKEN_BUDGET {
            break;
        }
        used_tokens += cost;
        kept.push(msg);
    }
    kept.reverse();

    log::debug!(
        "Local context truncation: system={} tokens, kept {} of {} history messages, used={} of {}",
        result.first().map(estimate_message_tokens).unwrap_or(0),
        kept.len(),
        history_len,
        used_tokens,
        LOCAL_CONTEXT_TOKEN_BUDGET
    );

    result.extend(kept);
    result
}

/// Caps the agent system prompt to `cap_tokens` estimated tokens. The head
/// (role definition) and the tail (output format and final rules) carry the
/// most load-bearing instructions, so both are kept around an explicit
/// truncation marker. Char-based: one CJK character ≈ one token, so capping
/// the character count caps the estimate.
fn cap_system_prompt(message: &mut serde_json::Value, cap_tokens: usize) {
    let Some(content) = message.get_mut("content") else {
        return;
    };
    let Some(text) = content.as_str() else {
        return;
    };
    if estimate_text_tokens(text) <= cap_tokens {
        return;
    }
    let max_chars = cap_tokens.max(64);
    let head_chars = max_chars * 6 / 10;
    let tail_chars = max_chars - head_chars;
    let head = cap_at_char_boundary(text, head_chars);
    let tail: String = text
        .chars()
        .rev()
        .take(tail_chars)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let marker = "\n\n…[system prompt truncated]…\n\n";
    *content = serde_json::Value::String(format!("{head}{marker}{tail}"));
}

/// Caps a message's content so the message fits into `headroom_tokens`.
/// String content is truncated in place; non-string content (arrays,
/// objects) is replaced with a capped JSON serialization — the local
/// normalization flattens arrays to text afterwards, so a serialized
/// preview preserves the useful gist. A floor keeps a minimum usable
/// snippet even when the system prompt consumed nearly the whole budget.
fn cap_message_content(message: &mut serde_json::Value, headroom_tokens: usize) {
    const MIN_CONTENT_CHARS: usize = 256;
    let max_chars = headroom_tokens.max(MIN_CONTENT_CHARS);
    let Some(content) = message.get_mut("content") else {
        return;
    };
    match content.as_str() {
        Some(text) => {
            if text.chars().count() > max_chars {
                *content = serde_json::Value::String(cap_at_char_boundary(text, max_chars));
            }
        }
        None => {
            if !content.is_null() {
                let serialized = content.to_string();
                if serialized.chars().count() > max_chars {
                    *content =
                        serde_json::Value::String(cap_at_char_boundary(&serialized, max_chars));
                }
            }
        }
    }
}

fn cap_at_char_boundary(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    text.chars().take(max_chars).collect()
}

/// Rough token estimate for a single message. Mixed-script heuristic: one
/// CJK character ≈ one token, four other characters ≈ one token. Non-string
/// content (arrays, objects) is estimated from its serialized form, which
/// mirrors what the flattening normalization will produce — a flat estimate
/// would let a huge tool-result array slip past the budget and overflow the
/// window.
fn estimate_message_tokens(message: &serde_json::Value) -> usize {
    let Some(content) = message.get("content") else {
        return 1;
    };
    match content.as_str() {
        Some(text) => estimate_text_tokens(text),
        None => {
            if content.is_null() {
                1
            } else {
                estimate_text_tokens(&content.to_string())
            }
        }
    }
}

fn estimate_text_tokens(text: &str) -> usize {
    let mut cjk = 0usize;
    let mut other = 0usize;
    for ch in text.chars() {
        if is_cjk_char(ch) {
            cjk += 1;
        } else {
            other += 1;
        }
    }
    (cjk + (other + 3) / 4).max(1)
}

fn is_cjk_char(ch: char) -> bool {
    matches!(ch as u32,
        0x3000..=0x303F   // CJK punctuation
        | 0x3040..=0x30FF // kana
        | 0x4E00..=0x9FFF // CJK unified ideographs
        | 0xF900..=0xFAFF // compatibility ideographs
        | 0xFF00..=0xFFEF // fullwidth forms
    )
}

#[cfg(test)]
pub(crate) fn build_request_body(
    client: &AIClient,
    url: &str,
    openai_messages: Vec<serde_json::Value>,
    openai_tools: Option<Vec<serde_json::Value>>,
    extra_body: Option<serde_json::Value>,
) -> serde_json::Value {
    try_build_request_body(client, url, openai_messages, openai_tools, extra_body)
        .expect("request body should compile")
}

/// Cloud-safe normalization: only fills null or missing `content` with an
/// empty string. All other fields (tool_calls, name, tool_call_id,
/// reasoning_content) are preserved intact because cloud providers fully
/// support the OpenAI spec. Content arrays that carry only text parts are
/// flattened to a joined string, while multimodal arrays (image_url blocks
/// for computer-use screenshots and user attachments) are preserved
/// verbatim — flattening them would silently drop the images and the
/// cloud vision model would never see them. Roles and extensions are left
/// alone.
fn normalize_message_content_cloud(messages: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    messages
        .into_iter()
        .map(|mut message| {
            if let Some(obj) = message.as_object_mut() {
                let content = obj.get("content").cloned();
                let normalized_content = match content {
                    Some(serde_json::Value::Array(items)) => {
                        let is_text_only = items.iter().all(|item| {
                            matches!(
                                item.get("type").and_then(serde_json::Value::as_str),
                                None | Some("text")
                            )
                        });
                        if is_text_only {
                            let text = items
                                .iter()
                                .filter_map(|item| {
                                    item.get("text")
                                        .and_then(|text| text.as_str())
                                        .map(|text| text.to_string())
                                })
                                .collect::<Vec<_>>()
                                .join("\n");
                            serde_json::Value::String(text)
                        } else {
                            serde_json::Value::Array(items)
                        }
                    }
                    Some(value) if value.is_string() => value,
                    _ => serde_json::Value::String(String::new()),
                };
                obj.insert("content".to_string(), normalized_content);
            }
            message
        })
        .collect()
}

/// Normalizes messages for strict OpenAI-compatible servers. The on-device
/// model foundation service validates more tightly than the OpenAI spec:
/// 1. `content` must be a present, non-null string — tool-call assistant
///    messages with null content and Anthropic-style content-block arrays
///    are rejected.
/// 2. `tool` / `function` roles are rejected — the service only accepts
///    system (first message), user, and assistant. Tool results become
///    user messages carrying the tool output in-band.
/// 3. Provider-specific fields (tool_calls, reasoning_content,
///    thinking_signature) are not understood and may cause validation
///    errors on strict servers.
///
/// Content arrays (from Anthropic/Gemini conversations) are flattened to
/// their text content. The `system` role is preserved — the on-device
/// service supports it for the first message (confirmed by device testing:
/// a fresh session with a system prompt + user message returns normally).
fn normalize_message_content(messages: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    // Only role and content survive on the wire; name and tool_call_id
    // are not supported by strict local servers.
    const ALLOWED_FIELDS: &[&str] = &["role", "content"];

    messages
        .into_iter()
        .map(|mut message| {
            if let Some(obj) = message.as_object_mut() {
                // Content normalization: flatten arrays, fill null/missing.
                let content = obj.get("content").cloned();
                let normalized_content = match content {
                    // Anthropic-style content blocks: extract text parts.
                    Some(serde_json::Value::Array(items)) => {
                        let text = items
                            .iter()
                            .filter_map(|item| {
                                item.get("text")
                                    .and_then(|text| text.as_str())
                                    .map(|text| text.to_string())
                            })
                            .collect::<Vec<_>>()
                            .join("\n");
                        serde_json::Value::String(text)
                    }
                    // Already a string — keep it.
                    Some(value) if value.is_string() => value,
                    // Null, missing, or unexpected shape — empty string.
                    _ => serde_json::Value::String(String::new()),
                };
                obj.insert("content".to_string(), normalized_content);

                // Role normalization: only tool/function results need to
                // become user messages. System stays — the on-device
                // service accepts it (device-tested).
                let needs_role_fix = obj
                    .get("role")
                    .and_then(|role| role.as_str())
                    .map(|role| role == "tool" || role == "function")
                    .unwrap_or(false);
                if needs_role_fix {
                    obj.insert(
                        "role".to_string(),
                        serde_json::Value::String("user".to_string()),
                    );
                }

                // Strip provider-specific extension fields that strict
                // servers may reject (tool_calls, reasoning_content,
                // thinking_signature, tool_image_attachments, etc.).
                obj.retain(|key, _| ALLOWED_FIELDS.contains(&key.as_str()));
            }
            message
        })
        .collect()
}

#[cfg(test)]
pub(crate) fn build_request_body_with_context(
    client: &AIClient,
    url: &str,
    openai_messages: Vec<serde_json::Value>,
    openai_tools: Option<Vec<serde_json::Value>>,
    extra_body: Option<serde_json::Value>,
    request_context: Option<&ModelRequestContext>,
) -> serde_json::Value {
    try_build_request_body_with_context(
        client,
        url,
        openai_messages,
        openai_tools,
        extra_body,
        request_context,
    )
    .expect("request body should compile")
}

pub(crate) async fn send_stream(
    client: &AIClient,
    messages: Vec<Message>,
    tools: Option<Vec<ToolDefinition>>,
    extra_body: Option<serde_json::Value>,
    max_tries: usize,
    trace: Option<ModelExchangeTraceConfig>,
    request_context: Option<ModelRequestContext>,
) -> Result<StreamResponse> {
    let url = client.config.request_url.clone();
    let request_context = shared::prepare_request_context(client, request_context);
    debug!(
        "OpenAI config: model={}, request_url={}, max_tries={}",
        client.config.model, client.config.request_url, max_tries
    );

    let openai_messages = OpenAIMessageConverter::convert_messages(messages);
    let openai_tools = OpenAIMessageConverter::convert_tools(tools);
    let request_body = try_build_request_body_with_context(
        client,
        &url,
        openai_messages,
        openai_tools,
        extra_body,
        request_context.as_ref(),
    )?;
    let inline_think_in_text = client.config.inline_think_in_text;
    let idle_timeout = client.stream_options.idle_timeout;
    let ttft_timeout = client.stream_options.ttft_timeout;

    execute_sse_request(
        "OpenAI Streaming API",
        &url,
        &request_body,
        max_tries,
        ttft_timeout,
        trace,
        || {
            shared::apply_affinity_headers(
                client,
                common::apply_headers(client, client.client().post(&url)),
                &url,
                request_context.as_ref(),
            )
        },
        move |response, tx, tx_raw, remaining_ttft_timeout| {
            handle_openai_stream(
                response,
                tx,
                tx_raw,
                inline_think_in_text,
                remaining_ttft_timeout,
                idle_timeout,
            )
        },
    )
    .await
}

#[cfg(test)]
mod local_context_truncation_tests {
    use super::prepare_messages_for_local_context;
    use super::strip_system_reminder_spans;
    use super::truncate_messages_for_local_context;
    use serde_json::{json, Value};

    fn message(role: &str, content: Value) -> Value {
        json!({"role": role, "content": content})
    }

    #[test]
    fn oversized_newest_message_is_kept_and_capped() {
        // Char-based estimate: the system prompt is capped to 1200 tokens
        // (300 after estimation), leaving 3796 headroom. The newest message
        // (20000 chars ≈ 5000 tokens) exceeds that headroom on its own and
        // is capped to the headroom instead of being dropped. The regression
        // this guards: the old walk broke on the newest message and produced
        // a system-only payload, which strict local servers reject with
        // "the last 'message.role' must be 'user'".
        let system = message("system", Value::String("s".repeat(12288)));
        let oldest = message("user", Value::String("old".repeat(400)));
        let newest = message("user", Value::String("u".repeat(20000)));

        let result = truncate_messages_for_local_context(vec![
            system,
            oldest,
            newest,
        ]);

        assert_eq!(result.len(), 3);
        assert_eq!(result[2]["role"], "user", "the active input must survive");
        let content = result[2]["content"].as_str().expect("capped to a string");
        let content_chars = content.chars().count();
        assert!(
            (1000..=3800).contains(&content_chars),
            "capped to the headroom, got {}",
            content_chars
        );
        let older = result[1]["content"].as_str().expect("older kept");
        assert_eq!(older, "old".repeat(400));
    }

    #[test]
    fn oversized_system_prompt_is_capped_to_preserve_history() {
        // The BitFun agent system prompt alone used to consume the whole
        // budget, so the model received no history at all and its own
        // reasoning reported that the user had no earlier messages.
        let system = message("system", Value::String("rule ".repeat(5000)));
        let older = message("user", Value::String("earlier question".repeat(20)));
        let newest = message("user", Value::String("current question".to_string()));

        let result = truncate_messages_for_local_context(vec![system, older, newest]);

        assert_eq!(result.len(), 3, "capped system, history, newest all fit");
        assert_eq!(result[0]["role"], "system");
        let system_text = result[0]["content"].as_str().expect("string system");
        assert!(
            system_text.contains("[system prompt truncated]"),
            "capped system prompt carries an explicit marker"
        );
        assert_eq!(result[2]["content"], "current question");
    }

    #[test]
    fn fitting_history_is_kept_in_order_with_the_newest_last() {
        let system = message("system", Value::String("role prompt".repeat(10)));
        let history = vec![
            message("user", Value::String("first question".repeat(10))),
            message("assistant", Value::String("first answer".repeat(10))),
            message("user", Value::String("second question".repeat(10))),
        ];

        let result = truncate_messages_for_local_context(
            std::iter::once(system).chain(history).collect(),
        );

        assert_eq!(result.len(), 4);
        let roles: Vec<&str> = result
            .iter()
            .map(|m| m["role"].as_str().expect("role"))
            .collect();
        assert_eq!(roles, vec!["system", "user", "assistant", "user"]);
        assert_eq!(
            result[3]["content"].as_str(),
            Some("second question".repeat(10).as_str())
        );
    }

    #[test]
    fn oversized_non_string_content_is_estimated_and_capped() {
        // A huge tool-result-style array: the flat estimate used to let it
        // slip past the budget and overflow the real window. Char-based:
        // serialized ≈ 40014 chars ≈ 10004 tokens > the 3796-char headroom
        // after the capped system prompt, so it is replaced with a capped
        // serialized string (the flattening normalization would have turned
        // it into text anyway).
        let system = message("system", Value::String("s".repeat(12288)));
        let newest = message(
            "tool",
            json!([{"text": "x".repeat(40000)}]),
        );

        let result =
            truncate_messages_for_local_context(vec![system, newest]);

        assert_eq!(result.len(), 2);
        let content = result[1]["content"].as_str().expect("capped to a string");
        let content_chars = content.chars().count();
        assert!(
            (1000..=3800).contains(&content_chars),
            "capped to the headroom, got {}",
            content_chars
        );
        assert!(content.contains("text"), "serialized form keeps field names");
    }

    #[test]
    fn local_prepare_strips_harness_reminders_from_user_turns() {
        // The on-device model cannot act on Tool Calling Guide / Skill
        // Listing reminders; they must not survive into the compact request.
        let system = message("system", Value::String("agent prompt".to_string()));
        let user = message(
            "user",
            Value::String(format!(
                "what changed?\n\n<system_reminder>\n# Tool Calling Guide\n## Direct tools\n- Read\n</system_reminder>\n\n<system_reminder>\n# Skill Listing\n<available_skills></available_skills>\n</system_reminder>"
            )),
        );

        let result = prepare_messages_for_local_context(vec![system, user]);

        assert_eq!(result.len(), 2, "the user turn survives with its real text");
        let content = result[1]["content"].as_str().expect("string content");
        assert!(
            content.contains("what changed?"),
            "the user's own question survives: {content}"
        );
        assert!(
            !content.contains("Tool Calling Guide") && !content.contains("Skill Listing"),
            "harness reminders are stripped: {content}"
        );
    }

    #[test]
    fn local_prepare_drops_user_turns_that_are_only_reminders() {
        let system = message("system", Value::String("agent prompt".to_string()));
        let blank = message(
            "user",
            Value::String(
                "<system_reminder>\n# Skill Listing\n<available_skills></available_skills>\n</system_reminder>"
                    .to_string(),
            ),
        );
        let real = message("user", Value::String("real question".to_string()));

        let result = prepare_messages_for_local_context(vec![system, blank, real]);

        assert_eq!(result.len(), 2, "blank reminder-only turn is dropped");
        assert_eq!(result[1]["content"], "real question");
    }

    #[test]
    fn local_prepare_strips_legacy_hyphen_reminders() {
        let system = message("system", Value::String("agent prompt".to_string()));
        let user = message(
            "user",
            Value::String("hi\n<system-reminder>\n# Tool Calling Guide\n</system-reminder>".to_string()),
        );

        let result = prepare_messages_for_local_context(vec![system, user]);

        assert_eq!(result.len(), 2);
        let content = result[1]["content"].as_str().expect("string content");
        assert!(content.contains("hi"), "user text survives: {content}");
        assert!(!content.contains("Tool Calling Guide"), "reminder stripped: {content}");
    }

    #[test]
    fn local_prepare_strips_reminders_inside_content_arrays() {
        let system = message("system", Value::String("agent prompt".to_string()));
        let user = message(
            "user",
            json!([
                {"type": "text", "text": "before"},
                {"type": "text", "text": "<system_reminder>\n# Skill Listing\n</system_reminder>"},
                {"type": "text", "text": "after"}
            ]),
        );

        let result = prepare_messages_for_local_context(vec![system, user]);

        assert_eq!(result.len(), 2, "the user turn survives with text parts");
        let parts = result[1]["content"].as_array().expect("array content");
        assert_eq!(parts[0]["text"], "before");
        assert_eq!(parts[1]["text"], "");
        assert_eq!(parts[2]["text"], "after");
    }

    #[test]
    fn unclosed_reminder_span_is_kept_verbatim() {
        // Malformed markup never truncates a message: an opening tag without
        // its closing counterpart stays as-is.
        let text = "keep me <system_reminder>\n# Skill Listing";
        assert_eq!(strip_system_reminder_spans(text), text);
        let text_legacy = "keep me <system-reminder>\n# Tool Calling Guide";
        assert_eq!(strip_system_reminder_spans(text_legacy), text_legacy);
    }
}
