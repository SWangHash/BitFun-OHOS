package com.openbitfun.mobile.app.ui.remote

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.unit.sp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.openbitfun.mobile.app.R
import com.openbitfun.mobile.core.feature.workspace.*

@Composable
private fun RuntimeFullScreen(title: String, onBack: () -> Unit, actions: @Composable RowScope.() -> Unit = {}, content: @Composable ColumnScope.() -> Unit) {
    Dialog(onDismissRequest = onBack, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = onBack) { Text(stringResource(R.string.common_back)) }
                    Text(title, Modifier.weight(1f).padding(vertical = 12.dp), style = MaterialTheme.typography.titleMedium, maxLines = 1)
                    actions()
                }
                HorizontalDivider()
                content()
            }
        }
    }
}

@Composable
internal fun RuntimeFileEditorDialog(files: RuntimeFilesUiState, onIntent: (RemoteWorkspaceIntent) -> Unit) {
    val file = files.file ?: return
    var content by rememberSaveable(file) { mutableStateOf(files.content) }
    var discard by rememberSaveable(file) { mutableStateOf(false) }
    var fileAction by remember { mutableStateOf("") }
    var renamePath by remember(file) { mutableStateOf(file) }
    var menu by remember { mutableStateOf(false) }
    LaunchedEffect(files.content) { content = files.content }
    val dirty = content != files.content
    val back = { if (!files.busy) { if (dirty) discard = true else onIntent(RemoteWorkspaceIntent.CloseFileEditor) } }
    RuntimeFullScreen(file.substringAfterLast('/'), back, actions = {
        Box {
            TextButton(enabled = !files.busy && !dirty, onClick = { menu = true }) { Text("⋯") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text(stringResource(R.string.workspace_rename_file)) }, onClick = { menu = false; fileAction = "rename" })
                DropdownMenuItem(text = { Text(stringResource(R.string.workspace_delete_file)) }, onClick = { menu = false; fileAction = "delete" })
            }
        }
        TextButton(enabled = !files.busy && dirty, onClick = { onIntent(RemoteWorkspaceIntent.SaveFile(content)) }) { Text(stringResource(R.string.workspace_save_file)) }
    }) {
        Text(file, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.bodySmall)
        if (files.failed) Text(stringResource(R.string.workspace_files_failed), color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp))
        BoxWithConstraints(Modifier.fillMaxWidth().weight(1f)) {
            val viewportWidth = maxWidth - 60.dp
            val codeStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace, fontSize = 14.sp, lineHeight = 21.sp, platformStyle = PlatformTextStyle(includeFontPadding = false))
            Row(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                Text((1..(content.count { it == '\n' } + 1)).joinToString("\n"), Modifier.width(60.dp).padding(12.dp), style = codeStyle, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Box(Modifier.horizontalScroll(rememberScrollState())) {
                    BasicTextField(value = content, onValueChange = { content = it }, enabled = !files.busy,
                        textStyle = codeStyle.copy(color = MaterialTheme.colorScheme.onSurface),
                        modifier = Modifier.width(IntrinsicSize.Max).widthIn(min = viewportWidth).padding(12.dp))
                }
            }
        }
    }
    if (fileAction.isNotEmpty()) AlertDialog(onDismissRequest = { fileAction = "" },
        title = { Text(stringResource(if (fileAction == "rename") R.string.workspace_rename_file else R.string.workspace_delete_file)) },
        text = { if (fileAction == "rename") OutlinedTextField(value = renamePath, onValueChange = { renamePath = it }, singleLine = true) else Text(file) },
        confirmButton = { TextButton(enabled = fileAction != "rename" || renamePath.isNotBlank(), onClick = {
            if (fileAction == "rename") onIntent(RemoteWorkspaceIntent.RenameFile(renamePath)) else onIntent(RemoteWorkspaceIntent.DeleteFile)
            fileAction = ""
        }) { Text(stringResource(if (fileAction == "rename") R.string.workspace_rename_file else R.string.workspace_delete_file)) } },
        dismissButton = { TextButton(onClick = { fileAction = "" }) { Text(stringResource(R.string.common_cancel)) } })
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text(stringResource(R.string.workspace_discard_changes)) },
        confirmButton = { TextButton(onClick = { discard = false; onIntent(RemoteWorkspaceIntent.CloseFileEditor) }) { Text(stringResource(R.string.workspace_discard)) } },
        dismissButton = { TextButton(onClick = { discard = false }) { Text(stringResource(R.string.common_cancel)) } })
}

@Composable
internal fun RuntimeDirectoryPickerDialog(state: RuntimeFilesUiState, connectionId: String?, onIntent: (RemoteWorkspaceIntent) -> Unit, onChoose: (String) -> Unit, onBack: () -> Unit) {
    RuntimeFullScreen(stringResource(R.string.workspace_choose_folder), onBack, actions = {
        TextButton(enabled = !state.busy && !state.failed && state.directory.isNotBlank(), onClick = { onChoose(state.directory) }) { Text(stringResource(R.string.workspace_choose)) }
    }) {
        Text(state.directory, Modifier.padding(16.dp), style = MaterialTheme.typography.bodySmall)
        if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (state.failed) Text(stringResource(R.string.workspace_files_failed), color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp))
        Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            TextButton(enabled = !state.busy && state.directory != "/", onClick = { onIntent(RemoteWorkspaceIntent.BrowseWorkspaceDirectories(state.directory.trimEnd('/').substringBeforeLast('/', "").ifEmpty { "/" }, connectionId, false)) }) { Text(stringResource(R.string.workspace_parent_folder)) }
            state.entries.filter { it.directory }.forEach { entry ->
                TextButton(onClick = { onIntent(RemoteWorkspaceIntent.BrowseWorkspaceDirectories(entry.path, connectionId, false)) }, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) { Text(entry.name) }
            }
            if (state.hasMore) TextButton(onClick = { onIntent(RemoteWorkspaceIntent.BrowseWorkspaceDirectories(state.directory, connectionId, true)) }, enabled = !state.busy) { Text(stringResource(R.string.workspace_more_files)) }
        }
    }
}

@Composable
internal fun RuntimeTerminalDialog(state: RuntimeTerminalUiState, onIntent: (RemoteWorkspaceIntent) -> Unit, onBack: () -> Unit) {
    RuntimeFullScreen(stringResource(R.string.workspace_terminal), onBack, actions = {
        TextButton(enabled = !state.busy, onClick = { onIntent(RemoteWorkspaceIntent.CloseTerminal) }) { Text(stringResource(R.string.workspace_terminal_close)) }
    }) {
        if (state.failed) Text(stringResource(R.string.workspace_terminal_failed), color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(12.dp))
        RuntimeTerminalView(state, { onIntent(RemoteWorkspaceIntent.WriteTerminal(it)) }, { cols, rows -> onIntent(RemoteWorkspaceIntent.ResizeTerminal(cols, rows)) }, Modifier.fillMaxWidth().weight(1f))
    }
}

@Composable
internal fun RuntimeFileSortMenu(sort: RuntimeFileSort, onIntent: (RemoteWorkspaceIntent) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val labels = listOf(R.string.workspace_sort_name_asc, R.string.workspace_sort_name_desc, R.string.workspace_sort_modified_desc, R.string.workspace_sort_modified_asc)
    Box {
        TextButton(onClick = { open = true }) { Text(stringResource(labels[sort.ordinal])) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            RuntimeFileSort.entries.forEachIndexed { index, value -> DropdownMenuItem(text = { Text(stringResource(labels[index])) }, onClick = { open = false; onIntent(RemoteWorkspaceIntent.SortFiles(value)) }) }
        }
    }
}

@Composable
internal fun RuntimeFilesDialog(state: RemoteWorkspaceUiState.Ready, onIntent: (RemoteWorkspaceIntent) -> Unit, onBack: () -> Unit) {
    var attached by remember { mutableStateOf(true) }
    DisposableEffect(Unit) { onDispose { attached = false } }
    val uploadContext = androidx.compose.ui.platform.LocalContext.current
    var uploadFailed by rememberSaveable { mutableStateOf(false) }
    var uploadPath by rememberSaveable { mutableStateOf("") }
    val uploadPicker = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null && attached) {
            try {
                val source = com.openbitfun.mobile.app.platform.AndroidRuntimeUploadSource(uploadContext.contentResolver, uri)
                onIntent(RemoteWorkspaceIntent.UploadFile(uploadPath, source)); uploadFailed = false
            } catch (_: Exception) { uploadFailed = true }
        }
    }
    var newDirectory by rememberSaveable { mutableStateOf("") }
    RuntimeFullScreen(stringResource(R.string.workspace_browse_files), onBack) {
        Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(16.dp)) {
            if (state.files.directory.isNotEmpty()) {
                Text(state.files.directory, style = MaterialTheme.typography.bodySmall)
                TextButton(enabled = !state.files.busy && state.files.directory != "/", onClick = {
                    onIntent(RemoteWorkspaceIntent.BrowseFiles(state.files.directory.trimEnd('/').substringBeforeLast('/', "").ifEmpty { "/" }, false))
                }) { Text(stringResource(R.string.workspace_parent_folder)) }
            }
            RuntimeFileSortMenu(state.files.sort, onIntent)
            state.files.entries.forEach { entry ->
                TextButton(onClick = {
                    if (entry.directory) onIntent(RemoteWorkspaceIntent.BrowseFiles(entry.path, false))
                    else onIntent(RemoteWorkspaceIntent.ReadFile(entry.path))
                }, enabled = !state.files.busy) { Text(entry.name) }
                if (!entry.directory) TextButton(onClick = {
                    onIntent(RemoteWorkspaceIntent.DownloadFile(entry.path, entry.name, ""))
                }, enabled = state.download !is com.openbitfun.mobile.core.feature.workspace.RemoteFileDownloadUiState.Loading) {
                    Text(stringResource(R.string.file_download))
                }
            }
            if (state.files.hasMore) TextButton(onClick = { onIntent(RemoteWorkspaceIntent.BrowseFiles(state.files.directory, true)) }, enabled = !state.files.busy) {
                Text(stringResource(R.string.workspace_more_files))
            }
            if (state.files.directory.isNotEmpty()) {
                OutlinedTextField(value = newDirectory, onValueChange = { newDirectory = it }, label = { Text(stringResource(R.string.workspace_new_directory)) })
                if (uploadFailed) Text(stringResource(R.string.workspace_upload_failed))
                TextButton(onClick = { uploadPath = newDirectory; uploadPicker.launch(arrayOf("*/*")) }, enabled = !state.files.busy && newDirectory.isNotBlank()) { Text(stringResource(R.string.workspace_upload_file)) }
                TextButton(onClick = { onIntent(RemoteWorkspaceIntent.CreateFile(newDirectory)) }, enabled = !state.files.busy && newDirectory.isNotBlank()) { Text(stringResource(R.string.workspace_create_file)) }
                if (state.files.file != null) {
                    TextButton(onClick = { onIntent(RemoteWorkspaceIntent.RenameFile(newDirectory)) }, enabled = !state.files.busy && newDirectory.isNotBlank()) { Text(stringResource(R.string.workspace_rename_file)) }
                    TextButton(onClick = { onIntent(RemoteWorkspaceIntent.DeleteFile) }, enabled = !state.files.busy) { Text(stringResource(R.string.workspace_delete_file)) }
                }
                TextButton(onClick = { onIntent(RemoteWorkspaceIntent.CreateDirectory(newDirectory)) }, enabled = !state.files.busy && newDirectory.isNotBlank()) { Text(stringResource(R.string.workspace_create_directory)) }
            }
            if (state.files.failed) Text(stringResource(R.string.workspace_files_failed), color = MaterialTheme.colorScheme.error)
        }
    }
    RuntimeFileEditorDialog(state.files, onIntent)
}
