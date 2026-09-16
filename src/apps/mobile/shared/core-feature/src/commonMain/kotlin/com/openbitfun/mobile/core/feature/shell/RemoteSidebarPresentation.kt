package com.openbitfun.mobile.core.feature.shell

import com.openbitfun.mobile.core.feature.session.RemoteSessionUiState
import com.openbitfun.mobile.core.feature.workspace.RemoteWorkspaceUiState

/** One remote session with only the facts the unified sidebar renders. */
public data class RemoteSidebarSessionRow public constructor(
    public val id: String,
    public val title: String,
    public val agentType: String,
)

/** One remote workspace and the sessions filed under it in the sidebar tree. */
public data class RemoteSidebarWorkspaceRow public constructor(
    public val path: String,
    public val name: String,
    public val selected: Boolean,
    public val sessions: List<RemoteSidebarSessionRow>,
    public val remoteConnectionId: String?,
) {
    public constructor(path: String, name: String, selected: Boolean, sessions: List<RemoteSidebarSessionRow>) : this(path, name, selected, sessions, null)
}

/** Platform-neutral projection for HarmonyOS' device/workspace/session hierarchy. */
public object RemoteSidebarPresentation {
    public fun workspaces(
        workspaceState: RemoteWorkspaceUiState.Ready?,
        sessionState: RemoteSessionUiState.Ready?,
    ): List<RemoteSidebarWorkspaceRow> {
        if (workspaceState == null) return emptyList()
        val selected = workspaceState.selected
        val workspaceRows = buildList {
            if (selected != null && selected.path.isNotBlank()) {
                add(Triple(selected.path, selected.name, selected.remoteConnectionId))
            }
            workspaceState.assistants.forEach { assistant ->
                if (assistant.path.isNotBlank() && none { it.first == assistant.path && it.third == null }) add(Triple(assistant.path, assistant.name, null))
            }
            workspaceState.workspaces.forEach { workspace ->
                if (workspace.path.isNotBlank() && none { it.first == workspace.path && it.third == workspace.remoteConnectionId }) {
                    add(Triple(workspace.path, workspace.name, workspace.remoteConnectionId))
                }
            }
        }
        return workspaceRows.map { (path, name, connectionId) ->
            RemoteSidebarWorkspaceRow(
                path = path,
                name = name,
                selected = path == selected?.path && connectionId == selected.remoteConnectionId,
                remoteConnectionId = connectionId,
                sessions = sessionState?.sessions.orEmpty()
                    .filter { (it.workspacePath ?: selected?.path) == path }
                    .map { session ->
                        RemoteSidebarSessionRow(
                            id = session.id,
                            title = session.title,
                            agentType = session.agentType,
                        )
                    },
            )
        }
    }
}
