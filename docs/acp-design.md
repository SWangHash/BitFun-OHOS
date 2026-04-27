# BitFun ACP Design

## Goal

ACP support should make BitFun usable from ACP-compatible editors without creating a second agent runtime. The ACP layer is a transport/protocol adapter around the existing runtime:

```text
ACP client
  -> bitfun-cli acp over stdio JSON-RPC
  -> ACP adapter
  -> ConversationCoordinator
  -> SessionManager / ExecutionEngine / ToolPipeline
  -> AgenticEvent stream
  -> ACP session/update notifications
```

The core rule is the same as the rest of the repository: product behavior stays in `bitfun-core`; ACP-specific protocol and runtime binding live in the dedicated `bitfun-acp` crate.

BitFun desktop also supports the opposite direction: acting as an ACP client for external agents such as opencode. This path is still an adapter, not a second FlowChat renderer:

```text
FlowChat session mode acp:{client_id}
  -> desktop ACP client command
  -> bitfun-acp client manager
  -> external ACP agent over stdio
  -> ACP session/update stream
  -> existing agentic:// FlowChat events
```

## Current State

BitFun uses the official Rust `agent-client-protocol` crate for the ACP protocol surface:

- `src/crates/acp` owns the typed ACP agent builder, protocol dispatch, and BitFun runtime binding;
- `src/apps/cli` only owns the `bitfun-cli acp` command and starts the ACP server;
- `src/crates/core/src/agentic/system.rs` owns shared agentic runtime assembly;
- sessions are created through `ConversationCoordinator`;
- prompts are submitted through `start_dialog_turn`;
- selected `AgenticEvent` values are translated to ACP `session/update` notifications.

The current typed adapter is intentionally focused on the canonical ACP surface. Legacy local DTOs and hand-written JSON-RPC dispatch have been removed.

## Placement

Recommended end state:

- `src/crates/acp`: ACP protocol adapter, typed server shell, and BitFun runtime binding.
- `src/crates/acp/src/client`: external ACP agent client manager, config parsing, permission bridge, and optional dynamic BitFun tool wrappers.
- `src/apps/cli`: CLI command startup, logging setup, and host lifecycle.
- `src/apps/desktop/src/api/acp_client_api.rs`: Tauri commands for desktop-only ACP process lifecycle and FlowChat event projection.
- `src/crates/core`: no ACP dependency; expose runtime capabilities through `ConversationCoordinator`, `AgentRegistry`, config, MCP, and event abstractions.

`bitfun-acp` can depend on `bitfun-core` because no core crate depends on ACP. `bitfun-transport` remains focused on BitFun's internal transport adapters and no longer owns ACP-specific protocol code.

## Desktop ACP Client

Desktop ACP clients are configured under the global config key `acp_clients`:

```json
{
  "acpClients": {
    "opencode": {
      "name": "opencode",
      "command": "opencode",
      "args": ["acp"],
      "env": {},
      "enabled": true,
      "autoStart": false,
      "readonly": false,
      "permissionMode": "ask"
    }
  }
}
```

The desktop host owns process spawning because stdio lifecycle is host-specific. The shared ACP crate owns protocol state, remote ACP sessions, permission request routing, and streaming conversion.

FlowChat stores these sessions with mode `acp:{client_id}`. When a user sends a message in that session, the normal send path skips BitFun backend session creation and model synchronization, calls `start_acp_dialog_turn`, and receives the same `agentic://dialog-turn-started`, `agentic://model-round-started`, `agentic://text-chunk`, and completion events that native BitFun agents use. This keeps UI rendering, saving, unread state, and state-machine behavior unified.

Configured enabled ACP clients appear in the main navigation action area. Selecting one creates a FlowChat session for the current project workspace and starts the external ACP process on demand.

## Session Model

Use BitFun session IDs as ACP `sessionId` values unless there is a concrete need for a client-local ID. This keeps load/list/resume aligned with persistence under `.bitfun/sessions`.

The ACP adapter should keep per-session state:

```text
session_id
cwd
current_turn_id
mode_id
model_id
client_capabilities
mcp_servers
pending_prompt
```

`session/new` maps to `ConversationCoordinator::create_session`.

`session/load` maps to `ConversationCoordinator::restore_session` plus history replay.

`session/prompt` maps to `ConversationCoordinator::start_dialog_turn`; streaming output comes from `AgenticEvent`.

## Protocol Surface

Only advertise capabilities that are implemented. Capability flags should grow with the implementation.

Phase 1:

- `initialize`
- `session/new`
- `session/load` with text history replay
- `session/prompt`
- `session/cancel`
- `session/list`
- text `session/update`
- basic tool status updates
- mode list from `AgentRegistry`
- tool confirmation through ACP `session/request_permission`

Phase 2:

- `session/resume`
- model/mode config options
- token usage updates
- thinking chunks
- richer tool output and diffs

Phase 3:

- MCP server injection from ACP session params
- images and embedded resources
- terminal client capability support
- fork session if BitFun adds native fork semantics

## Event Mapping

BitFun event to ACP update:

| BitFun event | ACP update |
| --- | --- |
| `TextChunk` | `agent_message_chunk` |
| `ThinkingChunk` | `agent_thought_chunk` |
| `TokenUsageUpdated` | `usage_update` |
| `ToolEventData::Started` / `EarlyDetected` | `tool_call` |
| `ToolEventData::Progress` / `StreamChunk` | `tool_call_update` with `in_progress` |
| `ToolEventData::Completed` | `tool_call_update` with `completed` |
| `ToolEventData::Failed` | `tool_call_update` with `failed` |
| `ToolEventData::Cancelled` | `tool_call_update` with `cancelled` |
| `DialogTurnCompleted` | resolve prompt with `end_turn` |
| `DialogTurnCancelled` | resolve prompt with `cancelled` |
| `DialogTurnFailed` / `SystemError` | resolve prompt with `error` |

The adapter should not consume the global event queue in a way that starves another host. The CLI ACP process is currently a single-host runtime, so direct queue consumption is acceptable short term. The transport adapter should ultimately subscribe through a fan-out event bridge.

## Permission Bridge

BitFun tools already emit `ToolEventData::ConfirmationNeeded` and expose `confirm_tool` / `reject_tool` on `ConversationCoordinator`.

ACP should translate this to a client permission request:

```text
ConfirmationNeeded
  -> ACP requestPermission
  -> selected allow: coordinator.confirm_tool(...)
  -> selected reject or client failure: coordinator.reject_tool(...)
```

If the ACP client does not support permission requests, the adapter should reject by default unless the session was started with an explicit "skip confirmation" policy.

## Compatibility Notes

ACP protocol v1 uses numeric `protocolVersion: 1` during initialization. BitFun should accept numeric v1 and return numeric v1.

Logs must never be written to stdout in ACP mode. Stdout is reserved for JSON-RPC frames; logs should go to stderr or a file.

`session/prompt` is long-running, so the stdio server must continue reading requests while a prompt is active. The current CLI adapter handles ordinary requests in input order and runs prompt requests in background tasks, with a single locked stdout writer for responses and notifications. This keeps `session/new` ordering deterministic while allowing `session/cancel` to arrive during an active prompt.

## Open Decisions

- Whether ACP mode should use the user's global tool-confirmation setting or a stricter ACP-specific default.
- Whether model selection should expose BitFun's global model aliases or fully resolved provider/model IDs.
