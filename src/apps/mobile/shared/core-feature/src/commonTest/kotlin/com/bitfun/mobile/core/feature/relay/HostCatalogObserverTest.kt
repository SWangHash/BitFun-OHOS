package com.bitfun.mobile.core.feature.relay

import com.bitfun.mobile.core.persistence.*
import com.bitfun.mobile.core.transport.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.JsonObject
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class HostCatalogObserverTest {
    @Test fun workspaceAndSessionShareOneTargetStreamAndReleaseItWhenBothLeave() = runTest {
        var attached = 0; var closed = 0
        val source = object : RemoteSessionStreamTransport {
            override val streamIdentity = "account-target"
            override suspend fun subscribe(sessionId: String, replica: SessionStreamReplica, onError: (Throwable) -> Unit, onCaughtUp: () -> Unit): Flow<JsonObject> = flow {
                assertEquals("@host/catalog", sessionId)
                attached++; onCaughtUp()
                try { awaitCancellation() } finally { closed++ }
            }
        }
        val persistence = object : RelayStreamStore {
            override fun eventIds(stream: String) = emptyList<String>()
            override fun cursor(stream: String) = 0L
            override fun fragments(stream: String, eventId: String) = emptyList<String>()
            override fun commit(stream: String, fragments: List<PersistedRelayFragment>, cursor: Long) {}
        }
        val changes = hostCatalogObserver(backgroundScope, source, persistence)
        val a = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { changes.collect() }
        val b = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { changes.collect() }
        runCurrent(); assertEquals(1, attached)
        a.cancel(); runCurrent(); assertEquals(0, closed)
        b.cancel(); runCurrent(); assertEquals(1, closed)
    }
}
