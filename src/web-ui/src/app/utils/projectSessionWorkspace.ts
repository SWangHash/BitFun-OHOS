import { WorkspaceKind, isRemoteWorkspace, type WorkspaceInfo } from '@/shared/types';
import { workspaceManager } from '@/infrastructure/services/business/workspaceManager';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { sessionBelongsToWorkspaceNavRow } from '@/flow_chat/utils/sessionOrdering';
import { normalizeDefaultSessionTitleMode } from '@/flow_chat/utils/sessionTitle';

/**
 * Find an existing empty session in the workspace that can be reused instead
 * of creating a new one. An empty session has no dialog turns and is in the
 * fresh "new" lifecycle state (never sent a message).
 *
 * Empty-session reuse is tracked per category (code / cowork / claw). An
 * existing empty code session does NOT block creating a new empty cowork
 * session, and vice versa: only sessions whose normalized mode matches the
 * requested mode are considered. When no same-category empty session exists,
 * null is returned so the caller creates a new session of the requested type.
 */
export function findReusableEmptySessionId(
  workspace: WorkspaceInfo,
  requestedMode?: string
): string | null {
  const { sessions } = flowChatStore.getState();
  const remoteConnectionId = isRemoteWorkspace(workspace)
    ? workspace.connectionId
    : undefined;
  const remoteSshHost = isRemoteWorkspace(workspace)
    ? workspace.sshHost
    : undefined;

  const targetMode = normalizeDefaultSessionTitleMode(requestedMode);

  const candidates: Array<{ sessionId: string; createdAt: number }> = [];

  for (const session of sessions.values()) {
    if (session.isTransient) {
      continue;
    }
    if (session.sessionKind === 'subagent') {
      continue;
    }
    if (session.dialogTurns.length > 0) {
      continue;
    }
    if (session.historyState !== 'new') {
      continue;
    }
    if (
      !sessionBelongsToWorkspaceNavRow(
        session,
        workspace.rootPath,
        remoteConnectionId,
        remoteSshHost
      )
    ) {
      continue;
    }

    const sessionMode = normalizeDefaultSessionTitleMode(
      session.mode || session.config.agentType
    );
    if (sessionMode !== targetMode) {
      continue;
    }

    candidates.push({
      sessionId: session.sessionId,
      createdAt: session.createdAt,
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.createdAt - a.createdAt);

  return candidates[0].sessionId;
}

/**
 * Code / Cowork sessions belong to project (non-assistant) workspaces only.
 * Assistant “instances” use Claw sessions under their own storage.
 */
export function pickWorkspaceForProjectChatSession(
  currentWorkspace: WorkspaceInfo | null | undefined,
  normalWorkspacesList: WorkspaceInfo[]
): WorkspaceInfo | null {
  if (currentWorkspace && currentWorkspace.workspaceKind !== WorkspaceKind.Assistant) {
    return currentWorkspace;
  }
  return normalWorkspacesList[0] ?? null;
}

/**
 * Resolve the user-selected primary assistant. The built-in assistant remains
 * a backward-compatible fallback for startup snapshots from older hosts.
 */
export function pickPrimaryAssistantWorkspace(
  assistantWorkspacesList: WorkspaceInfo[],
  primaryAssistantWorkspaceId?: string | null,
): WorkspaceInfo | null {
  if (primaryAssistantWorkspaceId) {
    return assistantWorkspacesList.find(
      workspace => workspace.workspaceKind === WorkspaceKind.Assistant && workspace.id === primaryAssistantWorkspaceId
    ) ?? null;
  }
  return assistantWorkspacesList.find(
    workspace =>
      workspace.workspaceKind === WorkspaceKind.Assistant &&
      !workspace.assistantId
  ) ?? null;
}

/**
 * Build create_session config from the live workspace. After Peer Device Mode
 * switch, callers must pass this (not `{}`) so the peer host never sees a
 * stale controller path. See `infrastructure/peer-device/README.md`.
 */
export function flowChatSessionConfigForWorkspace(workspace: WorkspaceInfo) {
  return {
    workspacePath: workspace.rootPath,
    ...(isRemoteWorkspace(workspace) && workspace.connectionId
      ? { remoteConnectionId: workspace.connectionId }
      : {}),
    ...(isRemoteWorkspace(workspace) && workspace.sshHost
      ? { remoteSshHost: workspace.sshHost }
      : {}),
  };
}

/**
 * Prefer the live workspaceManager workspace for create_session. Returns `{}`
 * only when no workspace is open yet (caller / SessionModule must still resolve).
 */
export function flowChatSessionConfigForCurrentWorkspace(
  workspace?: WorkspaceInfo | null,
) {
  const live = workspace ?? workspaceManager.getState().currentWorkspace;
  if (!live) {
    return {};
  }
  return flowChatSessionConfigForWorkspace(live);
}
