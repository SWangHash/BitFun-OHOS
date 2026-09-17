package com.bitfun.mobile.core.feature.session

import com.bitfun.mobile.core.domain.ChatTimelineStore
import kotlinx.serialization.json.*
import kotlin.test.*

class DurableSessionReducerTest {
    private fun event(name: String, body: JsonObject = buildJsonObject {}) = buildJsonObject {
        put("session_id", "session")
        put("event", "agentic://$name")
        put("payload", buildJsonObject { put("sessionId", "session"); put("turnId", "turn"); body.forEach { (k, v) -> put(k, v) } })
    }
    @Test fun textThinkingAndToolPermissionReduceLocallyInOrder() {
        val reducer = DurableSessionReducer()
        val timeline = ChatTimelineStore().also { it.reset("session") }
        reducer.apply(timeline, event("dialog-turn-started"))
        reducer.apply(timeline, event("text-chunk", buildJsonObject { put("text", "plan"); put("contentType", "thinking") }))
        reducer.apply(timeline, event("text-chunk", buildJsonObject { put("text", "hello") }))
        reducer.apply(timeline, event("tool-event", buildJsonObject {
            put("toolEvent", buildJsonObject { put("event_type", "ConfirmationNeeded"); put("tool_id", "t1"); put("tool_name", "Bash"); put("params", buildJsonObject { put("command", "pwd") }) })
        }))
        val active = assertNotNull(timeline.activeTurnOrNull())
        assertEquals("hello", active.text)
        assertEquals("plan", active.thinking)
        assertEquals(listOf("thinking", "text", "tool"), active.items!!.map { it.type })
        assertEquals("pending_confirmation", active.tools!!.single().status)
        assertTrue(reducer.apply(timeline, event("dialog-turn-completed")))
        assertEquals("completed", timeline.activeTurnOrNull()?.status)
    }
    @Test fun anotherSessionsEventsCannotChangeTheCurrentTimeline() {
        val reducer = DurableSessionReducer()
        val timeline = ChatTimelineStore().also { it.reset("other") }
        assertFalse(reducer.apply(timeline, event("text-chunk", buildJsonObject { put("text", "private") })))
        assertNull(timeline.activeTurnOrNull())
    }
}
