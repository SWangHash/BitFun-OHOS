/** Workspace ownership uses the host's persisted ID, never a folder key. */
import type { WorkspaceInfo } from '@/shared/types';
import type { Session } from '../types/flow-chat';
import { resolveLegacySessionWorkspace } from '@/infrastructure/api/service-api/legacyWorkspaceCompatibility';
import { sessionProjectWorkspaceId, sessionWorkspaceId } from './sessionWorkspace';

type SessionScope = Pick<Session,
  'workspaceId' | 'workspacePath' | 'projectWorkspacePath' | 'remoteConnectionId' | 'remoteSshHost'>
  & Partial<Pick<Session, 'projectWorkspaceId' | 'config'>>;
type WorkspaceScope = Pick<WorkspaceInfo, 'id'>;

export function sessionMatchesWorkspace(session: SessionScope, workspace: WorkspaceScope): boolean {
  return sessionWorkspaceId(session) === workspace.id || sessionProjectWorkspaceId(session) === workspace.id;
}

/** Opened workspace used to activate a session, including hidden managed worktrees. */
export function findWorkspaceForSession(
  session: SessionScope,
  workspaces: Iterable<WorkspaceInfo>,
): WorkspaceInfo | undefined {
  const records = [...workspaces];
  const workspaceId = sessionWorkspaceId(session);
  const projectId = sessionProjectWorkspaceId(session);
  if (workspaceId || projectId) {
    return records.find(workspace => workspace.id === workspaceId)
      ?? records.find(workspace => workspace.id === projectId);
  }
  return resolveLegacySessionWorkspace(session, records);
}
