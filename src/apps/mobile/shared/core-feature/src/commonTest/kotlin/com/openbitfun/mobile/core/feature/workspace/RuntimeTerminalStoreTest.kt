package com.openbitfun.mobile.core.feature.workspace

import com.openbitfun.mobile.core.persistence.*
import com.openbitfun.mobile.core.protocol.*
import com.openbitfun.mobile.core.transport.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.*
import kotlin.test.*

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class RuntimeTerminalStoreTest {
    @Test fun hostOwnsTerminalAndPushNotificationReadsOnlyNewOutput() = runTest {
        val host = FakeTerminalHost()
        val store = RuntimeTerminalStore(this, host, MemoryReplica())
        store.open("/workspace", "saved-ssh")
        advanceUntilIdle()
        assertEquals("hello world", store.state.value.output)
        assertEquals(listOf(0L, 5L), host.offsets)
        val create = host.commands.first().args!!.jsonObject.getValue("request").jsonObject
        assertEquals("saved-ssh", create.getValue("connectionId").jsonPrimitive.content)
        assertEquals("/workspace", create.getValue("workingDirectory").jsonPrimitive.content)
        assertEquals("terminal-term1", host.stream)
        store.write("pwd\r")
        advanceUntilIdle()
        assertEquals("terminal_write", host.commands.last().command)
        store.close()
        advanceUntilIdle()
        assertNull(store.state.value.sessionId)
        assertEquals("terminal_close", host.commands.last().command)
        store.stop()
    }

    @Test fun rapidInputAndResizeAreBatchedAndStopDiscardsQueuedInput() = runTest {
        val host = FakeTerminalHost()
        val store = RuntimeTerminalStore(this, host, MemoryReplica())
        store.open("/workspace", null); advanceUntilIdle()
        "pwd\r".forEach { store.write(it.toString()) }
        store.resize(100, 30); store.resize(120, 40)
        advanceUntilIdle()
        val writes = host.commands.filter { it.command == "terminal_write" }
        assertEquals(1, writes.size)
        assertEquals("pwd\r", writes.single().args!!.jsonObject.getValue("request").jsonObject.getValue("data").jsonPrimitive.content)
        val sizes = host.commands.filter { it.command == "terminal_resize" }
        assertEquals(1, sizes.size)
        assertEquals(120, sizes.single().args!!.jsonObject.getValue("request").jsonObject.getValue("cols").jsonPrimitive.int)
        assertEquals(2L, store.state.value.revision)
        store.write("must-not-send"); store.stop(); advanceUntilIdle()
        assertEquals(1, host.commands.count { it.command == "terminal_write" })
    }

    @Test fun hostRefusalDoesNotReportAnOpenTerminal() = runTest {
        val host = FakeTerminalHost(false)
        val store = RuntimeTerminalStore(this, host, MemoryReplica())
        store.open("/workspace", null)
        advanceUntilIdle()
        assertNull(store.state.value.sessionId)
        assertTrue(store.state.value.failed)
        store.stop()
    }
}

private class FakeTerminalHost(private val accepted: Boolean = true) : RemoteCommandTransport, RemoteSessionStreamTransport {
    val commands = mutableListOf<RemoteCommand>()
    val offsets = mutableListOf<Long>()
    var stream = ""
    override val streamIdentity = "test-account-target"
    override suspend fun subscribe(sessionId: String, replica: SessionStreamReplica, onError: (Throwable) -> Unit, onCaughtUp: () -> Unit): Flow<JsonObject> {
        stream = sessionId
        return flow { onCaughtUp(); emit(buildJsonObject { put("event", "terminal-output") }) }
    }
    override suspend fun <T : CommandStatus> send(deserializer: DeserializationStrategy<T>, command: RemoteCommand, timeoutMs: Long): T {
        commands += command
        val value = when (command.command) {
            "terminal_create" -> """{"id":"term1"}"""
            "terminal_get_history" -> {
                val offset = command.args!!.jsonObject.getValue("afterOffset").jsonPrimitive.long
                offsets += offset
                if (offset == 0L) """{"data":"hello","nextOffset":5,"cursor":11,"truncated":false}"""
                else """{"data":" world","nextOffset":11,"cursor":11,"truncated":false}"""
            }
            else -> "null"
        }
        return RelayJson.decodeFromString(deserializer, """{"resp":"host_invoke_result","ok":$accepted,"value":$value}""")
    }
}
private class MemoryReplica : RelayStreamStore {
    override fun eventIds(stream: String) = emptyList<String>()
    override fun cursor(stream: String) = 0L
    override fun fragments(stream: String, eventId: String) = emptyList<String>()
    override fun commit(stream: String, fragments: List<PersistedRelayFragment>, cursor: Long) {}
}
