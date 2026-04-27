use agent_client_protocol::schema::{
    ContentBlock, ContentChunk, SessionNotification, SessionUpdate, ToolCall, ToolCallContent,
    ToolCallStatus, ToolCallUpdate,
};
use agent_client_protocol::util::MatchDispatch;
use bitfun_core::util::errors::{BitFunError, BitFunResult};
use bitfun_events::ToolEventData;

use super::tool_card_bridge::{acp_tool_name, normalize_tool_params};

#[derive(Debug, Clone)]
pub enum AcpClientStreamEvent {
    AgentText(String),
    AgentThought(String),
    ToolEvent(ToolEventData),
    Completed,
    Cancelled,
}

pub async fn acp_dispatch_to_stream_events(
    dispatch: agent_client_protocol::Dispatch,
) -> BitFunResult<Vec<AcpClientStreamEvent>> {
    let mut events = Vec::new();
    MatchDispatch::new(dispatch)
        .if_notification(async |notification: SessionNotification| {
            match notification.update {
                SessionUpdate::AgentMessageChunk(chunk) => {
                    if let Some(text) = content_chunk_text(chunk) {
                        events.push(AcpClientStreamEvent::AgentText(text));
                    }
                }
                SessionUpdate::AgentThoughtChunk(chunk) => {
                    if let Some(text) = content_chunk_text(chunk) {
                        events.push(AcpClientStreamEvent::AgentThought(text));
                    }
                }
                SessionUpdate::ToolCall(tool_call) => {
                    events.extend(acp_tool_call_events(tool_call));
                }
                SessionUpdate::ToolCallUpdate(tool_call_update) => {
                    if let Some(event) = acp_tool_call_update_event(tool_call_update) {
                        events.push(event);
                    }
                }
                _ => {}
            }
            Ok(())
        })
        .await
        .otherwise_ignore()
        .map_err(protocol_error)?;
    Ok(events)
}

fn content_chunk_text(chunk: ContentChunk) -> Option<String> {
    match chunk.content {
        ContentBlock::Text(text) => Some(text.text),
        _ => None,
    }
}

fn acp_tool_call_events(tool_call: ToolCall) -> Vec<AcpClientStreamEvent> {
    let tool_id = tool_call.tool_call_id.to_string();
    let tool_name = acp_tool_name(
        &tool_call.title,
        tool_call.raw_input.as_ref(),
        Some(&tool_call.kind),
    );
    let params = normalize_tool_params(
        &tool_name,
        tool_call.raw_input.clone().unwrap_or_else(|| {
            serde_json::json!({
                "title": tool_call.title,
                "kind": format!("{:?}", tool_call.kind),
            })
        }),
    );

    let mut events = vec![AcpClientStreamEvent::ToolEvent(ToolEventData::Started {
        tool_id: tool_id.clone(),
        tool_name: tool_name.clone(),
        params,
    })];

    match tool_call.status {
        ToolCallStatus::Completed => {
            events.push(AcpClientStreamEvent::ToolEvent(ToolEventData::Completed {
                tool_id,
                tool_name,
                result: acp_tool_result_value(
                    tool_call.raw_output,
                    Some(tool_call.content),
                    Some(tool_call.locations),
                ),
                result_for_assistant: None,
                duration_ms: 0,
            }));
        }
        ToolCallStatus::Failed => {
            events.push(AcpClientStreamEvent::ToolEvent(ToolEventData::Failed {
                tool_id,
                tool_name,
                error: acp_tool_error_text(tool_call.raw_output, tool_call.content),
            }));
        }
        ToolCallStatus::Pending | ToolCallStatus::InProgress => {}
        _ => {}
    }

    events
}

fn acp_tool_call_update_event(update: ToolCallUpdate) -> Option<AcpClientStreamEvent> {
    let tool_id = update.tool_call_id.to_string();
    let title = update.fields.title.unwrap_or_else(|| tool_id.clone());
    let tool_name = acp_tool_name(
        &title,
        update.fields.raw_input.as_ref(),
        update.fields.kind.as_ref(),
    );

    match update.fields.status {
        Some(ToolCallStatus::Completed) => {
            Some(AcpClientStreamEvent::ToolEvent(ToolEventData::Completed {
                tool_id,
                tool_name,
                result: acp_tool_result_value(
                    update.fields.raw_output,
                    update.fields.content,
                    update.fields.locations,
                ),
                result_for_assistant: None,
                duration_ms: 0,
            }))
        }
        Some(ToolCallStatus::Failed) => {
            Some(AcpClientStreamEvent::ToolEvent(ToolEventData::Failed {
                tool_id,
                tool_name,
                error: acp_tool_error_text(
                    update.fields.raw_output,
                    update.fields.content.unwrap_or_default(),
                ),
            }))
        }
        Some(ToolCallStatus::InProgress) | Some(ToolCallStatus::Pending) | Some(_) => {
            let params = normalize_tool_params(
                &tool_name,
                update.fields.raw_input.unwrap_or_else(|| {
                    serde_json::json!({
                        "title": title,
                    })
                }),
            );
            Some(AcpClientStreamEvent::ToolEvent(ToolEventData::Started {
                tool_id,
                tool_name,
                params,
            }))
        }
        None => update.fields.raw_input.map(|params| {
            let params = normalize_tool_params(&tool_name, params);
            AcpClientStreamEvent::ToolEvent(ToolEventData::Started {
                tool_id,
                tool_name,
                params,
            })
        }),
    }
}

fn acp_tool_result_value(
    raw_output: Option<serde_json::Value>,
    content: Option<Vec<ToolCallContent>>,
    locations: Option<Vec<agent_client_protocol::schema::ToolCallLocation>>,
) -> serde_json::Value {
    if let Some(raw_output) = raw_output {
        return raw_output;
    }

    let content = content.unwrap_or_default();
    let locations = locations.unwrap_or_default();
    if content.is_empty() && locations.is_empty() {
        return serde_json::Value::Null;
    }

    serde_json::json!({
        "content": content,
        "locations": locations,
    })
}

fn acp_tool_error_text(
    raw_output: Option<serde_json::Value>,
    content: Vec<ToolCallContent>,
) -> String {
    if let Some(raw_output) = raw_output {
        return value_to_display_text(&raw_output);
    }
    if !content.is_empty() {
        return serde_json::to_string_pretty(&content).unwrap_or_else(|_| {
            serde_json::to_string(&content).unwrap_or_else(|_| "ACP tool failed".to_string())
        });
    }
    "ACP tool failed".to_string()
}

fn value_to_display_text(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        _ => serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string()),
    }
}

fn protocol_error(error: impl std::fmt::Display) -> BitFunError {
    BitFunError::service(format!("ACP protocol error: {}", error))
}
