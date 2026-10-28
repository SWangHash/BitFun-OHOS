//! Repair of assistant `tool_calls` / tool-result pairing at the request boundary.
//!
//! Providers require every `tool_call_id` of an assistant `tool_calls` message to
//! be answered by a tool message that directly follows it, and they reject the
//! whole request with `400 invalid_request_error` otherwise. Runtime history can
//! legitimately reach the wire unpaired:
//!
//! - the complete provider response is committed before a tool runs, so an abort
//!   or a configuration failure in the tool phase leaves no result behind;
//! - context compression can cut a batch in half;
//! - a tool result can be filtered out of the request while its call stays.
//!
//! Repairing the request keeps stored history untouched while guaranteeing a
//! shape the provider accepts, so an already poisoned session becomes usable
//! again instead of failing every later turn.

use crate::types::Message as AIMessage;

/// Model-visible text for a result that no tool execution produced. It must
/// state the uncertainty instead of implying the call ran or did not run.
const SYNTHESIZED_TOOL_RESULT: &str = "This tool call did not complete: the run was interrupted or failed before the tool produced a result. The call may or may not have taken effect. Verify the current state before retrying, and do not assume it had no side effects.";

const ASSISTANT_ROLE: &str = "assistant";
const TOOL_ROLE: &str = "tool";

/// What a repair pass changed. Used for logging and tests.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ToolCallPairingRepair {
    /// Tool results that were synthesized for unanswered tool calls.
    pub synthesized_results: usize,
    /// Tool messages dropped because no open batch claimed their id.
    pub dropped_tool_results: usize,
    /// Tool calls left in place that cannot be paired at all (empty id).
    pub unpairable_tool_calls: usize,
}

impl ToolCallPairingRepair {
    pub fn total(&self) -> usize {
        self.synthesized_results + self.dropped_tool_results + self.unpairable_tool_calls
    }

    pub fn is_empty(&self) -> bool {
        self.total() == 0
    }
}

/// Make `messages` a valid provider request for tool calls and tool results.
///
/// Rules applied in one pass:
/// - a tool message is kept only when it answers a call of the batch that is
///   still open, so duplicate and stale results are dropped;
/// - a batch closes at the first non-tool message, so missing results are
///   synthesized before anything else can separate them from their call;
/// - a trailing batch closes at the end of the history.
pub fn repair_tool_call_pairing(messages: &mut Vec<AIMessage>) -> ToolCallPairingRepair {
    let mut repair = ToolCallPairingRepair::default();
    let mut open_batch: Vec<(String, String)> = Vec::new();
    let mut repaired = Vec::with_capacity(messages.len());

    for message in messages.drain(..) {
        if message.role == TOOL_ROLE {
            let claimed = message
                .tool_call_id
                .as_deref()
                .filter(|id| !id.trim().is_empty())
                .and_then(|id| {
                    open_batch
                        .iter()
                        .position(|(open_id, _)| open_id == id)
                        .map(|position| (position, id.to_string()))
                });

            match claimed {
                Some((position, _)) => {
                    open_batch.remove(position);
                    repaired.push(message);
                }
                None => repair.dropped_tool_results += 1,
            }
            continue;
        }

        // Any other message ends the batch it follows: providers require the
        // tool messages to arrive before the next turn.
        close_open_batch(&mut repaired, &mut open_batch, &mut repair);

        if message.role == ASSISTANT_ROLE {
            if let Some(tool_calls) = message.tool_calls.as_deref() {
                for tool_call in tool_calls {
                    if tool_call.id.trim().is_empty() {
                        repair.unpairable_tool_calls += 1;
                        continue;
                    }
                    open_batch.push((tool_call.id.clone(), tool_call.name.clone()));
                }
            }
        }

        repaired.push(message);
    }

    close_open_batch(&mut repaired, &mut open_batch, &mut repair);

    *messages = repaired;
    repair
}

fn close_open_batch(
    repaired: &mut Vec<AIMessage>,
    open_batch: &mut Vec<(String, String)>,
    repair: &mut ToolCallPairingRepair,
) {
    for (tool_call_id, tool_name) in open_batch.drain(..) {
        repaired.push(synthesized_tool_result(&tool_call_id, &tool_name));
        repair.synthesized_results += 1;
    }
}

fn synthesized_tool_result(tool_call_id: &str, tool_name: &str) -> AIMessage {
    AIMessage {
        role: TOOL_ROLE.to_string(),
        content: Some(SYNTHESIZED_TOOL_RESULT.to_string()),
        reasoning_content: None,
        thinking_signature: None,
        tool_calls: None,
        tool_call_id: Some(tool_call_id.to_string()),
        name: (!tool_name.trim().is_empty()).then(|| tool_name.to_string()),
        is_error: Some(true),
        tool_image_attachments: None,
        model_response_replay: None,
    }
}

#[cfg(test)]
mod tests {
    use super::{repair_tool_call_pairing, ToolCallPairingRepair, SYNTHESIZED_TOOL_RESULT};
    use crate::types::{Message as AIMessage, ToolCall};
    use serde_json::json;

    fn tool_call(id: &str, name: &str) -> ToolCall {
        ToolCall {
            id: id.to_string(),
            name: name.to_string(),
            arguments: json!({}),
            raw_arguments: None,
        }
    }

    fn assistant_with_calls(calls: Vec<ToolCall>) -> AIMessage {
        AIMessage {
            role: "assistant".to_string(),
            content: None,
            reasoning_content: None,
            thinking_signature: None,
            tool_calls: Some(calls),
            tool_call_id: None,
            name: None,
            is_error: None,
            tool_image_attachments: None,
            model_response_replay: None,
        }
    }

    fn tool_result(id: &str) -> AIMessage {
        AIMessage {
            role: "tool".to_string(),
            content: Some(format!("result {id}")),
            reasoning_content: None,
            thinking_signature: None,
            tool_calls: None,
            tool_call_id: Some(id.to_string()),
            name: None,
            is_error: None,
            tool_image_attachments: None,
            model_response_replay: None,
        }
    }

    fn pairing(messages: &[AIMessage]) -> Vec<(String, bool)> {
        let mut open: Vec<String> = Vec::new();
        let mut observed = Vec::new();
        for message in messages {
            if message.role == "assistant" {
                open = message
                    .tool_calls
                    .iter()
                    .flatten()
                    .map(|call| call.id.clone())
                    .collect();
                continue;
            }
            if message.role != "tool" {
                assert!(open.is_empty(), "batch must close before the next turn");
                continue;
            }
            let id = message.tool_call_id.clone().expect("tool_call_id");
            let position = open
                .iter()
                .position(|open_id| *open_id == id)
                .expect("tool result must answer an open call");
            open.remove(position);
            observed.push((id, message.is_error.unwrap_or(false)));
        }
        assert!(open.is_empty(), "every tool call must be answered");
        observed
    }

    fn encoded(messages: &[AIMessage]) -> serde_json::Value {
        serde_json::to_value(messages).expect("messages serialize")
    }

    #[test]
    fn complete_batches_are_left_untouched() {
        let mut messages = vec![
            AIMessage::user("run both".to_string()),
            assistant_with_calls(vec![tool_call("a", "Read"), tool_call("b", "Grep")]),
            tool_result("a"),
            tool_result("b"),
            AIMessage::assistant("done".to_string()),
        ];
        let original = encoded(&messages);

        let repair = repair_tool_call_pairing(&mut messages);

        assert_eq!(repair, ToolCallPairingRepair::default());
        assert_eq!(encoded(&messages), original);
    }

    #[test]
    fn missing_results_are_synthesized_for_the_unanswered_calls_only() {
        // The historical shape that made later requests fail: the response was
        // committed, then the tool phase aborted before any result existed.
        let mut messages = vec![
            AIMessage::user("run both".to_string()),
            assistant_with_calls(vec![tool_call("a", "Read"), tool_call("b", "Grep")]),
            AIMessage::user("next turn".to_string()),
        ];

        let repair = repair_tool_call_pairing(&mut messages);

        assert_eq!(repair.synthesized_results, 2);
        assert_eq!(repair.dropped_tool_results, 0);
        assert_eq!(repair.unpairable_tool_calls, 0);
        assert_eq!(
            messages
                .iter()
                .map(|message| message.role.as_str())
                .collect::<Vec<_>>(),
            ["user", "assistant", "tool", "tool", "user"]
        );
        assert_eq!(
            pairing(&messages),
            [("a".to_string(), true), ("b".to_string(), true)]
        );
        for message in &messages[2..4] {
            assert_eq!(message.content.as_deref(), Some(SYNTHESIZED_TOOL_RESULT));
        }
    }

    #[test]
    fn missing_results_close_a_trailing_batch() {
        let mut messages = vec![assistant_with_calls(vec![tool_call("a", "Read")])];

        let repair = repair_tool_call_pairing(&mut messages);

        assert_eq!(repair.synthesized_results, 1);
        assert_eq!(
            messages
                .iter()
                .map(|message| message.role.as_str())
                .collect::<Vec<_>>(),
            ["assistant", "tool"]
        );
        assert_eq!(pairing(&messages), [("a".to_string(), true)]);
    }

    #[test]
    fn partial_parallel_batches_keep_the_real_results() {
        let mut messages = vec![
            AIMessage::user("run both".to_string()),
            assistant_with_calls(vec![tool_call("a", "Read"), tool_call("b", "Grep")]),
            tool_result("b"),
            AIMessage::assistant("done".to_string()),
        ];

        let repair = repair_tool_call_pairing(&mut messages);

        assert_eq!(repair.synthesized_results, 1);
        assert_eq!(
            pairing(&messages),
            [("b".to_string(), false), ("a".to_string(), true)]
        );
        assert_eq!(messages[2].content.as_deref(), Some("result b"));
    }

    #[test]
    fn orphan_tool_results_are_dropped() {
        let mut messages = vec![
            AIMessage::user("hello".to_string()),
            tool_result("stale"),
            AIMessage::assistant("hi".to_string()),
        ];

        let repair = repair_tool_call_pairing(&mut messages);

        assert_eq!(repair.dropped_tool_results, 1);
        assert_eq!(
            messages
                .iter()
                .map(|message| message.role.as_str())
                .collect::<Vec<_>>(),
            ["user", "assistant"]
        );
    }

    #[test]
    fn tool_results_for_a_closed_batch_are_dropped() {
        let mut messages = vec![
            AIMessage::user("first".to_string()),
            assistant_with_calls(vec![tool_call("a", "Read")]),
            tool_result("a"),
            AIMessage::user("second".to_string()),
            // A duplicate or late result for the already answered call.
            tool_result("a"),
            AIMessage::assistant("done".to_string()),
        ];

        let repair = repair_tool_call_pairing(&mut messages);

        assert_eq!(repair.synthesized_results, 0);
        assert_eq!(repair.dropped_tool_results, 1);
        assert_eq!(
            messages
                .iter()
                .map(|message| message.role.as_str())
                .collect::<Vec<_>>(),
            ["user", "assistant", "tool", "user", "assistant"]
        );
    }

    #[test]
    fn tool_calls_without_an_id_stay_visible_but_unpairable() {
        let mut messages = vec![
            AIMessage::user("run".to_string()),
            assistant_with_calls(vec![tool_call("", "Read"), tool_call("b", "Grep")]),
        ];

        let repair = repair_tool_call_pairing(&mut messages);

        assert_eq!(repair.unpairable_tool_calls, 1);
        assert_eq!(repair.synthesized_results, 1);
        assert_eq!(
            messages[1]
                .tool_calls
                .as_ref()
                .map(|calls| calls.len())
                .unwrap_or_default(),
            2,
            "an id-less call is left for the caller to report, not silently removed"
        );
    }

    #[test]
    fn history_without_tool_activity_is_unchanged() {
        let mut messages = vec![
            AIMessage::user("hello".to_string()),
            AIMessage::assistant("hi".to_string()),
            AIMessage::user("again".to_string()),
        ];
        let original = encoded(&messages);

        let repair = repair_tool_call_pairing(&mut messages);

        assert!(repair.is_empty());
        assert_eq!(encoded(&messages), original);
    }
}
