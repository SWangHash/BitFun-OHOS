import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionMetadata } from '@/shared/types/session-history';

const apiMocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  listSessionsPage: vi.fn(),
  loadSessionTurns: vi.fn(),
  restoreSession: vi.fn(),
  restoreSessionView: vi.fn(),
  restoreSessionWithTurns: vi.fn(),
}));
const workspaces = vi.hoisted(() => new Map([
  ['workspace-initial', { id: 'workspace-initial', rootPath: '/workspace/initial', workspaceKind: 'local' }],
  ['workspace-page', { id: 'workspace-page', rootPath: '/workspace/page', workspaceKind: 'local' }],
]));

vi.mock('@/infrastructure/api', () => ({
  sessionAPI: apiMocks,
  agentAPI: apiMocks,
}));
vi.mock('@/infrastructure/api/service-api/SessionAPI', () => ({ sessionAPI: apiMocks }));
vi.mock('@/infrastructure/api/service-api/AgentAPI', () => ({ agentAPI: apiMocks }));
vi.mock('@/infrastructure/services/business/workspaceManager', () => ({
  workspaceManager: {
    getState: () => ({ openedWorkspaces: workspaces, recentWorkspaces: [] }),
  },
}));
vi.mock('@/infrastructure/config/services/ConfigManager', () => ({
  configManager: { getConfigs: vi.fn(async () => ({ 'ai.models': [], 'ai.default_models': {} })) },
}));

import { flowChatStore } from './FlowChatStore';

describe('FlowChatStore persisted ACP identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    flowChatStore.setState(() => ({ sessions: new Map(), activeSessionId: null }));
  });

  afterEach(() => {
    flowChatStore.setState(() => ({ sessions: new Map(), activeSessionId: null }));
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it.each(['initial', 'page'] as const)(
    'restores ACP bindings through the %s metadata entry and reads their history without native restore',
    async source => {
      const workspaceId = `workspace-${source}`;
      const metadata: SessionMetadata[] = [
        {
          sessionId: 'acp-current',
          sessionName: 'Current ACP',
          agentType: 'acp:opencode',
          customMetadata: { provider: 'acp', acpClientId: 'opencode', acpRemoteSessionId: 'remote-current' },
          modelName: 'primary',
          createdAt: 1,
          lastActiveAt: 2,
          turnCount: 1,
          messageCount: 1,
          toolCallCount: 0,
          status: 'active',
          tags: [],
          workspaceId,
          projectWorkspaceId: workspaceId,
        },
        {
          sessionId: 'acp-degraded',
          sessionName: 'Degraded ACP',
          agentType: 'Standard',
          customMetadata: { provider: 'acp', acpClientId: 'codex', acpRemoteSessionId: 'remote-saved' },
          modelName: 'primary',
          createdAt: 1,
          lastActiveAt: 2,
          turnCount: 1,
          messageCount: 1,
          toolCallCount: 0,
          status: 'active',
          tags: [],
          workspaceId,
          projectWorkspaceId: workspaceId,
        },
        {
          sessionId: 'native',
          sessionName: 'Native',
          agentType: 'Standard',
          modelName: 'primary',
          createdAt: 1,
          lastActiveAt: 2,
          turnCount: 0,
          messageCount: 0,
          toolCallCount: 0,
          status: 'active',
          tags: [],
          workspaceId,
          projectWorkspaceId: workspaceId,
        },
      ];
      const persisted: SessionMetadata[] = JSON.parse(JSON.stringify(metadata));
      if (source === 'initial') {
        apiMocks.listSessions.mockResolvedValueOnce(persisted);
        await flowChatStore.initializeFromDisk(workspaceId);
      } else {
        apiMocks.listSessionsPage.mockResolvedValueOnce({
          sessions: persisted,
          totalTopLevelCount: 3,
          loadedTopLevelCount: 3,
          hasMore: false,
        });
        await flowChatStore.loadSessionMetadataPage(workspaceId, 5);
      }

      for (const [sessionId, agentType] of [
        ['acp-current', 'acp:opencode'],
        ['acp-degraded', 'acp:codex'],
        ['native', 'Standard'],
      ]) {
        expect(flowChatStore.getState().sessions.get(sessionId)).toMatchObject({
          mode: agentType,
          config: { agentType },
        });
      }

      apiMocks.loadSessionTurns.mockResolvedValueOnce([{
        turnId: 'turn-0',
        turnIndex: 0,
        sessionId: 'acp-degraded',
        userMessage: { id: 'user-0', content: 'Saved prompt', timestamp: 1 },
        modelRounds: [],
        startTime: 1,
        endTime: 2,
        status: 'completed',
      }]);
      await flowChatStore.loadSessionHistory('acp-degraded');

      expect(apiMocks.restoreSession).not.toHaveBeenCalled();
      expect(apiMocks.restoreSessionView).not.toHaveBeenCalled();
      expect(apiMocks.restoreSessionWithTurns).not.toHaveBeenCalled();
      expect(flowChatStore.getState().sessions.get('acp-degraded')).toMatchObject({
        mode: 'acp:codex',
        config: { agentType: 'acp:codex' },
        historyState: 'ready',
        dialogTurns: [{ userMessage: { content: 'Saved prompt' } }],
      });
      expect(persisted).toEqual(metadata);
    },
  );
});
