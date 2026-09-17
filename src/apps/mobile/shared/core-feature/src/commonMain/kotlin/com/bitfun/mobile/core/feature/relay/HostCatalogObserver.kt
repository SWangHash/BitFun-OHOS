package com.bitfun.mobile.core.feature.relay

import com.bitfun.mobile.core.persistence.RelayStreamStore
import com.bitfun.mobile.core.transport.RemoteSessionStreamTransport
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.delay
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull

internal sealed interface HostCatalogNotice {
    data object Changed : HostCatalogNotice
    data object Failed : HostCatalogNotice
}

/** One account/target stream, shared by workspace and session catalog consumers. */
internal fun hostCatalogObserver(scope: CoroutineScope, source: RemoteSessionStreamTransport, store: RelayStreamStore): Flow<HostCatalogNotice> = channelFlow {
    var backoff = 1_000L
    while (currentCoroutineContext().isActive) {
        var caughtUp = false
        try {
            val replica = PersistentSessionReplica(store, source.streamIdentity + ":host-catalog")
            source.subscribe("@host/catalog", replica, { trySend(HostCatalogNotice.Failed) }, {
                if (!caughtUp) { caughtUp = true; backoff = 1_000L; trySend(HostCatalogNotice.Changed) }
            }).collect { event ->
                if (caughtUp && event["event"]?.jsonPrimitive?.contentOrNull in setOf("host-catalog-changed", "relay://session-resumed")) send(HostCatalogNotice.Changed)
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Throwable) { send(HostCatalogNotice.Failed) }
        delay(backoff); backoff = (backoff * 2).coerceAtMost(30_000L)
    }
}.buffer(Channel.CONFLATED).shareIn(scope, SharingStarted.WhileSubscribed(), replay = 0)
