package com.openbitfun.mobile.core.feature.session

import kotlinx.serialization.json.*
import kotlin.test.*

class SessionRecordReplicaTest {
    private fun record(revision: Long, status: String, text: String): JsonObject = buildJsonObject {
        put("sessionId", "s"); put("id", "item/i"); put("revision", revision)
        put("turn", buildJsonObject {
            put("sessionId", "s"); put("turnId", "t"); put("turnIndex", 0); put("status", status)
            put("userMessage", buildJsonObject { put("id", "u"); put("content", "question"); put("timestamp", 1) })
        })
        put("round", buildJsonObject { put("id", "r"); put("turnId", "t"); put("roundIndex", 0) })
        put("item", buildJsonObject { put("type", "text"); put("data", buildJsonObject { put("id", "i"); put("content", text); put("orderIndex", 0) }) })
    }
    @Test fun newerRecordsReplaceByStableIdentityAndOlderDeliveryCannotRegress() {
        val replica = SessionRecordReplica("s")
        replica.apply(record(1, "running", "hello"))
        replica.apply(record(3, "completed", "hello world"))
        replica.apply(record(2, "running", "hello wor"))
        val messages = replica.messages()
        assertEquals(2, messages.size)
        assertEquals("u", messages[0].id)
        assertEquals("hello world", messages[1].text)
        assertEquals("completed", messages[1].status)
    }
    @Test fun tombstonesPreventOldReplayResurrection() {
        val replica = SessionRecordReplica("s")
        replica.apply(record(3, "completed", "final"))
        replica.apply(buildJsonObject { put("sessionId", "s"); put("id", "item/i"); put("revision", 4); put("deleted", true) })
        replica.apply(record(3, "completed", "final"))
        assertEquals("", replica.messages()[1].text)
        replica.apply(record(5, "completed", "restored"))
        assertEquals("restored", replica.messages()[1].text)
    }
    @Test fun pendingApprovalIsASeparateControlOverlayAndCompletionClearsIt() {
        val replica = SessionRecordReplica("s")
        replica.apply(record(1, "inprogress", "working"))
        replica.applyControl(buildJsonObject { put("turnId", "t"); put("toolEvent", buildJsonObject { put("event_type", "ConfirmationNeeded"); put("tool_id", "call"); put("tool_name", "Bash"); put("params", buildJsonObject { put("command", "pwd") }) }) })
        val tool = replica.messages()[1].tools.orEmpty().single()
        assertEquals("pending_confirmation", tool.status)
        assertEquals("call", tool.id)
        replica.apply(record(2, "completed", "done"))
        assertTrue(replica.messages()[1].tools.orEmpty().isEmpty())
    }
    @Test fun rejectsForeignSessionBinding() {
        val replica = SessionRecordReplica("other")
        assertFails { replica.apply(record(1, "running", "private")) }
        assertTrue(replica.messages().isEmpty())
    }
}
