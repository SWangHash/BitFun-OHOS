import { describe, expect, it } from 'vitest';
import type { DialogTurn, Session } from '../types/flow-chat';
import { isTurnActivelyRunning, selectActiveTurnStartTime } from './turnActivity';

const turn = (status: DialogTurn['status'], startTime = 1_000): DialogTurn => ({
  id: 'turn-1',
  sessionId: 'session-1',
  userMessage: { id: 'user-1', content: 'hello', timestamp: 900 },
  modelRounds: [],
  status,
  startTime,
} as DialogTurn);

const session = (dialogTurns: DialogTurn[]): Session => ({
  sessionId: 'session-1',
  dialogTurns,
} as unknown as Session);

describe('isTurnActivelyRunning', () => {
  it.each(['pending', 'image_analyzing', 'processing', 'finishing', 'cancelling'] as const)(
    'keeps %s running until it settles',
    (status) => expect(isTurnActivelyRunning(status)).toBe(true),
  );

  it.each(['completed', 'cancelled', 'error'] as const)(
    'treats %s as terminal',
    (status) => expect(isTurnActivelyRunning(status)).toBe(false),
  );

  it('treats a missing latch as settled', () => {
    expect(isTurnActivelyRunning(null)).toBe(false);
    expect(isTurnActivelyRunning(undefined)).toBe(false);
  });
});

describe('selectActiveTurnStartTime', () => {
  it('reports the start of the newest turn while it runs', () => {
    expect(selectActiveTurnStartTime(session([turn('completed', 500), turn('processing', 1_000)])))
      .toBe(1_000);
  });

  it('stops reporting as soon as the newest turn settles', () => {
    expect(selectActiveTurnStartTime(session([turn('processing', 1_000), turn('cancelled', 2_000)])))
      .toBeNull();
    expect(selectActiveTurnStartTime(session([turn('processing', 1_000), turn('error', 2_000)])))
      .toBeNull();
  });

  it('never reports a settled turn that still sits earlier in the ledger', () => {
    expect(selectActiveTurnStartTime(session([turn('processing', 1_000), turn('completed', 2_000)])))
      .toBeNull();
  });

  it('ignores a missing session, an empty ledger and an unusable start', () => {
    expect(selectActiveTurnStartTime(undefined)).toBeNull();
    expect(selectActiveTurnStartTime(session([]))).toBeNull();
    expect(selectActiveTurnStartTime(session([turn('processing', Number.NaN)]))).toBeNull();
  });
});
