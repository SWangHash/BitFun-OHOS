package com.bitfun.mobile.core.feature.session

import com.bitfun.mobile.core.protocol.*
import com.bitfun.mobile.core.transport.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.*
import kotlin.test.*

class PermissionMailboxStoreTest {
    @Test fun requestsWithoutToolCallsRemainAnswerableAndEditsUseRequestIdentity() = runTest {
        val host = Host()
        var latest = PermissionMailboxUiState(emptyList(), false, false)
        val store = PermissionMailboxStore(this, host) { latest = it }
        store.select("session"); advanceUntilIdle()
        assertEquals(listOf("request-id"), latest.requests.map { it.requestId })
        assertNull(latest.requests.single().toolCallId)
        assertEquals("question-id", latest.questions.single().id)
        assertEquals("Continue?", latest.questions.single().question)
        store.respond("request-id", true, """{"path":"/new"}"""); advanceUntilIdle()
        val reply = host.commands.first { it.command == "respond_permission" }.args!!.jsonObject.getValue("request").jsonObject
        assertEquals("request-id", reply.getValue("requestId").jsonPrimitive.content)
        assertEquals("once", reply.getValue("reply").jsonPrimitive.content)
        assertEquals("/new", reply.getValue("updatedInput").jsonObject.getValue("path").jsonPrimitive.content)
        host.ok = false; store.invalidate(); advanceUntilIdle()
        assertTrue(latest.failed); assertEquals(1, latest.requests.size)
        store.select(null); assertTrue(latest.requests.isEmpty())
    }
    @Test fun malformedEditIsRejectedWithoutSendingApproval() = runTest {
        val host = Host(); var latest = PermissionMailboxUiState(emptyList(), false, false)
        val store = PermissionMailboxStore(this, host) { latest = it }
        store.select("session"); advanceUntilIdle(); store.respond("request-id", true, "[]"); advanceUntilIdle()
        assertTrue(latest.failed); assertTrue(host.commands.none { it.command == "respond_permission" })
    }
    private class Host : RemoteCommandTransport {
        var ok = true
        val commands = mutableListOf<RemoteCommand>()
        override suspend fun <T : CommandStatus> send(deserializer: DeserializationStrategy<T>, command: RemoteCommand, timeoutMs: Long): T {
            commands += command
            val value = if (command.command == "get_session_interaction_mailbox") """{"sessionId":"session","permissions":{"requests":[{"requestId":"request-id","sessionId":"session","action":"write","resources":["/file"],"source":{"identity":"agent"}},{"requestId":"other","sessionId":"other","action":"write"}]},"userQuestions":{"questions":[{"sessionId":"session","toolId":"question-id","questions":{"questions":[{"question":"Continue?"}]}}]}}""" else "null"
            return RelayJson.decodeFromString(deserializer, """{"resp":"host_invoke_result","ok":$ok,"value":$value}""")
        }
    }
}
