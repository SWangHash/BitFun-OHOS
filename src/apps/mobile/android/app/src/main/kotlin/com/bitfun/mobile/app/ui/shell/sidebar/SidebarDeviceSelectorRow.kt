package com.bitfun.mobile.app.ui.shell.sidebar

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.bitfun.mobile.app.R
import com.bitfun.mobile.app.ui.common.labelRes
import com.bitfun.mobile.core.feature.connection.ConnectionPhase

@Composable
internal fun SidebarDeviceSelectorRow(
    deviceName: String,
    online: Boolean,
    selected: Boolean,
    loading: Boolean,
    phase: ConnectionPhase? = null,
    onSelect: () -> Unit,
) {
    val deviceLabel = deviceName
    val healthLabel = phase?.let { stringResource(it.labelRes()) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(52.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (selected) MaterialTheme.colorScheme.surfaceContainerHigh else MaterialTheme.colorScheme.surface.copy(alpha = 0f))
            .clickable(enabled = online || (selected && phase in listOf(ConnectionPhase.FAILED, ConnectionPhase.DISCONNECTED)), role = Role.Button, onClick = onSelect)
            .semantics(mergeDescendants = true) {
                this.selected = selected
                contentDescription = deviceLabel
                healthLabel?.let { stateDescription = it }
            }
            .padding(start = 10.dp, end = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            painterResource(R.drawable.ic_symbol_desktop),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.size(21.dp),
        )
        Text(
            deviceName,
            fontSize = 14.sp,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (loading) {
            CircularProgressIndicator(
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                strokeWidth = 1.5.dp,
                modifier = Modifier.size(14.dp),
            )
        } else {
            ConnectionDot(phase ?: if (online) ConnectionPhase.CONNECTED else ConnectionPhase.DISCONNECTED)
        }
    }
}
