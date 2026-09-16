import { expect, it, vi } from 'vitest';
import { SessionStateMachineImpl } from './SessionStateMachine';
import { ProcessingPhase, SessionExecutionState } from './types';

it('adopts runtime completion and approvals without replaying controller actions', () => {
  const machine = new SessionStateMachineImpl('session');
  const listener = vi.fn();
  machine.subscribe(listener);
  const waiting = { state: SessionExecutionState.PROCESSING, turnId: 'turn', roundId: 'round',
    phase: ProcessingPhase.TOOL_CONFIRMING, pendingTools: ['tool'], error: null };
  machine.acceptRuntimeStatus(waiting);
  expect(machine.getContext().pendingToolConfirmations.has('tool')).toBe(true);
  const calls = listener.mock.calls.length;
  machine.acceptRuntimeStatus(waiting);
  expect(listener).toHaveBeenCalledTimes(calls);
  machine.acceptRuntimeStatus({ ...waiting, state: SessionExecutionState.IDLE, phase: null, pendingTools: [] });
  expect(machine.getCurrentState()).toBe(SessionExecutionState.IDLE);
  expect(machine.getContext().pendingToolConfirmations.size).toBe(0);
  expect(machine.getSnapshot().transitionHistory).toHaveLength(0);
});
