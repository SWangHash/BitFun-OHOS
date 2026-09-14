package com.openbitfun.mobile.core.feature.session

import com.openbitfun.mobile.core.protocol.RelayJson
import com.openbitfun.mobile.core.protocol.RemoteToolStatusResponse
import kotlin.test.*

class PlanToolPolicyTest {
    @Test fun recognizesLegacyModernAndStructuredPlans() {
        val legacy = PlanToolPolicy.descriptor("CreatePlan", """{"plan_file_path":"/repo/a.plan.md","name":"A","overview":"Steps"}""", "")!!
        assertEquals("A", legacy.name)
        assertEquals("Steps", legacy.overview)
        assertEquals("b", PlanToolPolicy.descriptor("write_file", """{"file_path":"/repo/b.plan.md"}""", "")!!.name)
        assertNull(PlanToolPolicy.descriptor("Read", "", "/repo/a.plan.md"))
        assertNull(PlanToolPolicy.descriptor("Write", "malformed", "/repo/a.md"))
        val structured = RelayJson.decodeFromString<RemoteToolStatusResponse>("""{"id":"plan","name":"Other","status":"completed","plan":{"file_path":"/repo/structured.plan.md","name":"Structured"}}""")
        val card = toolCard(structured)
        assertEquals("Structured", card.plan?.name)
        assertFalse(card.foldIntoSummary)
        val old = RelayJson.decodeFromString<RemoteToolStatusResponse>("""{"id":"old","name":"Read"}""")
        assertNull(old.plan)
        assertEquals(old, RelayJson.decodeFromString<RemoteToolStatusResponse>(RelayJson.encodeToString(old)))
    }
}
