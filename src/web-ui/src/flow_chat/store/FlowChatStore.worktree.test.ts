import { afterEach, describe, expect, it, vi } from 'vitest';
import { flowChatStore } from './FlowChatStore';
import type { Session } from '../types/flow-chat';
import { isSessionWorktreeBindingLocked } from '../utils/sessionWorktree';

const apiMocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  listSessionsPage: vi.fn(),
  restoreSessionView: vi.fn(),
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
  ])('restores a child detail only when active-session deferral is $deferFullHistoryUntilActive', async ({
    deferFullHistoryUntilActive, expectedState,
  }) => {
    const session = {
      sessionId: 'review-child',
      workspaceId: 'workspace-1',
      parentSessionId: 'parent',
      sessionKind: 'review',
      dialogTurns: [],
      mode: 'Standard',
      config: { executionTarget: { kind: 'local', rootPath: '/repo' } },
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
    } else {
      expect(restored.dialogTurns).toEqual([]);
    }
  });
});
