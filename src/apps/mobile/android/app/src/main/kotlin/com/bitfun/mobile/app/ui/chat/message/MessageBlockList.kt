package com.bitfun.mobile.app.ui.chat.message

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.key
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.bitfun.mobile.app.R
import com.bitfun.mobile.app.ui.chat.FileReferenceCards
import com.bitfun.mobile.app.ui.chat.MarkdownContent
import com.bitfun.mobile.app.ui.chat.tool.ToolStatusList
import com.bitfun.mobile.app.ui.chat.tool.ToolDisclosure
import com.bitfun.mobile.app.ui.chat.tool.LocalToolDisclosure
import com.bitfun.mobile.core.feature.session.MessageBlock
import com.bitfun.mobile.core.feature.session.QuestionAnswer
import com.bitfun.mobile.core.feature.workspace.RemoteFileDownloadUiState

internal const val SUBAGENT_GROUP_TEST_TAG: String = "subagent-group"

/** What the app has to be handed to draw any block, gathered so nesting stays cheap. */
internal data class MessageBlockCallbacks(
    val enabled: Boolean,
    val onApproveTool: (String, String?) -> Unit,
    val onRejectTool: (String, String) -> Unit,
    val onCancelTool: (String, String) -> Unit,
    val onAnswerTool: (String, String) -> Unit,
    val onAnswerToolStructured: (String, List<QuestionAnswer>) -> Unit,
    val onOpenLink: (String, String) -> Unit,
    /** The file the preview surface is showing, so its card can say so. */
    val previewingRemotePath: String,
    val previewLoading: Boolean,
    val download: RemoteFileDownloadUiState,
    val onDownloadFile: (String, String) -> Unit,
    val downloadEnabled: Boolean,
)

/**
 * An agent turn in the order it happened, ported from `structuredGroups` in
 * `pages/components/ChatMessageBubble.ets`.
 *
 * The alternative — all the prose, then all the tools — is what this replaces,
 * and it misrepresented every turn that worked in steps: the agent appeared to
 * have explained the whole job before touching any of it.
 */
@Composable
internal fun MessageBlockList(
    blocks: List<MessageBlock>,
    callbacks: MessageBlockCallbacks,
    modifier: Modifier,
) {
    val selectedTool = rememberSaveable { mutableStateOf<String?>(null) }
    val disclosure = remember { ToolDisclosure(selectedTool) }
    CompositionLocalProvider(LocalToolDisclosure provides disclosure) {
        Column(
            modifier = modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            val groups = remember(blocks) { processGroups(blocks) }
            groups.forEach { group ->
                key(group.id) {
                    var expanded by rememberSaveable { mutableStateOf(false) }
                    if (group.summarized) {
                        Row(Modifier.fillMaxWidth().height(32.dp).clickable { expanded = !expanded },
                            verticalAlignment = Alignment.CenterVertically) {
                            Text(stringResource(R.string.tool_group_summary, group.tools.size),
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.weight(1f))
                            androidx.compose.material3.Icon(androidx.compose.ui.res.painterResource(
                                if (expanded) R.drawable.ic_symbol_chevron_down else R.drawable.ic_symbol_chevron_right),
                                contentDescription = null, modifier = Modifier.width(16.dp))
                        }
                    }
                    if (!group.summarized || expanded) group.blocks.forEach { block ->
                        key(block.id) { MessageBlockView(block, callbacks) }
                    }
                }
            }
        }
    }
}

@Composable
private fun MessageBlockView(block: MessageBlock, callbacks: MessageBlockCallbacks) {
    when (block) {
        is MessageBlock.Text -> {
            MarkdownContent(
                text = block.text,
                onOpenLink = callbacks.onOpenLink,
                modifier = Modifier,
                streaming = block.streaming,
            )
            FileReferenceCards(
                text = block.text,
                previewingRemotePath = callbacks.previewingRemotePath,
                previewLoading = callbacks.previewLoading,
                download = callbacks.download,
                onOpen = callbacks.onOpenLink,
                onDownload = callbacks.onDownloadFile,
                downloadEnabled = callbacks.downloadEnabled,
                modifier = Modifier,
            )
        }

        is MessageBlock.Thinking -> ThinkingBlock(block.text, block.streaming, block.id)

        is MessageBlock.Tools -> ToolStatusList(
            tools = block.tools,
            enabled = callbacks.enabled,
            onApprove = callbacks.onApproveTool,
            onReject = callbacks.onRejectTool,
            onCancel = callbacks.onCancelTool,
            onAnswer = callbacks.onAnswerTool,
            onAnswerStructured = callbacks.onAnswerToolStructured,
            onOpenFile = callbacks.onOpenLink,
            modifier = Modifier,
        )

        is MessageBlock.Subagent -> SubagentGroup(block, callbacks)
    }
}

/**
 * A subagent's turn boxed inside the one that started it, ported from
 * `SubagentGroup`.
 *
 * The box and the left rule down its children exist to answer one question the
 * flat list could not: which of these tools did *this* agent run, and which did
 * the one it handed the job to.
 */
@Composable
private fun SubagentGroup(block: MessageBlock.Subagent, callbacks: MessageBlockCallbacks) {
    var expanded by rememberSaveable(block.id) { mutableStateOf(false) }
    val children = remember(block.children, block.running) { subagentChildren(block) }
    val hasDetails = children.isNotEmpty() || block.text.isNotBlank()
    val outline = MaterialTheme.colorScheme.outlineVariant
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(SUBAGENT_GROUP_TEST_TAG)
            .border(1.dp, outline, RoundedCornerShape(12.dp))
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) {}
                .toggleable(
                    value = expanded,
                    role = Role.Button,
                    enabled = hasDetails,
                    onValueChange = { expanded = it },
                ),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (hasDetails) androidx.compose.material3.Icon(
                painter = androidx.compose.ui.res.painterResource(
                    if (expanded) R.drawable.ic_symbol_chevron_down else R.drawable.ic_symbol_chevron_right,
                ),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.width(18.dp),
            )
            Text(
                block.title.ifEmpty { stringResource(R.string.chat_subagent) },
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            )
            Text(stringResource(when {
                subagentFailed(block.status) -> R.string.tool_phase_failed
                block.running -> R.string.tool_phase_running
                else -> R.string.tool_phase_completed
            }), style = MaterialTheme.typography.labelSmall,
                color = if (subagentFailed(block.status)) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (expanded && hasDetails) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .drawBehind {
                        drawLine(
                            color = outline,
                            start = Offset.Zero,
                            end = Offset(0f, size.height),
                            strokeWidth = 1.dp.toPx(),
                        )
                    }
                    .padding(start = 12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (children.isEmpty() && block.text.isNotBlank()) {
                    Text(
                        subagentPreview(block.text),
                        maxLines = 4,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                        fontSize = 14.sp,
                        lineHeight = 21.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                children.forEach { child -> key(child.id) {
                    if (child is MessageBlock.Text) {
                        Text(stringResource(R.string.chat_subagent_output), style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(subagentPreview(child.text), maxLines = 4,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else MessageBlockView(child, callbacks)
                } }
            }
        }
    }
}

/**
 * Reasoning, collapsed to its label by default: it is usually longer than the
 * answer, and scrolling past it to reach the answer is the wrong default.
 *
 * Reasoning that is still being written opens itself, because at that moment it
 * is the only part of the turn there is to read.
 */
@Composable
internal fun ThinkingBlock(thinking: String, streaming: Boolean, stateKey: String) {
    var expanded by rememberSaveable(stateKey) { mutableStateOf(streaming) }
    var userToggled by rememberSaveable(stateKey) { mutableStateOf(false) }
    LaunchedEffect(streaming) {
        expanded = if (streaming) {
            if (userToggled) expanded else true
        } else {
            userToggled = false
            false
        }
    }
    Column(
        modifier = Modifier.fillMaxWidth().padding(start = 2.dp, end = 2.dp, top = 2.dp, bottom = if (expanded) 8.dp else 2.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(32.dp)
                .clickable(enabled = thinking.isNotBlank()) {
                    if (streaming) userToggled = true
                    expanded = !expanded
                },
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (streaming) {
                ChatTypingDots(Modifier.width(22.dp))
            } else {
                androidx.compose.material3.Icon(
                    painter = androidx.compose.ui.res.painterResource(
                        if (expanded) R.drawable.ic_symbol_chevron_down else R.drawable.ic_symbol_chevron_right,
                    ),
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.width(16.dp),
                )
            }
            Text(
                stringResource(
                    if (streaming) R.string.chat_thinking_in_progress else R.string.chat_thinking_complete,
                ),
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
        }
        if (expanded) {
            Text(
                thinking,
                fontSize = 14.sp,
                lineHeight = 21.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
