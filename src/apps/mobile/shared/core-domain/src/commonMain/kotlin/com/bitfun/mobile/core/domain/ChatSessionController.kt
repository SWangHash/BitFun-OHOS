package com.bitfun.mobile.core.domain

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.time.Clock

/** Transport port consumed by the session poller. */
public interface ChatSessionPoller {
    public suspend fun pollSession(
        sessionId: String,
        sinceVersion: Int,
        knownMessageCount: Int,
        knownModelCatalogVersion: Long,
    ): PollSessionResult
}

public interface ChatSessionControllerCallbacks {
    public fun onSnapshot(snapshot: ChatSessionSnapshot)

    public fun onError(error: Throwable)

    public fun canPoll(sessionId: String): Boolean
}

/**
 * Refreshes session state after initialization or an explicit invalidation.
 * Durable relay notifications drive invalidations; there is no periodic request loop.
 * The controller owns lifecycle and coalescing; [ChatTimelineStore]
 * remains the reducer for messages and events.
 */
public class ChatSessionController internal constructor(
    private val scope: CoroutineScope,
    private val poller: ChatSessionPoller,
    private val callbacks: ChatSessionControllerCallbacks,
) {
    private var sessionId: String = ""
    private var cursor: ChatSessionCursor = ChatSessionCursor(0, 0, 0)
    private var activeTurn: ChatMessage? = null
    private var polling = false
    private var refreshPending = false
    private var stopped = true
    private var generation = 0
    private var hasActiveRunningTurn = false
    private var turnJustEndedAt: Long = 0
    private var loopJob: Job? = null

    public fun start(sessionId: String, cursor: ChatSessionCursor) {
        start(sessionId, cursor, null)
    }

    public fun start(sessionId: String, cursor: ChatSessionCursor, activeTurn: ChatMessage?) {
        attach(sessionId, cursor, activeTurn)
        scheduleNext(0)
    }

    public fun attach(sessionId: String, cursor: ChatSessionCursor) { attach(sessionId, cursor, null) }

    public fun attach(sessionId: String, cursor: ChatSessionCursor, activeTurn: ChatMessage?) {
        stop(false)
        this.sessionId = sessionId
        this.cursor = cursor.copy()
        this.activeTurn = activeTurn?.takeIf { it.id.isNotEmpty() }
        hasActiveRunningTurn = isRunningTurn(this.activeTurn)
        turnJustEndedAt = 0
        stopped = false
    }

    public fun stop() {
        stop(true)
    }

    public fun stop(clearActiveTurn: Boolean) {
        generation += 1
        loopJob?.cancel()
        loopJob = null
        polling = false
        refreshPending = false
        stopped = true
        hasActiveRunningTurn = false
        turnJustEndedAt = 0
        if (clearActiveTurn) activeTurn = null
    }

    public fun nudge() {
        if (sessionId.isEmpty()) return
        hasActiveRunningTurn = true
        turnJustEndedAt = 0
        // A poll already in flight is the one that will carry the answer, and
        // the loop job is the coroutine running it — cancelling it here would
        // throw away the request and leave nothing to schedule the next one.
        // Its own `finally` reschedules, and now at the active interval.
        if (polling) { refreshPending = true; return }
        scheduleNext(0)
    }

    public fun updateCursor(cursor: ChatSessionCursor) {
        this.cursor = cursor.copy()
    }

    public fun updateKnownModelCatalogVersion(version: Long) {
        cursor = cursor.copy(knownModelCatalogVersion = version)
    }

    public fun setKnownMessageCount(count: Int) {
        cursor = cursor.copy(knownMessageCount = count)
    }

    public fun clearActiveTurn() {
        activeTurn = null
        hasActiveRunningTurn = false
        turnJustEndedAt = 0
    }

    public suspend fun pollNow() {
        if (stopped || polling || sessionId.isEmpty() || !callbacks.canPoll(sessionId)) return
        val requestGeneration = generation
        val requestSessionId = sessionId
        val requestCursor = cursor.copy()
        polling = true
        refreshPending = false
        try {
            val result = poller.pollSession(
                requestSessionId,
                requestCursor.pollVersion,
                requestCursor.knownMessageCount,
                requestCursor.knownModelCatalogVersion,
            )
            if (isCurrentRequest(requestGeneration, requestSessionId)) applyPollResult(result)
        } catch (cancelled: CancellationException) {
            // Not a transport failure: the screen went away or the loop was
            // restarted. Reporting it would put the session into a failed state
            // that the caller never asked for.
            throw cancelled
        } catch (error: Throwable) {
            if (isCurrentRequest(requestGeneration, requestSessionId)) callbacks.onError(error)
        } finally {
            if (isCurrentRequest(requestGeneration, requestSessionId)) {
                polling = false
                if (refreshPending) scheduleNext(0)
            }
        }
    }

    private fun isCurrentRequest(requestGeneration: Int, requestSessionId: String): Boolean =
        requestGeneration == generation && !stopped && requestSessionId == sessionId

    private fun applyPollResult(result: PollSessionResult) {
        val hadRunningTurn = hasActiveRunningTurn
        val incomingMessages = result.newMessages
        val persistedProjection = result.messageSnapshot ?: incomingMessages
        val hasAssistantMessage = persistedProjection.any { it.role == "assistant" }
        val historyRewritten = result.hasAuthoritativeMessageCount &&
            result.totalMessageCount < cursor.knownMessageCount
        if (result.changed) {
            cursor = cursor.copy(
                pollVersion = result.version,
                knownMessageCount = if (result.hasAuthoritativeMessageCount) {
                    result.totalMessageCount
                } else {
                    cursor.knownMessageCount
                },
                knownModelCatalogVersion = result.modelCatalog?.version ?: cursor.knownModelCatalogVersion,
            )
        }
        if (result.activeTurn?.id?.isNotEmpty() == true) {
            activeTurn = result.activeTurn
        } else if (result.changed && (hasAssistantMessage || shouldClearMissingActiveTurn(result))) {
            activeTurn = null
        }
        val runningNow = isRunningTurn(activeTurn)
        val turnEndedNow = hadRunningTurn && !runningNow
        if (turnEndedNow) turnJustEndedAt = nowMs()
        hasActiveRunningTurn = runningNow
        val settling = turnJustEndedAt > 0 && nowMs() - turnJustEndedAt < TURN_ENDED_GRACE_MS
        callbacks.onSnapshot(
            ChatSessionSnapshot(
                sessionId = sessionId,
                cursor = cursor.copy(),
                changed = result.changed || result.activeTurn != null,
                title = result.title,
                sessionState = result.sessionState,
                newMessages = incomingMessages,
                activeTurn = activeTurn,
                modelCatalog = result.modelCatalog,
                shouldSyncAfterTurnEnded = turnEndedNow || (settling && !runningNow),
                messageSnapshot = result.messageSnapshot,
                historyRewritten = historyRewritten,
            ),
        )
    }

    private fun shouldClearMissingActiveTurn(result: PollSessionResult): Boolean {
        val active = activeTurn ?: return false
        return result.sessionState.lowercase() == "idle" && active.status.lowercase() != "completed"
    }

    private fun scheduleNext(delayMs: Long) {
        if (stopped || sessionId.isEmpty()) return
        loopJob?.cancel()
        val scheduledGeneration = generation
        val scheduledSessionId = sessionId
        loopJob = scope.launch {
            delay(delayMs)
            if (scheduledGeneration == generation && scheduledSessionId == sessionId && !stopped) pollNow()
        }
    }

    private fun isRunningTurn(turn: ChatMessage?): Boolean =
        turn != null && turn.id.isNotEmpty() && turn.status.lowercase() == "active"

    private fun nowMs(): Long = Clock.System.now().toEpochMilliseconds()

    public companion object {
        private const val TURN_ENDED_GRACE_MS = 5_000L

        public fun create(
            scope: CoroutineScope,
            poller: ChatSessionPoller,
            callbacks: ChatSessionControllerCallbacks,
        ): ChatSessionController = ChatSessionController(scope, poller, callbacks)
    }
}
