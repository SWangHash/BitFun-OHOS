package com.bitfun.mobile.app.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Shared signed-out choice used by both the sidebar and the connection page. */
@Composable
internal fun SignedOutConnectionActions(
    scanLabel: String,
    accountLabel: String,
    onScan: () -> Unit,
    onOpenAccount: () -> Unit,
    modifier: Modifier = Modifier,
    showScan: Boolean = true,
    primaryScan: Boolean = false,
    enabled: Boolean = true,
    buttonHeight: Dp = 48.dp,
    spacing: Dp = 10.dp,
    fontSize: Int = 16,
    // The quiet half of the pair. On a page it is a card; in the sidebar it is
    // chrome, so the layer is the caller's to name rather than assumed here.
    quietBackground: Color = MaterialTheme.colorScheme.surface,
    quietBorder: Color = MaterialTheme.colorScheme.outlineVariant,
    quietContent: Color = MaterialTheme.colorScheme.onSurface,
) {
    val shape = RoundedCornerShape(buttonHeight / 2)
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(spacing),
    ) {
        if (showScan) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(buttonHeight)
                    .clip(shape)
                    .background(if (primaryScan) MaterialTheme.colorScheme.primary else quietBackground)
                    .border(1.dp, if (primaryScan) MaterialTheme.colorScheme.primary else quietBorder, shape)
                    .clickable(enabled = enabled, role = Role.Button, onClick = onScan)
                    .semantics(mergeDescendants = true) {
                        contentDescription = scanLabel
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    scanLabel,
                    fontSize = fontSize.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (primaryScan) MaterialTheme.colorScheme.onPrimary else quietContent,
                )
            }
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(buttonHeight)
                .clip(shape)
                .background(if (primaryScan) quietBackground else MaterialTheme.colorScheme.primary)
                .border(1.dp, if (primaryScan) quietBorder else MaterialTheme.colorScheme.primary, shape)
                .clickable(enabled = enabled, role = Role.Button, onClick = onOpenAccount)
                .semantics(mergeDescendants = true) {
                    contentDescription = accountLabel
                },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                accountLabel,
                fontSize = fontSize.sp,
                fontWeight = FontWeight.Bold,
                color = if (primaryScan) quietContent else MaterialTheme.colorScheme.onPrimary,
            )
        }
    }
}
