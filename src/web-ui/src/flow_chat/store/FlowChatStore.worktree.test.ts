import { afterEach, describe, expect, it, vi } from 'vitest';
import { flowChatStore } from './FlowChatStore';
import type { Session } from '../types/flow-chat';
import { isSessionWorktreeBindingLocked } from '../utils/sessionWorktree';
import { sessionBelongsToWorkspaceNavRow } from '../utils/sessionOrdering';
import { resolveSessionSceneWorkspace } from '@/app/services/sessionSceneTarget';
import type { WorkspaceInfo } from '@/shared/types';
import { ensureBackendSession } from '../services/flow-chat-manager/SessionModule';
import type { FlowChatContext } from '../services/flow-chat-manager/types';
import { isLocalWorkspaceSession } from '../utils/sessionWorkspace';

const apiMocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  listSessionsPage: vi.fn(),
  restoreSessionView: vi.fn(),
  ensureCoordinatorSession: vi.fn(),
  createSession: vi.fn(),
  cancelSession: vi.fn(),
}));

vi.mock('@/infrastructure/api/service-api/SessionAPI', () => ({ sessionAPI: apiMocks }));
vi.mock('@/infrastructure/api/service-api/AgentAPI', () => ({ agentAPI: apiMocks }));
vi.mock('@/infrastructure/config/services/ConfigManager', () => ({
  configManager: { getConfigs: vi.fn(async () => ({})) },
}));
vi.mock('@/infrastructure/services/business/workspaceManager', () => ({
  workspaceManager: {
    getState: () => ({
      openedWorkspaces: new Map([['workspace-1', { id: 'workspace-1', rootPath: '/repo' }]]),
      recentWorkspaces: [],
    }),
  },
}));
vi.mock('../state-machine', () => ({
  stateMachineManager: { getOrCreate: vi.fn(), reset: vi.fn() },
  SessionExecutionEvent: {},
}));

describe('FlowChatStore lazy worktree preference', () => {
  afterEach(() => {
    flowChatStore.setState(state => ({ ...state, sessions: new Map(), activeSessionId: null }));
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('records and clears the desired state without changing the execution root', () => {
    const session = {
      sessionId: 'worktree-preference',
      dialogTurns: [],
      config: {
        workspacePath: '/repo',
        projectWorkspacePath: '/repo',
        executionTarget: { kind: 'local', rootPath: '/repo' },
      },
      workspacePath: '/repo',
      projectWorkspacePath: '/repo',
    } as Session;
    flowChatStore.setState(() => ({
      sessions: new Map([[session.sessionId, session]]),
      activeSessionId: session.sessionId,
    }));

    flowChatStore.setSessionWorktreeIsolationRequested(session.sessionId, true, 'pending-request');
    expect(flowChatStore.getState().sessions.get(session.sessionId)?.config).toMatchObject({
      workspacePath: '/repo',
      worktreeIsolationRequested: true,
      worktreeIsolationRequestId: 'pending-request',
      executionTarget: { kind: 'local', rootPath: '/repo' },
    });

    flowChatStore.setSessionWorktreeIsolationRequested(session.sessionId, true);
    expect(flowChatStore.getState().sessions.get(session.sessionId)?.config
      .worktreeIsolationRequestId).toBe('pending-request');
    flowChatStore.setSessionWorktreeIsolationRequested(session.sessionId, false);
    expect(flowChatStore.getState().sessions.get(session.sessionId)?.config
      .worktreeIsolationRequestId).toBeUndefined();
    flowChatStore.setSessionWorktreeIsolationRequested(session.sessionId, undefined);
    expect(
      flowChatStore.getState().sessions.get(session.sessionId)?.config
        .worktreeIsolationRequested,
    ).toBeUndefined();
    expect(flowChatStore.getState().sessions.get(session.sessionId)?.config
      .worktreeIsolationRequestId).toBeUndefined();
  });

  it.each([true, false])('keeps a rebound session visible and ready for the next turn with a project ID response: %s', async includesProjectId => {
    const workspace = { id: 'workspace-1', rootPath: '/repo', workspaceKind: 'normal' } as WorkspaceInfo;
    const session = {
      sessionId: 'first-worktree-turn',
      workspaceId: workspace.id,
      workspacePath: workspace.rootPath,
      dialogTurns: [{ id: 'submitted-turn' }],
      config: { workspaceId: workspace.id, workspacePath: workspace.rootPath },
    } as Session;
    flowChatStore.setState(state => ({
      ...state,
      sessions: new Map([[session.sessionId, session]]),
      activeSessionId: session.sessionId,
    }));
    const binding = {
      workspaceId: 'worktree-workspace',
      workspacePath: '/worktrees/new',
      projectWorkspacePath: workspace.rootPath,
      ...(includesProjectId ? { projectWorkspaceId: workspace.id } : {}),
      executionTarget: { kind: 'managedWorktree' as const, worktreeId: 'wt-1', rootPath: '/worktrees/new' },
    };

    flowChatStore.updateSessionExecutionTarget(session.sessionId, binding);

    const rebound = flowChatStore.getState().sessions.get(session.sessionId)!;
    expect(rebound).toMatchObject({
      workspaceId: binding.workspaceId,
      workspacePath: binding.workspacePath,
      projectWorkspaceId: workspace.id,
      config: {
        workspaceId: binding.workspaceId,
        projectWorkspaceId: workspace.id,
        executionTarget: binding.executionTarget,
      },
    });
    expect(rebound.dialogTurns).toBe(session.dialogTurns);
    expect(flowChatStore.getState().activeSessionId).toBe(session.sessionId);
    expect(sessionBelongsToWorkspaceNavRow(rebound, workspace.id)).toBe(true);
    expect(resolveSessionSceneWorkspace(rebound, [workspace])).toBe(workspace);

    // The execution workspace is registered by the host but is not an opened
    // frontend project. A second send must still reach the coordinator.
    await ensureBackendSession({ flowChatStore } as FlowChatContext, session.sessionId);
    expect(apiMocks.ensureCoordinatorSession).toHaveBeenCalledWith({
      sessionId: session.sessionId, workspaceId: binding.workspaceId, includeInternal: false,
    });
    expect(apiMocks.createSession).not.toHaveBeenCalled();
    expect(isLocalWorkspaceSession(rebound, workspace)).toBe(true);

    // Replaying an older host's binding must retain the original owner, not
    // promote the execution workspace to the owning project.
    flowChatStore.updateSessionExecutionTarget(session.sessionId, {
      ...binding, projectWorkspaceId: undefined,
    });
    expect(flowChatStore.getState().sessions.get(session.sessionId)?.projectWorkspaceId).toBe(workspace.id);
    expect(flowChatStore.removeSessionsForWorkspace(workspace)).toEqual([session.sessionId]);
    expect(flowChatStore.getState().sessions.has(session.sessionId)).toBe(false);
  });

  it('recreates an empty bound session in its execution root when the coordinator is missing', async () => {
    const session = {
      sessionId: 'empty-bound-session', workspaceId: 'worktree-workspace',
      workspacePath: '/worktrees/new', projectWorkspaceId: 'workspace-1',
      projectWorkspacePath: '/repo', dialogTurns: [],
      config: { executionTarget: { kind: 'managedWorktree', worktreeId: 'wt-1', rootPath: '/worktrees/new' } },
    } as Session;
    flowChatStore.setState(state => ({ ...state, sessions: new Map([[session.sessionId, session]]) }));
    apiMocks.ensureCoordinatorSession.mockRejectedValueOnce(new Error('Session metadata not found'));

    await ensureBackendSession({ flowChatStore } as FlowChatContext, session.sessionId);

    expect(apiMocks.createSession).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'worktree-workspace', workspacePath: '/worktrees/new', projectWorkspacePath: '/repo',
      executionTarget: { kind: 'existingWorktree', worktreeId: 'wt-1' },
    }));
  });

  it('cancels the worktree turn when its project closes while leaving detached work running', async () => {
    const settle = vi.spyOn(flowChatStore, 'cancelSessionTask').mockImplementation(() => {});
    const worktree = {
      sessionId: 'running-worktree', workspaceId: 'hidden-worktree', projectWorkspaceId: 'workspace-1',
      dialogTurns: [{ id: 'turn', status: 'processing', modelRounds: [] }], config: {},
    } as Session;
    const detached = {
      ...worktree, sessionId: 'detached',
      config: { dispatchTarget: { kind: 'ssh', connectionId: 'ssh', workspacePath: '/target' } },
    } as Session;
    flowChatStore.setState(state => ({ ...state, sessions: new Map([
      [worktree.sessionId, worktree], [detached.sessionId, detached],
    ]) }));

    await expect(flowChatStore.cancelRunningSessionsForWorkspace({ id: 'workspace-1', rootPath: '/repo' }))
      .resolves.toEqual([worktree.sessionId]);
    expect(apiMocks.cancelSession).toHaveBeenCalledExactlyOnceWith(worktree.sessionId);
    expect(settle).toHaveBeenCalledExactlyOnceWith(worktree.sessionId);
    expect(flowChatStore.getState().sessions.get(detached.sessionId)?.dialogTurns[0].status).toBe('processing');
  });

  it.each(['list', 'page'])('preserves persisted turn counts from the metadata %s before hydration', async (source) => {
    const metadata = [0, 1].map(turnCount => ({
      sessionId: `history-${turnCount}`,
      sessionName: 'Saved session',
      agentType: 'Standard',
      workspaceId: 'workspace-1',
      createdAt: 1,
      lastActiveAt: 2,
      turnCount,
    }));
    if (source === 'list') {
      apiMocks.listSessions.mockResolvedValueOnce(metadata);
      await flowChatStore.initializeFromDisk('workspace-1');
    } else {
      apiMocks.listSessionsPage.mockResolvedValueOnce({
        sessions: metadata, totalTopLevelCount: 2, loadedTopLevelCount: 2, hasMore: false,
      });
      await flowChatStore.loadSessionMetadataPage('workspace-1', 2);
    }

    for (const turnCount of [0, 1]) {
      const session = flowChatStore.getState().sessions.get(`history-${turnCount}`)!;
      expect(session).toMatchObject({ historyState: 'metadata-only', dialogTurns: [], totalTurnCount: turnCount });
      expect(isSessionWorktreeBindingLocked(session, false)).toBe(turnCount > 0);
    }
  });

  it.each([
    { deferFullHistoryUntilActive: false, expectedState: 'ready' },
    { deferFullHistoryUntilActive: true, expectedState: 'metadata-only' },
  ].flatMap(options => ['workspace-1', 'hidden-worktree'].map(workspaceId => ({ ...options, workspaceId }))))(
    'restores a child detail in $workspaceId only when active-session deferral is $deferFullHistoryUntilActive', async ({
    deferFullHistoryUntilActive, expectedState, workspaceId,
  }) => {
    const session = {
      sessionId: 'review-child',
      workspaceId,
      projectWorkspaceId: 'workspace-1',
      workspacePath: workspaceId === 'hidden-worktree' ? '/worktrees/saved' : '/repo',
      projectWorkspacePath: '/repo',
      parentSessionId: 'parent',
      sessionKind: 'review',
      dialogTurns: [],
      mode: 'Standard',
      config: { executionTarget: workspaceId === 'hidden-worktree'
        ? { kind: 'managedWorktree', worktreeId: 'wt-1', rootPath: '/worktrees/saved' }
        : { kind: 'local', rootPath: '/repo' } },
      isHistorical: true,
      historyState: 'metadata-only',
    } as Session;
    flowChatStore.setState(() => ({
      sessions: new Map([[session.sessionId, session]]), activeSessionId: 'parent',
    }));
    apiMocks.restoreSessionView.mockResolvedValueOnce({
      session: { sessionId: session.sessionId, agentType: 'CodeReview', state: 'Idle', turnCount: 1 },
      turns: [{
        sessionId: session.sessionId, turnId: 'review-turn', turnIndex: 0, timestamp: 1,
        userMessage: { id: 'review-request', content: 'Review changes', timestamp: 1 },
        modelRounds: [], startTime: 1, status: 'completed',
      }],
      contextRestoreState: 'ready', totalTurnCount: 1,
    });

    await flowChatStore.loadSessionHistory(session.sessionId, { deferFullHistoryUntilActive });

    const restored = flowChatStore.getState().sessions.get(session.sessionId)!;
    expect(restored.historyState).toBe(expectedState);
    expect(flowChatStore.getState().activeSessionId).toBe('parent');
    expect(restored.config.executionTarget).toEqual(session.config.executionTarget);
    if (!deferFullHistoryUntilActive) {
      expect(restored).toMatchObject({ mode: 'CodeReview', totalTurnCount: 1, dialogTurns: [{ id: 'review-turn' }] });
      expect(isSessionWorktreeBindingLocked(restored, false)).toBe(true);
      await ensureBackendSession({ flowChatStore } as FlowChatContext, session.sessionId);
      expect(apiMocks.ensureCoordinatorSession).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: session.sessionId, workspaceId: session.workspaceId,
      }));
    } else {
      expect(restored.dialogTurns).toEqual([]);
    }
  });
});
