//! Relay records retain the runtime's persisted turn, round and item contracts.
//! Parent headers make a latest-page record independently interpretable, while
//! large text/tool bodies occur only on their own stable item record.
use anyhow::Result;
use bitfun_services_core::session::DialogTurnData;
use serde_json::{json, Value};

/// Transcript facts and interaction controls have different persistence roles.
/// Provider chunks are not durable messages; completed runtime blocks are read
/// from the canonical turn store. Approval controls retain their full payload.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SessionEventPublication {
    pub synchronize_records: bool,
    pub persist_control: bool,
}

pub fn session_event_publication(name: &str, payload: &Value) -> SessionEventPublication {
    if name == "agentic://text-chunk" {
        return SessionEventPublication {
            synchronize_records: false,
            persist_control: false,
        };
    }
    if name == "agentic://tool-event" {
        let kind = payload["toolEvent"]["event_type"].as_str().unwrap_or("");
        return SessionEventPublication {
            synchronize_records: !matches!(
                kind,
                "EarlyDetected"
                    | "ParamsPartial"
                    | "Queued"
                    | "Waiting"
                    | "Progress"
                    | "Streaming"
                    | "StreamChunk"
            ),
            persist_control: matches!(
                kind,
                "ConfirmationNeeded" | "Confirmed" | "Rejected" | "Cancelled"
            ),
        };
    }
    SessionEventPublication {
        synchronize_records: true,
        persist_control: true,
    }
}

pub fn records_from_turns(turns: &[DialogTurnData]) -> Result<Vec<Value>> {
    let mut records = Vec::new();
    for source in turns {
        let mut turn = serde_json::to_value(source)?;
        turn.as_object_mut()
            .expect("turn serializes as object")
            .remove("modelRounds");
        records.push(json!({"sessionId":source.session_id,"id":format!("turn/{}",source.turn_id),"turn":turn}));
        for source_round in &source.model_rounds {
            let mut round = serde_json::to_value(source_round)?;
            let object = round.as_object_mut().expect("round serializes as object");
            for field in ["textItems", "thinkingItems", "toolItems"] {
                object.remove(field);
            }
            records.push(json!({"sessionId":source.session_id,"id":format!("round/{}",source_round.id),"turn":turn,"round":round}));
            for (kind, items) in [
                ("text", serde_json::to_value(&source_round.text_items)?),
                (
                    "thinking",
                    serde_json::to_value(&source_round.thinking_items)?,
                ),
                ("tool", serde_json::to_value(&source_round.tool_items)?),
            ] {
                for item in items.as_array().expect("items serialize as array") {
                    let id = item["id"].as_str().expect("persisted item has id");
                    records.push(json!({"sessionId":source.session_id,"id":format!("item/{id}"),"turn":turn,"round":round,"item":{"type":kind,"data":item}}));
                }
            }
        }
    }
    Ok(records)
}

#[cfg(test)]
mod publication_tests {
    use super::*;
    #[test]
    fn completed_tool_body_is_only_published_as_a_canonical_record() {
        for kind in ["Started", "Completed", "Failed"] {
            let policy = session_event_publication(
                "agentic://tool-event",
                &json!({"toolEvent":{"event_type":kind,"result":"large tool output"}}),
            );
            assert!(policy.synchronize_records);
            assert!(!policy.persist_control);
        }
        for kind in ["ParamsPartial", "StreamChunk", "Streaming"] {
            let policy = session_event_publication(
                "agentic://tool-event",
                &json!({"toolEvent":{"event_type":kind}}),
            );
            assert!(!policy.synchronize_records);
            assert!(!policy.persist_control);
        }
    }
    #[test]
    fn approvals_and_lifecycle_controls_are_retained() {
        for kind in ["ConfirmationNeeded", "Confirmed", "Rejected", "Cancelled"] {
            assert!(session_event_publication("agentic://tool-event",&json!({"toolEvent":{"event_type":kind,"params":{"question":"Review this input"}}})).persist_control);
        }
        assert!(
            session_event_publication("agentic://dialog-turn-completed", &json!({"turnId":"turn"}))
                .persist_control
        );
    }
}
