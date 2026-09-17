package com.bitfun.mobile.core.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString

class WorkspaceHostTest {
    @Test fun retainsHostAndAcceptsLegacyPayload() {
        val json = Json { ignoreUnknownKeys = true }
        val legacy = json.decodeFromString<RecentWorkspaceEntryResponse>("""{"path":"/app","name":"App"}""")
        assertNull(legacy.remoteSshHost)
        for (host in listOf("10.0.0.8", "build.example.org", "2001:db8::1")) {
            val entry = json.decodeFromString<RecentWorkspaceEntryResponse>("""{"path":"/app","name":"App","remote_ssh_host":"$host"}""")
            assertEquals(host, entry.remoteSshHost)
            assertEquals(entry, json.decodeFromString<RecentWorkspaceEntryResponse>(json.encodeToString(entry)))
        }
    }
}
