package com.bitfun.mobile.app

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.test.performScrollToIndex
import com.bitfun.mobile.core.feature.session.HistoryLoadState
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.bitfun.mobile.app.ui.chat.CONVERSATION_LIST_TEST_TAG
import com.bitfun.mobile.app.ui.chat.CONVERSATION_LOADING_TEST_TAG
import com.bitfun.mobile.app.ui.chat.CHAT_STATUS_DOT_TEST_TAG
import com.bitfun.mobile.app.ui.chat.CHAT_STATUS_BAR_TEST_TAG
import com.bitfun.mobile.app.ui.chat.ChatStatusBar
import com.bitfun.mobile.app.ui.chat.ConversationEmptyState
import com.bitfun.mobile.app.ui.chat.ConversationTimelineView
import com.bitfun.mobile.app.ui.chat.COMPOSER_INPUT_TEST_TAG
import com.bitfun.mobile.app.ui.chat.COMPOSER_SEND_TEST_TAG
import com.bitfun.mobile.app.ui.chat.ConversationView
import com.bitfun.mobile.app.ui.theme.BitFunTheme
import com.bitfun.mobile.core.feature.connection.ConnectionPhase
import com.bitfun.mobile.core.feature.layout.SettingsPlacement
import com.bitfun.mobile.core.feature.layout.SettingsPlacementMode
import com.bitfun.mobile.core.feature.session.ConversationRow
import com.bitfun.mobile.core.feature.session.ConversationRowKind
import com.bitfun.mobile.core.feature.session.RemoteSessionIntent
import com.bitfun.mobile.core.feature.session.RemoteSessionUiState
import com.bitfun.mobile.core.feature.session.SessionAgentFilter
import com.bitfun.mobile.core.feature.workspace.RemoteFileDownloadUiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ConversationViewTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun openingATallLastMessageStartsAtTheActualTail() {
        val answer = List(500) { "A long answer line." }.joinToString(" ") + " tail-marker"

        composeRule.setContent {
            BitFunTheme(dark = false) {
                ConversationTimelineView(
                    rows = listOf(assistantRow(answer)),
                    hasMoreMessages = false,
                    onLoadOlder = {},
                    enabled = true,
                    onApproveTool = {},
                    onRejectTool = { _, _ -> },
                    onCancelTool = { _, _ -> },
                    onAnswerTool = { _, _ -> },
                    onAnswerToolStructured = { _, _ -> },
                    onRetry = {},
                    onOpenFile = { _, _ -> },
                    previewingRemotePath = "",
                    previewLoading = false,
                    download = RemoteFileDownloadUiState.None,
                    onDownloadFile = { _, _ -> },
                    downloadEnabled = true,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }

        composeRule.waitForIdle()

        val listBounds = composeRule.onNodeWithTag(CONVERSATION_LIST_TEST_TAG)
            .getUnclippedBoundsInRoot()
        val answerBounds = composeRule.onNodeWithText("tail-marker", substring = true)
            .getUnclippedBoundsInRoot()
        assertTrue(answerBounds.bottom <= listBounds.bottom + 1.dp)
        composeRule.onNodeWithContentDescription(string(R.string.chat_scroll_to_bottom))
            .assertDoesNotExist()
    }

    @Test
    fun streamingGrowthKeepsFollowingWhileTheReaderIsAtTheTail() {
        val row = mutableStateOf(assistantRow("stream-start", streaming = true))

        composeRule.setContent {
            BitFunTheme(dark = false) {
                TimelineForTest(listOf(row.value))
            }
        }
        composeRule.runOnIdle {
            row.value = assistantRow(
                List(500) { "Streaming answer line." }.joinToString(" ") + " stream-tail-marker",
                streaming = true,
            )
        }
        composeRule.waitForIdle()

        val listBounds = composeRule.onNodeWithTag(CONVERSATION_LIST_TEST_TAG)
            .getUnclippedBoundsInRoot()
        val answerBounds = composeRule.onNodeWithText("stream-tail-marker", substring = true)
            .getUnclippedBoundsInRoot()
        assertTrue(answerBounds.bottom <= listBounds.bottom + 1.dp)
        composeRule.onNodeWithContentDescription(string(R.string.chat_scroll_to_bottom))
            .assertDoesNotExist()
    }

    @Test
    fun streamingGrowthDoesNotStealTheReaderAfterTheyLeaveTheTail() {
        val rows = mutableStateOf((1..40).map { index -> assistantRow("message-$index", id = "message-$index") })

        composeRule.setContent {
            BitFunTheme(dark = false) {
                TimelineForTest(rows.value)
            }
        }
        composeRule.waitForIdle()
        composeRule.onNodeWithTag(CONVERSATION_LIST_TEST_TAG).performTouchInput {
            swipeDown()
            swipeDown()
        }
        composeRule.waitForIdle()
        composeRule.onNodeWithContentDescription(string(R.string.chat_scroll_to_bottom)).assertIsDisplayed()

        composeRule.runOnIdle {
            rows.value = rows.value.dropLast(1) +
                assistantRow(
                    List(400) { "Growing final answer." }.joinToString(" ") + " reader-tail-marker",
                    id = "message-40",
                    streaming = true,
                )
        }
        composeRule.waitForIdle()

        composeRule.onNodeWithContentDescription(string(R.string.chat_scroll_to_bottom))
            .assertIsDisplayed()
            .performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("reader-tail-marker", substring = true).assertIsDisplayed()
        composeRule.onNodeWithContentDescription(string(R.string.chat_scroll_to_bottom))
            .assertDoesNotExist()
    }

    @Test
    fun historyPrependKeepsVisibleMessagesAndRepeatedDragsDoNotQueueRequests() {
        val rows = mutableStateOf((0..5).map { assistantRow("history-$it", "history-$it") })
        val loading = mutableStateOf(HistoryLoadState.IDLE)
        var requests = 0
        composeRule.setContent {
            BitFunTheme(dark = false) {
                TimelineForTest(rows.value, hasMoreMessages = true, historyLoadState = loading.value,
                    onLoadOlder = { requests++; loading.value = HistoryLoadState.LOADING })
            }
        }
        val list = composeRule.onNodeWithTag(CONVERSATION_LIST_TEST_TAG)
        repeat(3) { list.performTouchInput { swipeDown() }; composeRule.waitForIdle() }
        composeRule.runOnIdle { assertEquals(1, requests) }
        val before = composeRule.onNodeWithText("history-0").getUnclippedBoundsInRoot().top
        composeRule.runOnIdle {
            rows.value = (-12..-1).map { assistantRow("history-$it", "history-$it") } + rows.value
            loading.value = HistoryLoadState.IDLE
        }
        composeRule.waitForIdle()
        val after = composeRule.onNodeWithText("history-0").getUnclippedBoundsInRoot().top
        assertTrue("Prepending moved the visible row from $before to $after", kotlin.math.abs((after - before).value) < 4)
        composeRule.runOnIdle { assertEquals(1, requests) }
        // Moving the list without a gesture must not fetch another page.
        list.performScrollToIndex(0)
        composeRule.waitForIdle()
        composeRule.runOnIdle { assertEquals(1, requests) }
        list.performTouchInput { swipeDown() }
        composeRule.waitForIdle()
        composeRule.runOnIdle { assertEquals(2, requests) }
    }

    @Test
    fun withLoadOlderHeaderStreamingGrowthStaysOnTheRealTail() {
        val rows = mutableStateOf(
            (1..40).map { index -> assistantRow("message-$index", id = "message-$index") },
        )

        composeRule.setContent {
            BitFunTheme(dark = false) {
                TimelineForTest(rows.value, hasMoreMessages = true)
            }
        }
        composeRule.waitForIdle()

        composeRule.runOnIdle {
            rows.value = rows.value.dropLast(1) +
                assistantRow(
                    List(500) { "Growing tail line." }.joinToString(" ") + " header-tail-marker",
                    id = "message-40",
                    streaming = true,
                )
        }
        composeRule.waitForIdle()

        val listBounds = composeRule.onNodeWithTag(CONVERSATION_LIST_TEST_TAG)
            .getUnclippedBoundsInRoot()
        val tailBounds = composeRule.onNodeWithText("header-tail-marker", substring = true)
            .getUnclippedBoundsInRoot()
        assertTrue(tailBounds.bottom <= listBounds.bottom + 1.dp)
        composeRule.onNodeWithContentDescription(string(R.string.chat_scroll_to_bottom))
            .assertDoesNotExist()
    }

    @Test
    fun conversationWithNoTimelineShowsLoadingStateInsteadOfBlankSurface() {
        setConversationContent(state = { readyState() })

        composeRule.mainClock.advanceTimeBy(200)
        composeRule.onNodeWithTag(CONVERSATION_LOADING_TEST_TAG).assertIsDisplayed()
    }

    @Test
    fun loadingDefersSkeletonAndNeverShowsAConnectionStrip() {
        composeRule.mainClock.autoAdvance = false
        setConversationContent(
            state = { readyState(sessionId = "pending").copy(busy = true) },
            phase = ConnectionPhase.RECONNECTING,
        )
        composeRule.mainClock.advanceTimeByFrame()
        composeRule.onNodeWithTag(CONVERSATION_LOADING_TEST_TAG).assertDoesNotExist()
        composeRule.onNodeWithTag(CHAT_STATUS_BAR_TEST_TAG).assertDoesNotExist()
        composeRule.mainClock.advanceTimeBy(200)
        composeRule.onNodeWithTag(CONVERSATION_LOADING_TEST_TAG).assertIsDisplayed()
        composeRule.onNodeWithTag(CHAT_STATUS_BAR_TEST_TAG).assertDoesNotExist()
    }

    @Test
    fun composerShowsTheStoreDraftAndTypingDispatchesUpdateDraft() {
        val intents = mutableListOf<RemoteSessionIntent>()
        val state = mutableStateOf(readyState(sessionId = "s-code", draft = "existing draft"))

        setConversationContent(state = { state.value }, onIntent = { intents += it })

        composeRule.onNodeWithTag(COMPOSER_INPUT_TEST_TAG).assertTextEquals("existing draft")
        composeRule.onNodeWithTag(COMPOSER_INPUT_TEST_TAG).performTextReplacement("replaced draft")

        assertEquals(
            listOf<RemoteSessionIntent>(RemoteSessionIntent.UpdateDraft("replaced draft")),
            intents,
        )
    }

    @Test
    fun composerRemainsEditableWhileNewSessionHydrates() {
        val intents = mutableListOf<RemoteSessionIntent>()
        val state = mutableStateOf(readyState(sessionId = "pending", draft = "").copy(busy = true, timeline = null))

        setConversationContent(state = { state.value }, onIntent = { intents += it })

        composeRule.onNodeWithTag(COMPOSER_INPUT_TEST_TAG).performTextReplacement("draft during load")
        assertEquals(listOf(RemoteSessionIntent.UpdateDraft("draft during load")), intents)
    }

    @Test
    fun composerFollowsStoreDraftUpdatesWithinTheSameSession() {
        val state = mutableStateOf(readyState(sessionId = "s-code", draft = "first"))

        setConversationContent(state = { state.value })

        composeRule.onNodeWithTag(COMPOSER_INPUT_TEST_TAG).assertTextEquals("first")
        composeRule.runOnIdle { state.value = state.value.copy(draft = "second") }
        composeRule.waitForIdle()
        composeRule.onNodeWithTag(COMPOSER_INPUT_TEST_TAG).assertTextEquals("second")
    }

    @Test
    fun switchingSessionsShowsTheRestoredDraft() {
        val state = mutableStateOf(readyState(sessionId = "s-a", draft = "draft-a"))

        setConversationContent(state = { state.value })

        composeRule.onNodeWithTag(COMPOSER_INPUT_TEST_TAG).assertTextEquals("draft-a")
        composeRule.runOnIdle {
            state.value = readyState(sessionId = "s-b", draft = "draft-b")
        }
        composeRule.waitForIdle()
        composeRule.onNodeWithTag(COMPOSER_INPUT_TEST_TAG).assertTextEquals("draft-b")
    }

    @Test
    fun acceptedSendClearsImmediatelyAndFailureRestoresDraft() {
        val intents = mutableListOf<RemoteSessionIntent>()

        val state = mutableStateOf(readyState(sessionId = "s-code", draft = "send me"))
        setConversationContent(
            state = { state.value },
            onIntent = { intents += it; state.value = state.value.copy(busy = true) },
        )

        composeRule.onNodeWithTag(COMPOSER_SEND_TEST_TAG).performClick()

        assertEquals(
            listOf<RemoteSessionIntent>(RemoteSessionIntent.SendMessage("s-code", "send me", null)),
            intents,
        )
        composeRule.onNodeWithTag(COMPOSER_INPUT_TEST_TAG).assert(
            SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")),
        )
        composeRule.runOnIdle { state.value = state.value.copy(busy = false) }
        composeRule.onNodeWithTag(COMPOSER_INPUT_TEST_TAG).assertTextEquals("send me")
    }

    @Test
    fun submittedDraftStaysClearedAcrossRecreationWhileAwaitingAck() {
        val restoration = androidx.compose.ui.test.junit4.StateRestorationTester(composeRule)
        val state = mutableStateOf(readyState(sessionId = "s-code", draft = "send me"))
        restoration.setContent {
            BitFunTheme(dark = false) {
                ConversationView(
                    state = state.value, phase = ConnectionPhase.CONNECTED,
                    settingsPlacement = SettingsPlacement(SettingsPlacementMode.BOTTOM, 0, 0, 0),
                    onBack = {}, onIntent = { intent ->
                        state.value = when (intent) {
                            is RemoteSessionIntent.UpdateDraft -> state.value.copy(draft = intent.text)
                            else -> state.value.copy(busy = true)
                        }
                    }, contextTitle = "Test desktop", onOpenFile = { _, _ -> },
                    previewingRemotePath = "", previewLoading = false,
                    download = RemoteFileDownloadUiState.None, onDownloadFile = { _, _ -> },
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
        composeRule.onNodeWithTag(COMPOSER_SEND_TEST_TAG).performClick()
        restoration.emulateSavedInstanceStateRestore()
        composeRule.onNodeWithTag(COMPOSER_INPUT_TEST_TAG).assert(
            SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")),
        )
        composeRule.onNodeWithTag(COMPOSER_INPUT_TEST_TAG).performTextReplacement("next draft")
        composeRule.runOnIdle { state.value = state.value.copy(busy = false) }
        composeRule.onNodeWithTag(COMPOSER_INPUT_TEST_TAG).assertTextEquals("next draft")
    }

    @Test
    fun emptyStateShowsInvitationCopy() {
        composeRule.setContent {
            BitFunTheme(dark = false) {
                ConversationEmptyState(modifier = Modifier.fillMaxSize())
            }
        }
        composeRule.onNodeWithText(string(R.string.chat_empty_title)).assertIsDisplayed()
        composeRule.onNodeWithText(string(R.string.chat_empty_hint)).assertIsDisplayed()
    }

    @Test
    fun reconnectingStatusBarMatchesTheFixedHeightColorAndCopyContract() {
        composeRule.setContent {
            BitFunTheme(dark = false) {
                ChatStatusBar(
                    phase = ConnectionPhase.RECONNECTING,
                    canStop = false,
                    onStop = {},
                )
            }
        }

        val title = string(R.string.chat_status_restoring_connection)
        val detail = string(R.string.connection_reconnecting_desktop)
        composeRule.onNodeWithText("$title · $detail").assertExists()
        val bounds = composeRule.onNodeWithTag(CHAT_STATUS_BAR_TEST_TAG).getUnclippedBoundsInRoot()
        assertTrue(kotlin.math.abs((bounds.bottom - bounds.top).value - 48f) < 1f)
        val dot = composeRule.onNodeWithTag(CHAT_STATUS_DOT_TEST_TAG).captureToImage()
        assertEquals(0xFF706F6A.toInt(), dot.toPixelMap()[dot.width / 2, dot.height / 2].toArgb())
    }

    @Test
    fun executingStatusBarDoesNotAppendAConnectionDetail() {
        composeRule.setContent {
            BitFunTheme(dark = false) {
                ChatStatusBar(
                    phase = ConnectionPhase.RECONNECTING,
                    canStop = true,
                    onStop = {},
                )
            }
        }

        composeRule.onNodeWithText(string(R.string.chat_status_executing)).assertExists()
    }

    private fun setConversationContent(
        state: () -> RemoteSessionUiState.Ready,
        phase: ConnectionPhase = ConnectionPhase.CONNECTED,
        onIntent: (RemoteSessionIntent) -> Unit = {},
    ) {
        composeRule.setContent {
            BitFunTheme(dark = false) {
                ConversationView(
                    state = state(),
                    phase = phase,
                    settingsPlacement = SettingsPlacement(SettingsPlacementMode.BOTTOM, 0, 0, 0),
                    onBack = {},
                    onIntent = onIntent,
                    contextTitle = "Test desktop",
                    onOpenFile = { _, _ -> },
                    previewingRemotePath = "",
                    previewLoading = false,
                    download = RemoteFileDownloadUiState.None,
                    onDownloadFile = { _, _ -> },
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }

    private fun readyState(
        sessionId: String = "",
        draft: String = "",
    ) = RemoteSessionUiState.Ready(
        sessions = emptyList(),
        selectedSessionId = sessionId,
        timeline = null,
        busy = false,
        permissionMode = null,
        permissionModeFailure = null,
        query = "",
        agentFilter = SessionAgentFilter.ALL,
        hasMore = false,
        hasMoreMessages = false,
        modelCatalog = null,
        modelCatalogFailure = null,
        draft = draft,
    )

    @Composable
    private fun TimelineForTest(
        rows: List<ConversationRow>,
        hasMoreMessages: Boolean = false,
        topInset: Dp = 0.dp,
        bottomInset: Dp = 0.dp,
        historyLoadState: HistoryLoadState = HistoryLoadState.IDLE,
        onLoadOlder: () -> Unit = {},
    ) {
        ConversationTimelineView(
            rows = rows,
            hasMoreMessages = hasMoreMessages,
            topInset = topInset,
            bottomInset = bottomInset,
            historyLoadState = historyLoadState,
            onLoadOlder = onLoadOlder,
            enabled = true,
            onApproveTool = {},
            onRejectTool = { _, _ -> },
            onCancelTool = { _, _ -> },
            onAnswerTool = { _, _ -> },
            onAnswerToolStructured = { _, _ -> },
            onRetry = {},
            onOpenFile = { _, _ -> },
            previewingRemotePath = "",
            previewLoading = false,
            download = RemoteFileDownloadUiState.None,
            onDownloadFile = { _, _ -> },
            downloadEnabled = true,
            modifier = Modifier.fillMaxSize(),
        )
    }

    private fun assistantRow(
        answer: String,
        id: String = "message-1",
        streaming: Boolean = false,
    ): ConversationRow = ConversationRow(
        id = id,
        kind = ConversationRowKind.ASSISTANT,
        text = answer,
        thinking = null,
        images = emptyList(),
        tools = emptyList(),
        blocks = emptyList(),
        streaming = streaming,
        typing = false,
        showRetry = false,
        error = null,
        live = false,
    )

    private fun string(resource: Int): String =
        InstrumentationRegistry.getInstrumentation().targetContext.getString(resource)
}
