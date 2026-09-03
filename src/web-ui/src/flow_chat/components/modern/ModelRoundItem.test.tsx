// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { FlowToolItem, ModelRound } from '../../types/flow-chat';

import { areModelRoundItemPropsEqual } from './modelRoundItemMemo';

function makeQuestionTool(questionRequest?: unknown): FlowToolItem {
  return {
    id: 'question-tool',
    type: 'tool',
    toolName: 'AskUserQuestion',
    timestamp: 1,
    status: 'pending_confirmation',
    toolCall: {
      id: 'question-tool',
      input: { templateId: 'qt-migration-paths' },
    },
    ...(questionRequest === undefined ? {} : { questionRequest }),
  };
}

function makeRound(tool: FlowToolItem, overrides: Partial<ModelRound> = {}): ModelRound {
  return {
    id: 'question-round',
    index: 0,
    items: [tool],
    isStreaming: false,
    isComplete: false,
    status: 'pending_confirmation',
    startTime: 1,
    ...overrides,
  };
}

function makeProps(round: ModelRound) {
  return {
    round,
    turnId: 'turn-1',
    isLastRound: true,
    isTurnComplete: false,
  };
}

describe('ModelRoundItem memo contract', () => {
  it('re-renders an active confirmation round when questionRequest changes', () => {
    const previousRound = makeRound(makeQuestionTool());
    const nextRound = makeRound(makeQuestionTool({
      templateId: 'qt-migration-paths',
      templateVersion: '1',
      resolvedQuestions: [{ field: 'source_project' }],
    }));

    expect(areModelRoundItemPropsEqual(makeProps(previousRound), makeProps(nextRound))).toBe(false);
  });

  it('skips an unchanged non-streaming active round', () => {
    const round = makeRound(makeQuestionTool());

    expect(areModelRoundItemPropsEqual(makeProps(round), makeProps(round))).toBe(true);
  });

  it('always re-renders streaming rounds', () => {
    const round = makeRound(makeQuestionTool(), {
      isStreaming: true,
      status: 'streaming',
    });

    expect(areModelRoundItemPropsEqual(makeProps(round), makeProps(round))).toBe(false);
  });

  it('skips an unchanged terminal round', () => {
    const round = makeRound(makeQuestionTool(), {
      isComplete: true,
      status: 'completed',
    });

    expect(areModelRoundItemPropsEqual(
      { ...makeProps(round), isTurnComplete: true },
      { ...makeProps(round), isTurnComplete: true },
    )).toBe(true);
  });
});
