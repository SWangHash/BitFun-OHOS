package com.bitfun.mobile.core.feature.session

import com.bitfun.mobile.core.domain.*
import com.bitfun.mobile.core.protocol.*
import kotlinx.serialization.json.*

/** Adapter for the host's stable frontend_projection.rs events. No RPC or platform IO. */
internal class DurableSessionReducer {
    private data class Item(val round: String, val attempt: String, val value: ChatMessageItemResponse)
    private val projected = mutableListOf<Item>()
    private var currentTurn = ""

    fun apply(timeline: ChatTimelineStore, envelope: JsonObject): Boolean {
        val session = envelope["session_id"]?.jsonPrimitive?.content ?: error("Missing session binding")
        if (session != timeline.snapshot().sessionId) return false
        val event = envelope["event"]?.jsonPrimitive?.content ?: error("Missing event name")
        val payload = envelope["payload"] as? JsonObject ?: return false
        val turn = payload["turnId"]?.jsonPrimitive?.content.orEmpty()
        if (turn.isEmpty()) return false
        if (currentTurn != turn) { projected.clear(); currentTurn = turn }
        val round = payload["roundId"]?.jsonPrimitive?.content.orEmpty()
        val attempt = payload["attemptId"]?.jsonPrimitive?.content.orEmpty()
        when (event) {
            "agentic://dialog-turn-started" -> { projected.clear(); timeline.clearActiveTurn(); timeline.applyEvent(ConversationEvent.TurnStarted(session, turn)) }
            "agentic://text-chunk" -> {
                if (timeline.activeTurnOrNull()?.turnId != turn) timeline.setLocalActiveTurn(turn)
                val active = timeline.activeTurnOrNull() ?: return false
                val text = payload["text"]?.jsonPrimitive?.content.orEmpty()
                val thinking = payload["contentType"]?.jsonPrimitive?.content == "thinking"
                val kind = if (thinking) "thinking" else "text"
                val last = projected.lastOrNull()
                if (last?.value?.type == kind && last.round == round && last.attempt == attempt) {
                    projected[projected.lastIndex] = last.copy(value = last.value.copy(content = last.value.content.orEmpty() + text))
                } else projected += Item(round, attempt, ChatMessageItemResponse(type = kind, content = text))
                val items = projected.map { it.value }
                timeline.applyEvent(ConversationEvent.ActiveTurnUpdated(session, active.copy(
                    text = if (thinking) active.text else active.text + text,
                    thinking = if (thinking) active.thinking.orEmpty() + text else active.thinking,
                    items = items, status = "active", renderVersion = (active.renderVersion ?: 0) + 1,
                )))
            }
            "agentic://tool-event" -> {
                val toolEvent = payload["toolEvent"] as? JsonObject ?: return false
                val id = toolEvent["tool_id"]?.jsonPrimitive?.content ?: return false
                val type = toolEvent["event_type"]?.jsonPrimitive?.content.orEmpty()
                if (timeline.activeTurnOrNull()?.turnId != turn) timeline.setLocalActiveTurn(turn)
                val active = timeline.activeTurnOrNull() ?: return false
                val old = active.tools.orEmpty().firstOrNull { it.id == id } ?: RemoteToolStatusResponse(id = id)
                val status = when (type) {
                    "ConfirmationNeeded" -> "pending_confirmation"
                    "Completed" -> "completed"
                    "Failed" -> "failed"
                    "Cancelled", "Rejected" -> "cancelled"
                    "Queued", "Waiting", "EarlyDetected", "ParamsPartial" -> "queued"
                    else -> "running"
                }
                val tool = old.copy(name = toolEvent["tool_name"]?.jsonPrimitive?.content ?: old.name,
                    status = status, toolInput = toolEvent["params"] ?: old.toolInput,
                    toolOutput = toolEvent["result"] ?: old.toolOutput,
                    errorPreview = toolEvent["error"]?.jsonPrimitive?.content ?: old.errorPreview,
                    durationMs = toolEvent["duration_ms"]?.jsonPrimitive?.longOrNull ?: old.durationMs)
                val tools = active.tools.orEmpty().filterNot { it.id == id } + tool
                val index = projected.indexOfFirst { it.value.tool?.id == id }
                val item = Item(round, attempt, ChatMessageItemResponse(type = "tool", tool = tool))
                if (index < 0) projected += item else projected[index] = item
                val items = projected.map { it.value }
                timeline.applyEvent(ConversationEvent.ActiveTurnUpdated(session, active.copy(tools = tools, items = items,
                    renderVersion = (active.renderVersion ?: 0) + 1)))
            }
            "agentic://model-round-attempt-superseded" -> {
                val diagnostic = payload["diagnostic"] as? JsonObject ?: return false
                val oldAttempt = diagnostic["attemptId"]?.jsonPrimitive?.content.orEmpty()
                projected.removeAll { it.round == round && (oldAttempt.isEmpty() || it.attempt == oldAttempt) }
                val active = timeline.activeTurnOrNull() ?: return false
                val items = projected.map { it.value }
                timeline.applyEvent(ConversationEvent.ActiveTurnUpdated(session, active.copy(
                    text = items.filter { it.type == "text" }.joinToString("") { it.content.orEmpty() },
                    thinking = items.filter { it.type == "thinking" }.joinToString("") { it.content.orEmpty() },
                    tools = items.mapNotNull { it.tool }, items = items,
                    renderVersion = (active.renderVersion ?: 0) + 1,
                )))
            }
            "agentic://dialog-turn-completed", "agentic://dialog-turn-cancelled", "agentic://dialog-turn-failed", "agentic://dialog-turn-interrupted" -> {
                timeline.applyEvent(ConversationEvent.TurnFinished(session, turn, null))
                return true
            }
        }
        return false
    }
}
