import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SnapshotAPI } from './SnapshotAPI';
import { activateSurface, isSurfaceChangedError } from '@/infrastructure/peer-device/deviceSurface';

const invokeMock = vi.hoisted(() => vi.fn());
const peerCapabilities = vi.hoisted(() => ({ workspaceIdReferencesV1: true }));
const sessionsMock = vi.hoisted(() => new Map<string, any>());
vi.mock('./ApiClient', () => ({ api: { invoke: invokeMock } }));
vi.mock('@/flow_chat/store/FlowChatStore', () => ({
  flowChatStore: { getState: () => ({ sessions: sessionsMock }) },
}));
vi.mock('@/infrastructure/peer-device/PeerConnectionManager', () => ({
  peerConnectionManager: { get: () => ({ getState: () => ({ capabilities: peerCapabilities }) }) },
}));

describe('SnapshotAPI workspace identity', () => {
  let snapshotAPI: SnapshotAPI;
  beforeEach(() => {
    activateSurface('local');
    snapshotAPI = new SnapshotAPI();
    invokeMock.mockReset();
    sessionsMock.clear();
    peerCapabilities.workspaceIdReferencesV1 = true;
  });

  it('deduplicates concurrent reads by workspace ID and allows another read after settlement', async () => {
    const stats = { session_id: 'session-1', total_files: 2 };
    invokeMock.mockResolvedValue(stats);
    const first = snapshotAPI.getSessionStats('session-1', 'opaque-id');
    const second = snapshotAPI.getSessionStats('session-1', 'opaque-id');
    await expect(Promise.all([first, second])).resolves.toEqual([stats, stats]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('get_session_stats', {
      request: { session_id: 'session-1', workspaceId: 'opaque-id' },
    });
    await snapshotAPI.getSessionStats('session-1', 'opaque-id');
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('does not merge two IDs whose stored roots are identical', async () => {
    sessionsMock.set('a', { workspaceId: 'id-a', workspacePath: '/same/root' });
    sessionsMock.set('b', { workspaceId: 'id-b', workspacePath: '/same/root' });
    invokeMock.mockResolvedValue({});
    await Promise.all([snapshotAPI.getSessionStats('a'), snapshotAPI.getSessionStats('b')]);
    expect(invokeMock.mock.calls.map(([, args]) => args.request.workspaceId)).toEqual(['id-a', 'id-b']);
  });

  it('keeps the session ID binding for remote mutations and offline operation history', async () => {
    sessionsMock.set('remote-session', {
      workspaceId: 'remote-object', workspacePath: '/srv/project',
      remoteConnectionId: 'ssh:old', remoteSshHost: 'old.example',
    });
    invokeMock.mockResolvedValue({});
    await snapshotAPI.rejectFileModifications('remote-session', 'src/main.rs');
    await snapshotAPI.getOperationDiff('remote-session', 'src/main.rs', 'operation-1');
    await snapshotAPI.getOperationSummary('remote-session', 'operation-1');
    for (const [, args] of invokeMock.mock.calls) {
      expect(args.request.workspaceId).toBe('remote-object');
      expect(args.request).not.toHaveProperty('workspacePath');
      expect(args.request).not.toHaveProperty('remoteConnectionId');
      expect(args.request).not.toHaveProperty('remoteSshHost');
    }
  });

  it('does not reinterpret a legacy path-only session before catalog migration', async () => {
    sessionsMock.set('legacy', { workspacePath: '/srv/shared', config: { remoteSshHost: 'host' } });
    await expect(snapshotAPI.getOperationSummary('legacy', 'operation-1')).rejects.toThrow('workspaceId');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('rejects a caller trying to replace a known session owner', async () => {
    sessionsMock.set('session', { workspaceId: 'owner' });
    await expect(snapshotAPI.rejectFileModifications('session', 'file', 'different')).rejects.toThrow('does not match');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('ignores stale SSH metadata on a local session', async () => {
    sessionsMock.set('local', { config: { workspaceId: 'local-object', remoteSshHost: 'stale-host' } });
    invokeMock.mockResolvedValue({});
    await snapshotAPI.getSessionStats('local');
    expect(invokeMock).toHaveBeenCalledWith('get_session_stats', {
      request: { session_id: 'local', workspaceId: 'local-object' },
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

  it('never reuses a pending response across device surface activations', async () => {
    let resolveFirst!: (value: unknown) => void;
    invokeMock.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
    invokeMock.mockResolvedValueOnce({ linesAdded: 2 });
    const first = snapshotAPI.getOperationSummary('same-session', 'operation-1', 'same-id');
    const firstRejection = expect(first).rejects.toSatisfy(isSurfaceChangedError);
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    activateSurface('peer-b');
    const second = snapshotAPI.getOperationSummary('same-session', 'operation-1', 'same-id');
    await expect(second).resolves.toMatchObject({ linesAdded: 2 });
    expect(invokeMock).toHaveBeenCalledTimes(2);
    resolveFirst({ linesAdded: 1 });
    await firstRejection;
  });

  it('does not dispatch after the driving host changes during serialization', async () => {
    const pending = snapshotAPI.getSessionStats('session', 'same-id');
    const rejection = expect(pending).rejects.toThrow();
    activateSurface('peer-c');
    await rejection;
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('serializes a legacy peer request from the selected ID, including the remote host', async () => {
    peerCapabilities.workspaceIdReferencesV1 = false;
    activateSurface('legacy-peer');
    const records = [
      { id: 'local-id', rootPath: '/same/root', workspaceKind: 'normal' },
      { id: 'remote-id', rootPath: '/same/root', workspaceKind: 'remote', connectionId: 'ssh-id', sshHost: 'host' },
    ];
    invokeMock.mockImplementation(async (command: string) =>
      command === 'get_opened_workspaces' || command === 'get_recent_workspaces' ? records : {});
    await snapshotAPI.getOperationSummary('session', 'operation', 'remote-id');
    expect(invokeMock).toHaveBeenCalledWith('get_operation_summary', {
      request: { sessionId: 'session', operationId: 'operation', workspacePath: '/same/root',
        remoteConnectionId: 'ssh-id', remoteSshHost: 'host' },
    });
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

  it('stops a multi-turn snapshot read when the device changes during a turn read', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'get_session_turns') return [0, 1];
      if (command === 'get_turn_files') {
        activateSurface('other-device');
        return ['old-device.txt'];
      }
      return [];
    });

    await expect(snapshotAPI.getSessionTurnSnapshots('same-session', 'same-workspace'))
      .rejects.toSatisfy(isSurfaceChangedError);
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      'get_session_turns', 'get_turn_files',
    ]);
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
