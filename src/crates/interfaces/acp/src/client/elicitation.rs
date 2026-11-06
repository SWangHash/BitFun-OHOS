use agent_client_protocol::{Error, JsonRpcRequest};
use agent_client_protocol_schema::{
    CreateElicitationRequest, ElicitationMode, ElicitationPropertySchema, MultiSelectItems,
};
use bitfun_core::agentic::tools::user_input_manager::{
    get_user_input_manager, wait_for_user_question_response, PendingUserQuestion,
    UserQuestionWaitOutcome,
};
use bitfun_core::infrastructure::events::{emit_global_event, BackendEvent};
use bitfun_events::{ToolEventData, ToolEventIdentity};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::oneshot;

use super::stream::{AcpClientStreamEvent, AcpInteractiveEvent, AcpInteractiveSession};

// The SDK re-exports the schema but does not yet register this request method.
#[derive(Debug, Clone, Serialize, Deserialize, JsonRpcRequest)]
#[request(method = "elicitation/create", response = Value)]
#[serde(transparent)]
pub(super) struct AcpElicitationRequest(pub CreateElicitationRequest);

#[derive(Default, Deserialize)]
struct QuestionHints {
    #[serde(default)]
    fields: Vec<QuestionFieldHints>,
}

#[derive(Deserialize)]
struct QuestionFieldHints {
    key: String,
    custom: Option<bool>,
    #[serde(default)]
    options: Vec<QuestionOptionHints>,
}

#[derive(Deserialize)]
struct QuestionOptionHints {
    value: String,
    description: Option<String>,
}

fn question_payload(request: &CreateElicitationRequest) -> Result<Value, Error> {
    let ElicitationMode::Form(form) = &request.mode else {
        return Err(Error::invalid_params().data("Only ACP question forms are supported"));
    };
    let hints: QuestionHints = request
        .meta
        .as_ref()
        .and_then(|meta| meta.get("deveco.question"))
        .map(|value| serde_json::from_value(value.clone()))
        .transpose()
        .map_err(|error| Error::invalid_params().data(error.to_string()))?
        .unwrap_or_default();
    let mut questions = Vec::new();
    for (field, schema) in &form.requested_schema.properties {
        let field_hints = hints.fields.iter().find(|hint| hint.key == *field);
        let (title, description, mut options, multi_select) = match schema {
            ElicitationPropertySchema::String(schema) => {
                let options = if let Some(options) = &schema.one_of {
                    options
                        .iter()
                        .map(|option| json!({"value": option.value, "label": option.title}))
                        .collect::<Vec<_>>()
                } else {
                    schema
                        .enum_values
                        .iter()
                        .flatten()
                        .map(|value| json!({"value": value, "label": value}))
                        .collect()
                };
                (&schema.title, &schema.description, options, false)
            }
            ElicitationPropertySchema::Array(schema) => {
                let options = match &schema.items {
                    MultiSelectItems::Untitled(items) => items
                        .values
                        .iter()
                        .map(|value| json!({"value": value, "label": value}))
                        .collect(),
                    MultiSelectItems::Titled(items) => items
                        .options
                        .iter()
                        .map(|option| json!({"value": option.value, "label": option.title}))
                        .collect(),
                    _ => {
                        return Err(Error::invalid_params().data("Unsupported ACP question options"))
                    }
                };
                (&schema.title, &schema.description, options, true)
            }
            _ => {
                return Err(Error::invalid_params()
                    .data("ACP question fields must contain text or selections"))
            }
        };
        for option in &mut options {
            if let Some(hint) = field_hints.and_then(|hints| {
                hints
                    .options
                    .iter()
                    .find(|hint| option["value"] == hint.value)
            }) {
                option["description"] = json!(hint.description);
            }
        }
        let allow_custom = field_hints
            .and_then(|hint| hint.custom)
            .unwrap_or(options.is_empty());
        questions.push(json!({
            "field": field,
            "header": title.as_deref().unwrap_or(&request.message),
            "question": description.as_deref().or(title.as_deref()).unwrap_or(&request.message),
            "options": options,
            "multiSelect": multi_select,
            "allowCustomInput": allow_custom,
            "inputPlaceholder": if options.is_empty() { Some(request.message.as_str()) } else { None },
            "required": form.requested_schema.required.as_ref().is_some_and(|required| required.contains(field)),
        }));
    }
    Ok(json!({"questions": questions, "responseDeadlineMs": null}))
}

pub(super) async fn handle_elicitation(
    request: CreateElicitationRequest,
    session: AcpInteractiveSession,
) -> Result<Value, Error> {
    let payload = question_payload(&request)?;
    let tool_id = format!("acp_question_{}", uuid::Uuid::new_v4());
    let manager = get_user_input_manager();
    let (tx, rx) = oneshot::channel();
    let registration = manager.register_question(
        PendingUserQuestion::new(
            tool_id.clone(),
            session.bitfun_session_id.clone(),
            None,
            None,
            payload.clone(),
        ),
        tx,
    );
    session
        .events
        .send(AcpInteractiveEvent::Stream(
            AcpClientStreamEvent::ToolEvent(ToolEventData::Started {
                identity: ToolEventIdentity::direct(tool_id.clone(), "AskUserQuestion"),
                params: payload.clone(),
                timeout_seconds: None,
            }),
        ))
        .map_err(Error::into_internal_error)?;
    emit_global_event(BackendEvent::ToolAwaitingUserInput {
        tool_id: tool_id.clone(),
        session_id: session.bitfun_session_id,
        questions: payload.clone(),
    })
    .await
    .map_err(|error| Error::internal_error().data(error.to_string()))?;

    let (response, result) = match wait_for_user_question_response(&registration, rx, None).await {
        UserQuestionWaitOutcome::Answered(answer) => (
            json!({"action": "accept", "content": answer.answers}),
            json!({"status": "answered", "answers": answer.answers, "questions": payload["questions"]}),
        ),
        UserQuestionWaitOutcome::Cancelled | UserQuestionWaitOutcome::TimedOut => (
            json!({"action": "cancel"}),
            json!({"status": "cancelled", "questions": payload["questions"]}),
        ),
    };
    let _ = session.events.send(AcpInteractiveEvent::Stream(
        AcpClientStreamEvent::ToolEvent(ToolEventData::Completed {
            identity: ToolEventIdentity::direct(tool_id, "AskUserQuestion"),
            result,
            result_for_assistant: None,
            image_attachments: None,
            duration_ms: 0,
            queue_wait_ms: None,
            preflight_ms: None,
            confirmation_wait_ms: None,
            execution_ms: None,
        }),
    ));
    Ok(response)
}

pub(super) fn cancel_elicitations(bitfun_session_id: &str) {
    let manager = get_user_input_manager();
    for question in manager
        .pending_question_snapshot(bitfun_session_id)
        .questions
    {
        if question.tool_id.starts_with("acp_question_") {
            let _ = manager.cancel_for_session(bitfun_session_id, &question.tool_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn form_fields_preserve_option_values_multiple_selection_and_custom_input() {
        let request = serde_json::from_value(json!({
            "sessionId": "agent-session", "mode": "form", "message": "Preferences",
            "requestedSchema": {"type": "object", "properties": {
                "database": {"type": "string", "title": "Database", "description": "Select a database", "oneOf": [
                    {"const": "sqlite", "title": "SQLite"}, {"const": "postgres", "title": "PostgreSQL"}
                ]},
                "features": {"type": "array", "title": "Features", "items": {"anyOf": [
                    {"const": "search", "title": "Search"}, {"const": "export", "title": "Export"}
                ]}},
                "notes": {"type": "string", "description": "Additional details"}
            }, "required": ["database", "features", "notes"]},
            "_meta": {"deveco.question": {"fields": [
                {"key": "database", "custom": false, "options": [{"value": "sqlite", "description": "Embedded database"}]},
                {"key": "features", "custom": true}
            ]}}
        })).unwrap();
        let payload = question_payload(&request).unwrap();
        let questions = payload["questions"].as_array().unwrap();
        assert_eq!(
            questions[0]["options"][0],
            json!({"value": "sqlite", "label": "SQLite", "description": "Embedded database"})
        );
        assert_eq!(questions[0]["allowCustomInput"], false);
        assert_eq!(questions[1]["multiSelect"], true);
        assert_eq!(questions[1]["allowCustomInput"], true);
        assert_eq!(questions[2]["field"], "notes");
        assert_eq!(questions[2]["allowCustomInput"], true);
        assert!(payload["responseDeadlineMs"].is_null());
    }
}
