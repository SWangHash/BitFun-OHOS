import { afterEach, describe, expect, it } from 'vitest';
import { flowChatStore } from './FlowChatStore';
import type { Session } from '../types/flow-chat';

describe('FlowChatStore lazy worktree preference', () => {
  afterEach(() => {
    flowChatStore.setState(state => ({ ...state, sessions: new Map(), activeSessionId: null }));
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
});
