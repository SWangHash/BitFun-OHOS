package com.openbitfun.mobile.core.domain

public data class RecentWorkspace public constructor(
    public val path: String,
    public val name: String,
    public val lastOpened: String,
    public val kind: String,
    public val remoteSshHost: String?,
    public val remoteConnectionId: String?,
) {
    public constructor(path: String, name: String, lastOpened: String, kind: String) :
        this(path, name, lastOpened, kind, null, null)
    public constructor(path: String, name: String, lastOpened: String, kind: String, remoteSshHost: String?) :
        this(path, name, lastOpened, kind, remoteSshHost, null)
    public val displayName: String
        get() = remoteSshHost?.trim()?.takeIf { it.isNotEmpty() }?.let { "$name · $it" } ?: name
}

public data class WorkspaceAssistant public constructor(
    public val path: String,
    public val name: String,
    public val assistantId: String?,
)

public data class SelectedWorkspace public constructor(
    public val path: String,
    public val name: String,
    public val gitBranch: String,
    public val kind: String,
    public val assistantId: String?,
    public val remoteConnectionId: String?,
    public val remoteSshHost: String?,
) {
    public constructor(path: String, name: String, gitBranch: String, kind: String, assistantId: String?) :
        this(path, name, gitBranch, kind, assistantId, null, null)
}
