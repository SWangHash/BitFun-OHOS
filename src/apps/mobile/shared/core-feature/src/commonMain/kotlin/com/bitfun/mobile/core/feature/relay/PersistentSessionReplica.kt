package com.bitfun.mobile.core.feature.relay

import com.bitfun.mobile.core.persistence.RelayStreamStore
import com.bitfun.mobile.core.persistence.PersistedRelayFragment
import com.bitfun.mobile.core.protocol.RelayJson
import com.bitfun.mobile.core.transport.SessionStreamReplica
import kotlinx.serialization.json.*

internal class PersistentSessionReplica(private val store: RelayStreamStore, private val stream: String) : SessionStreamReplica {
    override suspend fun eventIds() = store.eventIds(stream)
    override suspend fun historyBefore() = store.cursor(stream + ":history-before")
    override suspend fun setHistoryBefore(value: Long) { store.commit(stream + ":history-before", emptyList(), value) }
    override suspend fun cursor() = store.cursor(stream)
    override suspend fun fragments(eventId: String) = store.fragments(stream, eventId)
    override suspend fun commitHistory(fragments: List<String>, cursor: Long, before: Long) {
        store.commitHistory(stream, fragments.map { content ->
            val fragment = RelayJson.parseToJsonElement(content).jsonObject
            PersistedRelayFragment(fragment.getValue("eventId").jsonPrimitive.content, fragment.getValue("index").jsonPrimitive.long, content)
        }, cursor, before)
    }
    override suspend fun commit(fragments: List<String>, cursor: Long) {
        store.commit(stream, fragments.map { content ->
            val fragment = RelayJson.parseToJsonElement(content).jsonObject
            PersistedRelayFragment(fragment.getValue("eventId").jsonPrimitive.content,
                fragment.getValue("index").jsonPrimitive.long, content)
        }, cursor)
    }
}
