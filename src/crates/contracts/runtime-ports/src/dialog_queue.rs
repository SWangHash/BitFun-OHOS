//! Host-owned user message queue. The epoch fences retries across owner restarts.
use crate::AgentInputAttachment;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogQueueMessage {
    pub turn_id: String,
    pub content: String,
    #[serde(default)]
    pub display_content: Option<String>,
    pub agent_type: String,
    #[serde(default)]
    pub attachments: Vec<AgentInputAttachment>,
    #[serde(default)]
    pub metadata: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum DialogQueueAction {
    List,
    Get {
        turn_id: String,
    },
    Submit {
        message: DialogQueueMessage,
    },
    Cancel {
        turn_id: String,
        operation_id: String,
    },
    Promote {
        turn_id: String,
        operation_id: String,
        expected_active_turn_id: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogQueueRequest {
    pub session_id: String,
    #[serde(default)]
    pub queue_epoch: Option<String>,
    #[serde(flatten)]
    pub action: DialogQueueAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DialogQueueStatus {
    Queued,
    Blocked,
    SteeringPending,
    Steered,
    Started,
    Interrupted,
    Completed,
    Failed,
    Cancelled,
}
impl DialogQueueStatus {
    pub fn is_pending(self) -> bool {
        matches!(self, Self::Queued | Self::Blocked | Self::SteeringPending)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogQueueItem {
    pub turn_id: String,
    pub display_content: String,
    pub preview_truncated: bool,
    pub attachment_count: usize,
    pub agent_type: String,
    pub created_at_ms: u64,
    pub status: DialogQueueStatus,
    pub reason: Option<String>,
    pub target_turn_id: Option<String>,
    pub steering_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogQueueSnapshot {
    pub session_id: String,
    pub queue_epoch: String,
    pub revision: u64,
    pub active_turn_id: Option<String>,
    pub items: Vec<DialogQueueItem>,
    pub capacity: usize,
    pub used: usize,
    /// Present for submission queries and mutations; terminal receipts remain queryable.
    pub receipt: Option<DialogQueueItem>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queue_request_wire_defaults_and_extensions_are_compatible() {
        let legacy = serde_json::json!({"sessionId":"session", "action":"list"});
        let request: DialogQueueRequest = serde_json::from_value(legacy).unwrap();
        assert_eq!(request.queue_epoch, None);
        assert_eq!(request.action, DialogQueueAction::List);
        let input = serde_json::json!({"sessionId":"session", "queueEpoch":"owner", "action":"submit",
            "message":{"turnId":"turn", "content":"follow up", "agentType":"Standard", "futureField":true},
            "futureExtension": 1});
        let request: DialogQueueRequest = serde_json::from_value(input).unwrap();
        let DialogQueueAction::Submit { message } = &request.action else {
            panic!("submit")
        };
        assert!(message.attachments.is_empty());
        assert!(message.metadata.is_empty());
        assert_eq!(
            serde_json::from_value::<DialogQueueRequest>(serde_json::to_value(&request).unwrap())
                .unwrap(),
            request
        );
    }

    #[test]
    fn promote_round_trip_preserves_operation_and_expected_turn() {
        let input = serde_json::json!({"sessionId":"session", "queueEpoch":"owner", "action":"promote",
            "turnId":"queued", "operationId":"op", "expectedActiveTurnId":"active"});
        let request: DialogQueueRequest = serde_json::from_value(input.clone()).unwrap();
        assert_eq!(serde_json::to_value(request).unwrap(), input);
    }
}
