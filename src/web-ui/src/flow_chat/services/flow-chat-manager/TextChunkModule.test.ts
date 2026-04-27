import { describe, expect, it } from 'vitest';
import type { AnyFlowItem, DialogTurn, FlowToolItem, ModelRound, Session } from '../../types/flow-chat';
import { processNormalTextChunkInternal } from './TextChunkModule';

function makeContext(session: Session): any {
  return {
    flowChatStore: {
      getState: () => ({
        sessions: new Map([[session.sessionId, session]]),
      }),
      addModelRoundItemSilent: (
        _sessionId: string,
        _turnId: string,
        item: AnyFlowItem,
        roundId: string,
      ) => {
        const round = session.dialogTurns[0].modelRounds.find(candidate => candidate.id === roundId);
        round?.items.push(item);
      },
      updateModelRoundItemSilent: (
        _sessionId: string,
        _turnId: string,
        itemId: string,
        updates: Partial<AnyFlowItem>,
      ) => {
        for (const round of session.dialogTurns[0].modelRounds) {
          const item = round.items.find(candidate => candidate.id === itemId);
          if (item) {
            Object.assign(item, updates);
            return;
          }
        }
      },
      batchUpdateModelRoundItems: () => {},
    },
    contentBuffers: new Map(),
    activeTextItems: new Map(),
    eventBatcher: { getBufferSize: () => 0, clear: () => {} },
    pendingTurnCompletions: new Map(),
    saveDebouncers: new Map(),
    lastSaveTimestamps: new Map(),
    lastSaveHashes: new Map(),
    turnSaveInFlight: new Map(),
    turnSavePending: new Set(),
  };
}

function makeSession(agentType?: string): Session {
  const round: ModelRound = {
    id: 'round-1',
    index: 0,
    items: [],
    isStreaming: true,
    isComplete: false,
    status: 'streaming',
    startTime: 1000,
  };
  const turn: DialogTurn = {
    id: 'turn-1',
    sessionId: 'session-1',
    userMessage: {
      id: 'user-1',
      content: 'Help',
      timestamp: 900,
    },
    modelRounds: [round],
    status: 'processing',
    startTime: 900,
  };
  return {
    sessionId: 'session-1',
    dialogTurns: [turn],
    status: 'active',
    config: { agentType },
    createdAt: 800,
    lastActiveAt: 1000,
    error: null,
    sessionKind: 'normal',
  };
}

function insertTool(session: Session): void {
  const tool: FlowToolItem = {
    id: 'tool-1',
    type: 'tool',
    toolName: 'Read',
    timestamp: 1001,
    status: 'completed',
    toolCall: {
      id: 'tool-1',
      input: { file_path: 'src/main.rs' },
    },
    toolResult: {
      result: 'contents',
      success: true,
    },
  };
  session.dialogTurns[0].modelRounds[0].items.push(tool);
}

describe('processNormalTextChunkInternal', () => {
  it('keeps native sessions on the existing active text item after tools', () => {
    const session = makeSession('bitfun');
    const context = makeContext(session);

    processNormalTextChunkInternal(context, 'session-1', 'turn-1', 'round-1', 'Before tools.');
    insertTool(session);
    processNormalTextChunkInternal(context, 'session-1', 'turn-1', 'round-1', ' After tools.');

    const items = session.dialogTurns[0].modelRounds[0].items;
    const textItems = items.filter(item => item.type === 'text');
    expect(textItems).toHaveLength(1);
    expect((textItems[0] as any).content).toBe('Before tools. After tools.');
  });

  it('starts a new text item for ACP text that streams after tools', () => {
    const session = makeSession('acp:claude-code');
    const context = makeContext(session);

    processNormalTextChunkInternal(context, 'session-1', 'turn-1', 'round-1', 'Before tools.');
    insertTool(session);
    processNormalTextChunkInternal(context, 'session-1', 'turn-1', 'round-1', 'After tools.');

    const items = session.dialogTurns[0].modelRounds[0].items;
    expect(items.map(item => item.type)).toEqual(['text', 'tool', 'text']);
    expect((items[0] as any).content).toBe('Before tools.');
    expect((items[2] as any).content).toBe('After tools.');
  });
});
