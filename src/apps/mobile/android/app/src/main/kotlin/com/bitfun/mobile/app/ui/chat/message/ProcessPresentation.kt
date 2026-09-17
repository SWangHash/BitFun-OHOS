package com.bitfun.mobile.app.ui.chat.message

import com.bitfun.mobile.core.feature.session.MessageBlock

/** Native grouping over the shared core's foldability facts; never cross prose or task boundaries. */
internal data class ProcessGroup(val blocks: List<MessageBlock>) {
    val id: String get() = blocks.first().id
    val tools get() = blocks.filterIsInstance<MessageBlock.Tools>().flatMap { it.tools }
    val summarized: Boolean get() = tools.size >= 2 && tools.all { it.foldIntoSummary }
}

internal fun processGroups(blocks: List<MessageBlock>): List<ProcessGroup> {
    val result = mutableListOf<ProcessGroup>()
    val pending = mutableListOf<MessageBlock>()
    fun flush() { if (pending.isNotEmpty()) { result += ProcessGroup(pending.toList()); pending.clear() } }
    blocks.forEach { block ->
        when (block) {
            is MessageBlock.Thinking -> {
                val previous = pending.lastOrNull() as? MessageBlock.Thinking
                if (previous == null) pending += block else {
                    pending[pending.lastIndex] = previous.copy(text = previous.text + "\n\n" + block.text,
                        streaming = previous.streaming || block.streaming)
                }
            }
            is MessageBlock.Tools -> block.tools.forEach { tool ->
                val leaf = MessageBlock.Tools("tool:${tool.id}", listOf(tool))
                if (tool.foldIntoSummary) pending += leaf else { flush(); result += ProcessGroup(listOf(leaf)) }
            }
            else -> { flush(); result += ProcessGroup(listOf(block)) }
        }
    }
    flush()
    return result
}

internal fun subagentChildren(block: MessageBlock.Subagent): List<MessageBlock> {
    val visible = block.children.flatMap { child ->
        when (child) {
            is MessageBlock.Thinking -> if (child.text.isBlank()) emptyList() else listOf(child)
            is MessageBlock.Text -> if (child.text.isBlank()) emptyList() else listOf(child)
            is MessageBlock.Tools -> child.tools.map { MessageBlock.Tools("subtask-tool:${it.id}", listOf(it)) }
            else -> listOf(child)
        }
    }
    return visible.mapIndexed { index, child ->
        if (child is MessageBlock.Thinking) child.copy(streaming = block.running && index == visible.lastIndex) else child
    }
}

internal fun subagentFailed(status: String): Boolean = status.lowercase() in
    setOf("failed", "error", "timeout", "cancelled", "canceled", "rejected")

internal fun subagentPreview(text: String): String {
    val trimmed = text.trim()
    val count = trimmed.codePointCount(0, trimmed.length)
    return if (count <= 320) trimmed else trimmed.substring(0, trimmed.offsetByCodePoints(0, 320)).trimEnd() + "…"
}
