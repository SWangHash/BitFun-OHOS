import { afterEach, describe, expect, it } from 'vitest';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import type { FlowChatState, Session } from '@/flow_chat/types/flow-chat';
import { WorkspaceKind, type WorkspaceInfo } from '@/shared/types';
import {
  findReusableEmptySessionId,
  pickPrimaryAssistantWorkspace,
} from './projectSessionWorkspace';

const resetStore = () => {
  flowChatStore.setState((): FlowChatState => ({
    sessions: new Map(),
    activeSessionId: null,
  }));
};

const createWorkspace = (): WorkspaceInfo => ({
  id: 'workspace-1',
  name: 'OpenBitFun',
  rootPath: '/workspace/OpenBitFun',
  workspaceKind: WorkspaceKind.Normal,
  workspaceType: 'local' as never,
  languages: [],
  openedAt: '',
  lastAccessed: '',
  tags: [],
});

const createSession = (overrides: Partial<Session> = {}): Session => ({
  sessionId: 'session-1',
  title: 'Session 1',
  dialogTurns: [],
  status: 'idle',
  config: { agentType: 'agentic' },
  createdAt: 1,
  lastActiveAt: 1,
  error: null,
  isHistorical: false,
  maxContextTokens: 128128,
  mode: 'agentic',
  workspacePath: '/workspace/OpenBitFun',
  workspaceId: 'workspace-1',
  sessionKind: 'normal',
  btwThreads: [],
  isTransient: false,
  historyState: 'new',
  ...overrides,
});

describe('findReusableEmptySessionId', () => {
  afterEach(() => {
    resetStore();
  });

  it('reuses an existing empty session in the same workspace', () => {
    const workspace = createWorkspace();
    const emptySession = createSession({
      sessionId: 'empty-session',
      lastActiveAt: 5,
    });

    flowChatStore.setState(() => ({
      sessions: new Map([[emptySession.sessionId, emptySession]]),
      activeSessionId: null,
    }));

    expect(findReusableEmptySessionId(workspace, 'agentic')).toBe('empty-session');
  });

  it('returns null when no empty session exists', () => {
    const workspace = createWorkspace();
    const activeSession = createSession({
      sessionId: 'active-session',
      dialogTurns: [{ id: 'turn-1' } as never],
      historyState: 'ready',
    });

    flowChatStore.setState(() => ({
      sessions: new Map([[activeSession.sessionId, activeSession]]),
      activeSessionId: activeSession.sessionId,
    }));

    expect(findReusableEmptySessionId(workspace, 'agentic')).toBeNull();
  });

  it('returns null when the empty session belongs to a different workspace', () => {
    const workspace = createWorkspace();
    const otherSession = createSession({
      sessionId: 'other-session',
      workspacePath: '/workspace/Other',
      workspaceId: 'workspace-2',
    });

    flowChatStore.setState(() => ({
      sessions: new Map([[otherSession.sessionId, otherSession]]),
      activeSessionId: null,
    }));

    expect(findReusableEmptySessionId(workspace, 'agentic')).toBeNull();
  });

  it('skips transient and subagent sessions', () => {
    const workspace = createWorkspace();
    const transientSession = createSession({
      sessionId: 'transient',
      isTransient: true,
    });
    const subagentSession = createSession({
      sessionId: 'subagent',
      sessionKind: 'subagent',
    });

    flowChatStore.setState(() => ({
      sessions: new Map([
        [transientSession.sessionId, transientSession],
        [subagentSession.sessionId, subagentSession],
      ]),
      activeSessionId: null,
    }));

    expect(findReusableEmptySessionId(workspace, 'agentic')).toBeNull();
  });

  it('prefers an empty session with matching mode', () => {
    const workspace = createWorkspace();
    const agenticSession = createSession({
      sessionId: 'agentic-empty',
      mode: 'agentic',
      createdAt: 100,
    });
    const coworkSession = createSession({
      sessionId: 'cowork-empty',
      mode: 'Cowork',
      createdAt: 200,
    });

    flowChatStore.setState(() => ({
      sessions: new Map([
        [agenticSession.sessionId, agenticSession],
        [coworkSession.sessionId, coworkSession],
      ]),
      activeSessionId: null,
    }));

    expect(findReusableEmptySessionId(workspace, 'Cowork')).toBe('cowork-empty');
  });

  it('returns null when only an empty session of a different category exists', () => {
    const workspace = createWorkspace();
    const agenticSession = createSession({
      sessionId: 'agentic-empty',
      mode: 'agentic',
      createdAt: 100,
    });

    flowChatStore.setState(() => ({
      sessions: new Map([[agenticSession.sessionId, agenticSession]]),
      activeSessionId: null,
    }));

    expect(findReusableEmptySessionId(workspace, 'Cowork')).toBeNull();
  });

  it('returns null for a code request when only an empty cowork session exists', () => {
    const workspace = createWorkspace();
    const coworkSession = createSession({
      sessionId: 'cowork-empty',
      mode: 'Cowork',
      createdAt: 100,
    });

    flowChatStore.setState(() => ({
      sessions: new Map([[coworkSession.sessionId, coworkSession]]),
      activeSessionId: null,
    }));

    expect(findReusableEmptySessionId(workspace, 'agentic')).toBeNull();
  });

  it('does not reuse the empty code session when creating a cowork session in the same workspace', () => {
    const workspace = createWorkspace();
    const codeEmpty = createSession({
      sessionId: 'code-empty',
      mode: 'agentic',
      createdAt: 100,
    });

    flowChatStore.setState(() => ({
      sessions: new Map([[codeEmpty.sessionId, codeEmpty]]),
      activeSessionId: null,
    }));

    // A cowork session request must NOT reuse the existing empty code session;
    // the caller should be allowed to create a brand-new empty cowork session.
    expect(findReusableEmptySessionId(workspace, 'Cowork')).toBeNull();
  });

  it('normalizes mode strings case-insensitively before matching', () => {
    const workspace = createWorkspace();
    const coworkSession = createSession({
      sessionId: 'cowork-empty',
      mode: 'cowork',
      createdAt: 100,
    });

    flowChatStore.setState(() => ({
      sessions: new Map([[coworkSession.sessionId, coworkSession]]),
      activeSessionId: null,
    }));

    expect(findReusableEmptySessionId(workspace, 'Cowork')).toBe('cowork-empty');
  });

  it('picks the most recently created empty session among mode matches', () => {
    const workspace = createWorkspace();
    const older = createSession({
      sessionId: 'older-empty',
      mode: 'agentic',
      createdAt: 100,
    });
    const newer = createSession({
      sessionId: 'newer-empty',
      mode: 'agentic',
      createdAt: 200,
    });

    flowChatStore.setState(() => ({
      sessions: new Map([
        [older.sessionId, older],
        [newer.sessionId, newer],
      ]),
      activeSessionId: null,
    }));

    expect(findReusableEmptySessionId(workspace, 'agentic')).toBe('newer-empty');
  });

  it('does not reuse sessions with historyState other than new', () => {
    const workspace = createWorkspace();
    const readyEmpty = createSession({
      sessionId: 'ready-empty',
      historyState: 'ready',
      dialogTurns: [],
    });

    flowChatStore.setState(() => ({
      sessions: new Map([[readyEmpty.sessionId, readyEmpty]]),
      activeSessionId: null,
    }));

    expect(findReusableEmptySessionId(workspace, 'agentic')).toBeNull();
  });
});

describe('pickPrimaryAssistantWorkspace', () => {
  const createAssistantWorkspace = (
    id: string,
    assistantId?: string,
  ): WorkspaceInfo => ({
    id,
    name: id,
    rootPath: `/assistants/${id}`,
    workspaceKind: WorkspaceKind.Assistant,
    assistantId,
  });

  it('selects the primary assistant even when a named assistant appears first', () => {
    const namedAssistant = createAssistantWorkspace('named', 'assistant-1');
    const primaryAssistant = createAssistantWorkspace('primary');

    expect(
      pickPrimaryAssistantWorkspace([namedAssistant, primaryAssistant])
    ).toBe(primaryAssistant);
  });

  it('selects the configured primary assistant by workspace id', () => {
    const firstAssistant = createAssistantWorkspace('first', 'assistant-1');
    const configuredPrimary = createAssistantWorkspace('configured', 'assistant-2');

    expect(pickPrimaryAssistantWorkspace([firstAssistant, configuredPrimary], 'configured'))
      .toBe(configuredPrimary);
  });

  it('does not fall back to a named assistant', () => {
    const namedAssistant = createAssistantWorkspace('named', 'assistant-1');

    expect(pickPrimaryAssistantWorkspace([namedAssistant])).toBeNull();
  });
});
