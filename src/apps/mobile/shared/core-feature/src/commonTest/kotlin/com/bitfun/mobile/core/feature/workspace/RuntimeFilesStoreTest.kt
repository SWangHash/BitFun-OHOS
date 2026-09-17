package com.bitfun.mobile.core.feature.workspace

import com.bitfun.mobile.core.crypto.ContentHash
import com.bitfun.mobile.core.protocol.*
import com.bitfun.mobile.core.transport.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.*
import kotlin.test.*

class RuntimeFilesStoreTest {
    @Test fun binaryUploadUsesBoundedReadsAndRecoversLostAcknowledgement() = runTest {
        val bytes = ByteArray(7 * 1024 * 1024 + 13) { 37 }
        var begins = 0; var maxRead = 0; var closed = 0; var offset = 0L; var lost = false; var completed = false
        val copied = mutableListOf<Byte>()
        val host = object : RemoteCommandTransport {
            override suspend fun <T : CommandStatus> send(deserializer: DeserializationStrategy<T>, command: RemoteCommand, timeoutMs: Long): T {
                val request = command.args!!.jsonObject.getValue("request").jsonObject
                val value = if (command.command == "get_directory_children_paginated") """{"children":[],"hasMore":false}""" else {
                    assertEquals("saved", request.getValue("remoteConnectionId").jsonPrimitive.content)
                    when (request.getValue("action").jsonPrimitive.content) {
                        "begin" -> { begins++; error("Begin ACK lost") }
                        "append" -> {
                            assertEquals(offset, request.getValue("offset").jsonPrimitive.long)
                            val chunk = kotlin.io.encoding.Base64.decode(request.getValue("contentBase64").jsonPrimitive.content)
                            copied.addAll(chunk.toList()); offset += chunk.size
                            if (!lost) { lost = true; error("ACK lost") }
                        }
                        "finish" -> completed = true
                    }
                    """{"transferId":${request.getValue("transferId")},"totalBytes":${bytes.size},"nextOffset":$offset,"completed":$completed}"""
                }
                return RelayJson.decodeFromString(deserializer, """{"resp":"host_invoke_result","ok":true,"value":$value}""")
            }
        }
        val store = RuntimeFilesStore(this, host)
        store.browse("/repo", "/repo", "saved", false); advanceUntilIdle()
        store.upload("/repo/new", object : RuntimeUploadSource {
            override val size = bytes.size.toLong()
            override fun read(offset: Long, length: Int): ByteArray { maxRead = maxOf(maxRead, length); return bytes.copyOfRange(offset.toInt(), offset.toInt() + length) }
            override fun close() { closed++ }
        })
        // File adapter reads run on Dispatchers.Default, outside the virtual clock.
        while (store.state.value.busy) { kotlinx.coroutines.delay(1); testScheduler.runCurrent() }
        assertEquals(1, begins); assertFalse(store.state.value.failed); assertTrue(completed); assertEquals(1, closed)
        assertTrue(maxRead <= 3 * 1024 * 1024); assertContentEquals(bytes, copied.toByteArray())
    }

    @Test fun fileWritesUseRuntimeScopeAndOriginalHashAndFailuresPreserveContent() = runTest {
        val host = FileHost(); val store = RuntimeFilesStore(this, host)
        store.browse("/repo", "/repo", "saved-ssh", false); advanceUntilIdle()
        store.read("/repo/file"); advanceUntilIdle()
        store.save("changed"); advanceUntilIdle()
        val write = host.commands.last().args!!.jsonObject.getValue("request").jsonObject
        assertEquals("saved-ssh", write.getValue("remoteConnectionId").jsonPrimitive.content)
        assertEquals(ContentHash.sha256("original"), write.getValue("expectedHash").jsonPrimitive.content)
        host.accepted = false
        store.save("conflict"); advanceUntilIdle()
        assertTrue(store.state.value.failed); assertEquals("changed", store.state.value.content)
        host.accepted = true
        store.renameFile("/repo/renamed"); advanceUntilIdle(); assertEquals("/repo/renamed", store.state.value.file)
        store.deleteFile(); advanceUntilIdle(); assertNull(store.state.value.file)
        store.createFile("/repo/new"); advanceUntilIdle()
        assertEquals("", host.commands.last().args!!.jsonObject.getValue("request").jsonObject.getValue("expectedHash").jsonPrimitive.content)
        store.reset(); store.save("stale"); advanceUntilIdle(); assertTrue(store.state.value.failed)
    }
    @Test fun sortingResetsServerPageAndClosingEditorPreservesDirectory() = runTest {
        val host = FileHost(); val store = RuntimeFilesStore(this, host)
        store.browse("/repo/sub", "/repo", "saved-ssh", false); advanceUntilIdle()
        for ((sort, by, order) in listOf(Triple(RuntimeFileSort.NAME_ASC, "name", "asc"), Triple(RuntimeFileSort.NAME_DESC, "name", "desc"), Triple(RuntimeFileSort.MODIFIED_DESC, "modified", "desc"), Triple(RuntimeFileSort.MODIFIED_ASC, "modified", "asc"))) {
            store.sort(sort); advanceUntilIdle()
            val request = host.commands.last().args!!.jsonObject.getValue("request").jsonObject
            assertEquals(by, request.getValue("sortBy").jsonPrimitive.content)
            assertEquals(order, request.getValue("sortOrder").jsonPrimitive.content)
            assertEquals(0, request.getValue("offset").jsonPrimitive.int)
            assertEquals("saved-ssh", request.getValue("remoteConnectionId").jsonPrimitive.content)
            assertEquals(sort, store.state.value.sort)
        }
        store.read("/repo/sub/file"); advanceUntilIdle(); store.closeFile()
        assertNull(store.state.value.file); assertEquals("/repo/sub", store.state.value.directory)
        assertEquals(RuntimeFileSort.MODIFIED_ASC, store.state.value.sort)
    }
    private class FileHost : RemoteCommandTransport {
        var accepted = true
        val commands = mutableListOf<RemoteCommand>()
        override suspend fun <T : CommandStatus> send(deserializer: DeserializationStrategy<T>, command: RemoteCommand, timeoutMs: Long): T {
            commands += command
            val value = when(command.command) {
                "get_directory_children_paginated" -> """{"children":[],"hasMore":false}"""
                "read_file_content" -> "\"original\""
                else -> "null"
            }
            return RelayJson.decodeFromString(deserializer, """{"resp":"host_invoke_result","ok":$accepted,"value":$value}""")
        }
    }
}
