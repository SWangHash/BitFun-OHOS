import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnapshotAPI } from './SnapshotAPI';
import { activateSurface } from '@/infrastructure/peer-device/deviceSurface';

const invokeMock = vi.hoisted(() => vi.fn());
const sessionsMock = vi.hoisted(() => new Map<string, any>());
const peerCapabilities = vi.hoisted(() => ({ workspaceIdReferencesV1: true }));

vi.mock('@/infrastructure/peer-device/PeerConnectionManager', () => ({
  peerConnectionManager: {
    get: () => ({ getState: () => ({ capabilities: peerCapabilities }) }),
  },
}));

vi.mock('./ApiClient', () => ({
  api: {
    invoke: invokeMock,
  },
}));

vi.mock('@/flow_chat/store/FlowChatStore', () => ({
  flowChatStore: {
    getState: () => ({ sessions: sessionsMock }),
  },
}));

describe('SnapshotAPI request dedupe', () => {
  let snapshotAPI: SnapshotAPI;

  beforeEach(() => {
    activateSurface('local');
    snapshotAPI = new SnapshotAPI();
    invokeMock.mockReset();
    sessionsMock.clear();
    peerCapabilities.workspaceIdReferencesV1 = true;
  });

  afterEach(() => activateSurface('local'));

  it('deduplicates concurrent session stats requests for the same session and workspace', async () => {
    const stats = {
      session_id: 'session-1',
      total_files: 2,
      total_turns: 3,
      total_changes: 4,
    };
    invokeMock.mockResolvedValueOnce(stats);

    const first = snapshotAPI.getSessionStats('session-1', 'local-workspace');
    const second = snapshotAPI.getSessionStats('session-1', 'local-workspace');

    await expect(Promise.all([first, second])).resolves.toEqual([stats, stats]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('get_session_stats', {
      request: {
        session_id: 'session-1',
        workspaceId: 'local-workspace',
      },
    });
  });

  it('allows a new session stats request after the in-flight request settles', async () => {
    invokeMock
      .mockResolvedValueOnce({
        session_id: 'session-1',
        total_files: 1,
        total_turns: 1,
        total_changes: 1,
      })
      .mockResolvedValueOnce({
        session_id: 'session-1',
        total_files: 2,
        total_turns: 2,
        total_changes: 2,
      });

    await snapshotAPI.getSessionStats('session-1', 'local-workspace');
    await snapshotAPI.getSessionStats('session-1', 'local-workspace');

    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('preserves the session remote binding on snapshot mutations', async () => {
    sessionsMock.set('remote-session', {
      workspaceId: 'remote-workspace',
      workspacePath: '/srv/project',
      remoteConnectionId: 'ssh:user@example.com:22',
      remoteSshHost: 'example.com',
      config: {},
    });
    invokeMock.mockResolvedValue(undefined);

    await snapshotAPI.rejectFileModifications(
      'remote-session',
      'src/main.rs',
      'remote-workspace',
    );

    expect(invokeMock).toHaveBeenCalledWith('reject_file', {
      request: {
        sessionId: 'remote-session',
        filePath: 'src/main.rs',
        workspaceId: 'remote-workspace',
      },
    });
  });

  it('preserves the session remote binding on snapshot reads after disconnect', async () => {
    sessionsMock.set('remote-session', {
      workspaceId: 'remote-workspace',
      workspacePath: 'D:/workspace/project',
      remoteConnectionId: 'ssh:user@example.com:22',
      remoteSshHost: 'example.com',
      config: {},
    });
    invokeMock.mockResolvedValue({
      session_id: 'remote-session',
      total_files: 0,
      total_turns: 0,
      total_changes: 0,
    });

    await snapshotAPI.getSessionStats('remote-session');

    expect(invokeMock).toHaveBeenCalledWith('get_session_stats', {
      request: {
        session_id: 'remote-session',
        workspaceId: 'remote-workspace',
      },
    });
  });

  it('never reuses a pending snapshot response across device surface activations', async () => {
    let resolveFirst!: (value: unknown) => void;
    invokeMock.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
    invokeMock.mockResolvedValueOnce({ operationId: 'operation-1', linesAdded: 2 });
    const first = snapshotAPI.getOperationSummary('same-session', 'operation-1', 'same-workspace-id');
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    activateSurface('peer-b');
    const second = snapshotAPI.getOperationSummary('same-session', 'operation-1', 'same-workspace-id');
    await expect(second).resolves.toMatchObject({ linesAdded: 2 });
    expect(invokeMock).toHaveBeenCalledTimes(2);
    resolveFirst({ operationId: 'operation-1', linesAdded: 1 });
    await expect(first).resolves.toMatchObject({ linesAdded: 1 });
    activateSurface('local');
  });

  it('resolves the registered remote identity for a negotiated legacy peer', async () => {
    activateSurface('legacy-peer');
    peerCapabilities.workspaceIdReferencesV1 = false;
    sessionsMock.set('legacy-remote', {
      workspaceId: 'remote-workspace',
      workspacePath: '/srv/shared',
      config: { remoteSshHost: 'legacy.example' },
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'get_opened_workspaces') return [];
      if (command === 'get_recent_workspaces') return [{
        id: 'remote-workspace', rootPath: '/srv/shared', workspaceKind: 'remote',
        connectionId: 'saved-connection', sshHost: 'legacy.example',
      }];
      return {};
    });
    await snapshotAPI.getOperationSummary('legacy-remote', 'operation-1');
    expect(invokeMock).toHaveBeenCalledWith('get_operation_summary', {
      request: {
        sessionId: 'legacy-remote', operationId: 'operation-1',
        workspacePath: '/srv/shared', remoteSshHost: 'legacy.example',
        remoteConnectionId: 'saved-connection',
      },
    });
  });

  it('scopes persisted operation diff and summary to the Session connection', async () => {
    sessionsMock.set('remote-operation', {
      workspaceId: 'remote-workspace',
      workspacePath: '/srv/shared',
      remoteConnectionId: 'ssh:user-a@host:22', remoteSshHost: 'host', config: {},
    });
    invokeMock.mockResolvedValue({});
    await snapshotAPI.getOperationDiff('remote-operation', '/srv/shared/file.txt', 'operation-1');
    await snapshotAPI.getOperationSummary('remote-operation', 'operation-1');
    for (const [command, args] of invokeMock.mock.calls) {
      expect(['get_operation_diff', 'get_operation_summary']).toContain(command);
      expect(args.request).toMatchObject({
        workspaceId: 'remote-workspace',
        sessionId: 'remote-operation', operationId: 'operation-1',
      });
    }
  });

  it('does not treat a persisted localhost hostname as a remote session binding', async () => {
    sessionsMock.set('local-history-session', {
      workspaceId: 'local-workspace',
      workspacePath: 'D:/workspace/project',
      remoteSshHost: 'localhost',
      config: {},
    });
    invokeMock.mockResolvedValue({
      session_id: 'local-history-session',
      total_files: 0,
      total_turns: 0,
      total_changes: 0,
    });

    await snapshotAPI.getSessionStats('local-history-session');

    expect(invokeMock).toHaveBeenCalledWith('get_session_stats', {
      request: {
        session_id: 'local-history-session',
        workspaceId: 'local-workspace',
      },
    });
  });

  it('keeps worktree snapshot reads and mutations on the execution workspace', async () => {
    sessionsMock.set('worktree-session', {
      workspaceId: 'worktree-workspace',
      workspacePath: '/worktrees/task',
      projectWorkspaceId: 'project-workspace',
      projectWorkspacePath: '/projects/main',
      config: {},
    });
    invokeMock.mockResolvedValue({});

    await snapshotAPI.getSessionFiles('worktree-session');
    await snapshotAPI.getSessionFileDiffStats('worktree-session', '/worktrees/task/README.md');
    await snapshotAPI.getOperationDiff('worktree-session', '/worktrees/task/README.md', 'edit-1');
    await snapshotAPI.rejectFileModifications('worktree-session', '/worktrees/task/README.md');
    await snapshotAPI.rollbackSession('worktree-session');

    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      'get_session_files', 'get_session_file_diff_stats', 'get_operation_diff',
      'reject_file', 'rollback_session',
    ]);
    for (const [, args] of invokeMock.mock.calls) {
      expect(args.request.workspaceId).toBe('worktree-workspace');
    }
  });
});
