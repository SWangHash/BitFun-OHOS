package com.openbitfun.mobile.core.persistence

import app.cash.sqldelight.db.SqlDriver
import com.openbitfun.mobile.core.persistence.db.MobileDatabase

public data class PersistedRelayFragment(public val eventId: String, public val index: Long, public val content: String)
public interface RelayStreamStore {
    public fun eventIds(stream: String): List<String>
    public fun cursor(stream: String): Long
    public fun fragments(stream: String, eventId: String): List<String>
    public fun commitHistory(stream: String, fragments: List<PersistedRelayFragment>, cursor: Long, before: Long) { commit(stream, fragments, cursor); commit(stream + ":history-before", emptyList(), before) }
    public fun commit(stream: String, fragments: List<PersistedRelayFragment>, cursor: Long)
}

public class SqlDelightRelayStreamStore(driver: SqlDriver) : RelayStreamStore {
    private val database = MobileDatabase(driver)
    private val queries = database.mobileQueries
    override fun eventIds(stream: String): List<String> = queries.relayStreamEventIds(stream).executeAsList()
    override fun cursor(stream: String): Long = queries.relayStreamCursor(stream).executeAsOneOrNull() ?: 0L
    override fun fragments(stream: String, eventId: String): List<String> = queries.relayStreamFragments(stream, eventId).executeAsList()
    override fun commitHistory(stream: String, fragments: List<PersistedRelayFragment>, cursor: Long, before: Long) {
        database.transaction {
            fragments.forEach { queries.relayStreamCommitFragment(stream, it.eventId, it.index, it.content) }
            queries.relayStreamCommitCursor(stream, cursor)
            queries.relayStreamCommitCursor(stream + ":history-before", before)
        }
    }
    override fun commit(stream: String, fragments: List<PersistedRelayFragment>, cursor: Long) {
        database.transaction {
            fragments.forEach { queries.relayStreamCommitFragment(stream, it.eventId, it.index, it.content) }
            queries.relayStreamCommitCursor(stream, cursor)
        }
    }
}
