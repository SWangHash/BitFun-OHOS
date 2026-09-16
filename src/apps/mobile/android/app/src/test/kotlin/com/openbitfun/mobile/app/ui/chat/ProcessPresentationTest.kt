package com.openbitfun.mobile.app.ui.chat

import com.openbitfun.mobile.app.ui.chat.message.*
import com.openbitfun.mobile.core.feature.session.*
import org.junit.Assert.*
import org.junit.Test

class ProcessPresentationTest {
    @Test fun childThinkingOnlyFollowsTheLastVisibleBlock() {
        val thought = MessageBlock.Thinking("thought", "Old reasoning", true)
        val block = MessageBlock.Subagent("task", "Task", true, "",
            listOf(thought, MessageBlock.Text("answer", "Answer", true)))
        assertFalse((subagentChildren(block).first() as MessageBlock.Thinking).streaming)
        assertTrue((subagentChildren(block.copy(children = listOf(thought))).single() as MessageBlock.Thinking).streaming)
        assertFalse((subagentChildren(block.copy(running = false, children = listOf(thought))).single() as MessageBlock.Thinking).streaming)
    }
    @Test fun outputPreviewKeepsUnicodeAndBoundsLongText() {
        val preview = subagentPreview("😀".repeat(400))
        assertEquals(321, preview.codePointCount(0, preview.length))
        assertTrue(preview.endsWith("…"))
        assertEquals("answer", subagentPreview("  answer  "))
    }
    @Test fun statusPreservesFailuresInsteadOfCallingThemDone() {
        listOf("failed", "ERROR", "timeout", "cancelled", "canceled", "rejected").forEach { assertTrue(subagentFailed(it)) }
        assertFalse(subagentFailed("completed"))
    }
    private fun tool(id: String, phase: ToolPhase = ToolPhase.COMPLETED) = ToolCard(
        id, "Read", phase, ToolKind.DOCUMENT, ToolOperation.READ_FILE,
        "file.kt", "", "", "", "", null, emptySet(),
    )
    @Test fun completedWorkSummarizesWithoutHidingLiveOrFailedTools() {
        val thought = MessageBlock.Thinking("thinking", "Before", false)
        val first = MessageBlock.Tools("first", listOf(tool("one")))
        val between = MessageBlock.Thinking("between", "Between", false)
        val last = MessageBlock.Tools("last", listOf(tool("two")))
        val answer = MessageBlock.Text("answer", "Answer", false)
        val grouped = processGroups(listOf(thought, first, between, last, answer))
        assertTrue(grouped.first().summarized)
        assertEquals(listOf("thinking", "tool:one", "between", "tool:two"), grouped.first().blocks.map { it.id })
        assertEquals(answer, grouped.last().blocks.single())
        for (phase in listOf(ToolPhase.RUNNING, ToolPhase.FAILED)) {
            val active = MessageBlock.Tools("active", listOf(tool("active", phase)))
            val split = processGroups(listOf(thought, first, active, between, last))
            assertEquals(3, split.size)
            assertTrue(split.none { it.summarized })
        }
        assertEquals(grouped.first().id, processGroups(listOf(thought, first, between, last,
            MessageBlock.Tools("more", listOf(tool("three"))))).single().id)
    }
    @Test fun textAndTaskBoundariesKeepThinkingInOrder() {
        val a = MessageBlock.Thinking("a", "First", false)
        val b = MessageBlock.Thinking("b", "Second", false)
        val answer = MessageBlock.Text("answer", "Answer", false)
        val groups = processGroups(listOf(a, b, answer))
        assertEquals(2, groups.size)
        assertEquals("First\n\nSecond", (groups[0].blocks.single() as MessageBlock.Thinking).text)
        assertEquals(answer, groups[1].blocks.single())
        assertFalse(groups[0].summarized)
    }
}
