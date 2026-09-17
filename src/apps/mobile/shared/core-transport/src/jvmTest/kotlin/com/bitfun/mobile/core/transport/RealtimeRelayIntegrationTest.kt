package com.bitfun.mobile.core.transport

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assume.assumeTrue
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/** Real source-built Relay and host required. Credentials never enter Gradle arguments. */
class RealtimeRelayIntegrationTest {
    @Test
    fun concurrentCallsUseOneAccountSocket(): Unit = runBlocking {
        val credentials = System.getenv("BITFUN_RELAY_LAB_CREDENTIALS")
        assumeTrue("Requires a source-built Relay lab", !credentials.isNullOrBlank())
        val config = Json.parseToJsonElement(Files.readString(Path.of(credentials))).jsonObject
        val http = relayHttpClient()
        val realtime = AccountRealtime(http, config.getValue("url").jsonPrimitive.content,
            config.getValue("token").jsonPrimitive.content)
        try {
            val large = "x".repeat(3 * 1024 * 1024)
            val bulk = realtime.call(config.getValue("target").jsonPrimitive.content,
                buildJsonObject { put("large", large) }, 50_000)
            assertEquals(large, bulk.jsonObject.getValue("echo").jsonObject.getValue("large").jsonPrimitive.content)
            coroutineScope {
                (0 until 128).map { number -> async {
                    val result = realtime.call(config.getValue("target").jsonPrimitive.content,
                        buildJsonObject { put("number", number) }, 50_000)
                    assertEquals(number, result.jsonObject.getValue("echo").jsonObject.getValue("number").jsonPrimitive.int)
                } }.awaitAll()
            }
            assertEquals(1, realtime.connections.value)
            realtime.close()
            assertFailsWith<CloudAccountException> {
                realtime.call("host", buildJsonObject {}, 1000)
            }
        } finally { realtime.close(); http.close() }
    }
}
