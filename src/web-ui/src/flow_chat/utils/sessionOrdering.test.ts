import { describe, expect, it } from 'vitest';
import type { Session } from '../types/flow-chat';
import {
  compareSessionMetadataForDisplay,
  compareSessionsForDisplay,
  compareSessionsForNavStable,
  getSessionMetadataSortTimestamp,
  getSessionSortTimestamp,
  sessionBelongsToWorkspaceNavRow,
} from './sessionOrdering';

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 'session-1',
    title: 'Session Title',
    titleStatus: 'generated',
    dialogTurns: [],
    status: 'idle',
    config: {
      modelName: 'gpt-test',
      agentType: 'Standard',
    },
    createdAt: 1000,
    lastActiveAt: undefined,
    lastFinishedAt: undefined,
    error: null,
    todos: [],
    maxContextTokens: 128128,
    mode: 'Standard',
    workspacePath: '/workspace',
    parentSessionId: undefined,
    sessionKind: 'normal',
    btwThreads: [],
    btwOrigin: undefined,
    ...overrides,
  };
}

describe('sessionOrdering', () => {
  it('uses lastFinishedAt when available', () => {
    const session = createSession({ createdAt: 1234, lastActiveAt: 5678, lastFinishedAt: 9999 });
    expect(getSessionSortTimestamp(session)).toBe(9999);
  });

  it('uses createdAt as fallback', () => {
    const session = createSession({ createdAt: 1234, lastActiveAt: 5678 });
    expect(getSessionSortTimestamp(session)).toBe(1234);
  });

  it('does not move a switched or streaming session above newer display timestamps', () => {
    const sessions = [
      createSession({ sessionId: 'older-new', createdAt: 1000 }),
      createSession({ sessionId: 'completed', createdAt: 500, lastFinishedAt: 3000 }),
      createSession({ sessionId: 'switched-or-streaming', createdAt: 200, lastActiveAt: 5000 }),
      createSession({ sessionId: 'newest-new', createdAt: 2000 }),
    ];

    const orderedIds = [...sessions].sort(compareSessionsForDisplay).map(session => session.sessionId);
    expect(orderedIds).toEqual(['completed', 'newest-new', 'older-new', 'switched-or-streaming']);
  });

  it('falls back to stable ordering when timestamps are equal', () => {
    const sessions = [
      createSession({ sessionId: 'b', createdAt: 1000 }),
      createSession({ sessionId: 'a', createdAt: 1000 }),
    ];

    const orderedIds = [...sessions].sort(compareSessionsForDisplay).map(session => session.sessionId);
    expect(orderedIds).toEqual(['a', 'b']);
  });

  it('nav stable sort ignores lastActiveAt so order does not change on session switch', () => {
    const sessions = [
      createSession({ sessionId: 'first', createdAt: 3000, lastActiveAt: 100 }),
      createSession({ sessionId: 'second', createdAt: 2000, lastActiveAt: 99999 }),
    ];
    const orderedIds = [...sessions].sort(compareSessionsForNavStable).map(s => s.sessionId);
    expect(orderedIds).toEqual(['first', 'second']);
  });

  it('pins empty new sessions to the top of the nav list', () => {
    const sessions = [
      createSession({ sessionId: 'old-empty', createdAt: 1000, historyState: 'new', dialogTurns: [] }),
      createSession({ sessionId: 'active', createdAt: 2000, historyState: 'ready', dialogTurns: [{ id: 't1' } as never] }),
      createSession({ sessionId: 'new-empty', createdAt: 3000, historyState: 'new', dialogTurns: [] }),
    ];
    const orderedIds = [...sessions].sort(compareSessionsForNavStable).map(s => s.sessionId);
    expect(orderedIds).toEqual(['new-empty', 'old-empty', 'active']);
  });

  it('does not pin sessions whose historyState is not new even when dialogTurns is empty', () => {
    const sessions = [
      createSession({ sessionId: 'ready-empty', createdAt: 1000, historyState: 'ready', dialogTurns: [] }),
      createSession({ sessionId: 'active', createdAt: 2000, historyState: 'ready', dialogTurns: [{ id: 't1' } as never] }),
    ];
    const orderedIds = [...sessions].sort(compareSessionsForNavStable).map(s => s.sessionId);
    expect(orderedIds).toEqual(['active', 'ready-empty']);
  });

  it('sorts persisted metadata by lastFinishedAt before createdAt without using lastActiveAt', () => {
    const metadata = [
      { sessionId: 'older-new', createdAt: 1000, lastActiveAt: 9000 },
      { sessionId: 'completed', createdAt: 500, lastActiveAt: 600, lastFinishedAt: 3000 },
      { sessionId: 'newest-new', createdAt: 2000, lastActiveAt: 2500 },
    ];

    expect(getSessionMetadataSortTimestamp(metadata[0])).toBe(1000);
    const orderedIds = [...metadata].sort(compareSessionMetadataForDisplay).map(session => session.sessionId);
    expect(orderedIds).toEqual(['completed', 'newest-new', 'older-new']);
  });

  it('falls back to legacy customMetadata lastFinishedAt for persisted metadata sorting', () => {
    expect(getSessionMetadataSortTimestamp({
      sessionId: 'legacy-completed',
      createdAt: 500,
      lastActiveAt: 600,
      customMetadata: { lastFinishedAt: 3000 },
    })).toBe(3000);
  });

  it('remote SSH: same host but different remote root does not share nav row', () => {
    const conn = 'ssh-user@myserver.example.com:22';
    const host = 'myserver.example.com';
    const rowPath = '/home/u/project-a';
    const otherPath = '/home/u/project-b';

    const sessionA = {
      workspaceId: 'remote-project-a',
      workspacePath: rowPath,
      remoteConnectionId: conn,
      remoteSshHost: host,
    };
    const sessionB = {
      workspaceId: 'remote-project-b',
      workspacePath: otherPath,
      remoteConnectionId: conn,
      remoteSshHost: host,
    };

    expect(
      sessionBelongsToWorkspaceNavRow(sessionA, 'remote-project-a')
    ).toBe(true);
    expect(
      sessionBelongsToWorkspaceNavRow(sessionB, 'remote-project-a')
    ).toBe(false);
  });

  it('remote SSH: uses the registered workspace ID when host metadata is absent', () => {
    const session = {
      workspaceId: 'remote-project-a',
      workspacePath: '/home/u/project-a',
      remoteConnectionId: 'ssh-user@myserver.example.com:22',
      remoteSshHost: undefined,
    };

    expect(
      sessionBelongsToWorkspaceNavRow(
        session,
        'remote-project-a',
      )
    ).toBe(true);
  });

  it('remote SSH: hostname alone does not identify a navigation row', () => {
    const session = {
      workspaceId: undefined,
      workspacePath: '/home/u/project-a',
      remoteConnectionId: undefined,
      remoteSshHost: undefined,
      workspaceHostname: 'myserver.example.com',
    };

    expect(
      sessionBelongsToWorkspaceNavRow(
        session,
        'remote-project-a',
      )
    ).toBe(false);
  });

  it('groups a worktree execution session under its main project', () => {
    const session = {
      workspaceId: 'worktree-id',
      projectWorkspaceId: 'project-id',
      workspacePath: '/worktrees/project/wt-1',
      projectWorkspacePath: '/projects/project',
      remoteConnectionId: undefined,
      remoteSshHost: undefined,
    };

    expect(
      sessionBelongsToWorkspaceNavRow(session, 'project-id')
    ).toBe(true);
    expect(
      sessionBelongsToWorkspaceNavRow(session, 'other-project-id')
    ).toBe(false);
  });

  it('does not assign a workspace-less session to every navigation row', () => {
    const session = {
      workspaceId: undefined,
      workspacePath: undefined,
      projectWorkspacePath: undefined,
      remoteConnectionId: undefined,
      remoteSshHost: undefined,
    };

    expect(
      sessionBelongsToWorkspaceNavRow(session, 'assistant-id')
    ).toBe(false);
    expect(
      sessionBelongsToWorkspaceNavRow(session, 'project-id')
    ).toBe(false);
  });
});
