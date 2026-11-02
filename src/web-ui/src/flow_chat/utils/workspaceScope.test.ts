import { describe, expect, it } from 'vitest';
import type { WorkspaceInfo } from '@/shared/types';
import { findWorkspaceForSession, sessionMatchesWorkspace } from './workspaceScope';

function remoteWorkspace(id: string, connectionId: string): WorkspaceInfo {
  return {
    id,
    rootPath: '/workspace',
    workspaceKind: 'remote',
    connectionId,
    sshHost: `${connectionId}.example.test`,
  } as WorkspaceInfo;
}

describe('findWorkspaceForSession', () => {
  it('does not retarget a stale workspace ID to the same path', () => {
    const workspace = { id: 'new-id', rootPath: '/project' } as WorkspaceInfo;
    expect(findWorkspaceForSession({ workspaceId: 'old-id', workspacePath: '/project' },
      new Map([[workspace.id, workspace]]).values())).toBeUndefined();
  });
  it('uses remote identity instead of an ambiguous POSIX path', () => {
    const first = remoteWorkspace('workspace-a', 'connection-a');
    const second = remoteWorkspace('workspace-b', 'connection-b');

    expect(findWorkspaceForSession({
      workspacePath: '/workspace',
      remoteConnectionId: 'connection-b',
    }, [first, second])).toBe(second);
  });

  it('uses an opened execution worktree and falls back to its project when hidden', () => {
    const project = { id: 'project', rootPath: '/repo' } as WorkspaceInfo;
    const execution = { id: 'worktree', rootPath: '/worktrees/new' } as WorkspaceInfo;
    expect(findWorkspaceForSession({
      workspaceId: execution.id, projectWorkspaceId: project.id,
    }, [execution, project])).toBe(execution);
    expect(findWorkspaceForSession({
      workspaceId: execution.id, projectWorkspaceId: project.id,
    }, [execution])).toBe(execution);
    expect(findWorkspaceForSession({
      workspaceId: execution.id, config: { projectWorkspaceId: project.id },
    }, [project])).toBe(project);
    expect(findWorkspaceForSession({
      workspaceId: execution.id, projectWorkspaceId: 'unavailable-project', projectWorkspacePath: '/repo',
    }, [execution, project])).toBe(execution);
    expect(findWorkspaceForSession({
      workspaceId: execution.id, projectWorkspaceId: 'unavailable-project', projectWorkspacePath: '/repo',
    }, [project])).toBeUndefined();
  });

  it('includes a worktree when closing its project or execution workspace, without matching another host by path', () => {
    const session = {
      workspaceId: 'worktree', projectWorkspaceId: 'project', workspacePath: '/repo',
    };
    expect(sessionMatchesWorkspace(session, { id: 'project' })).toBe(true);
    expect(sessionMatchesWorkspace(session, { id: 'worktree' })).toBe(true);
    expect(sessionMatchesWorkspace(session, remoteWorkspace('remote', 'ssh'))).toBe(false);
  });
});
