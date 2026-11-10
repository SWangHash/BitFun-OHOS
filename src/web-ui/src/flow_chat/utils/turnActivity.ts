import type { DialogTurn, Session } from '../types/flow-chat';

/**
 * Turn statuses that still owe the reader output.
 *
 * `cancelling` stays here until the turn settles: the runtime is still winding
 * down, so the turn is not final yet. `completed`, `cancelled` and `error` are
 * the terminal set.
 */
const RUNNING_TURN_STATUSES: ReadonlySet<DialogTurn['status']> = new Set<DialogTurn['status']>([
  'pending',
  'image_analyzing',
  'processing',
  'finishing',
  'cancelling',
]);

export function isTurnActivelyRunning(status: DialogTurn['status'] | null | undefined): boolean {
  return status != null && RUNNING_TURN_STATUSES.has(status);
}

/**
 * Start timestamp of the newest turn while it still runs, otherwise null.
 *
 * The turn ledger is the clock that spans the whole turn. The runtime status
 * entry cannot report it: that entry is round-scoped and is cleared as soon as
 * the round shows visible output, which is exactly the long reply a reader
 * wants timed.
 */
export function selectActiveTurnStartTime(session: Session | undefined): number | null {
  const turn = session?.dialogTurns[session.dialogTurns.length - 1];
  if (!turn || !isTurnActivelyRunning(turn.status)) return null;
  const startTime = turn.startTime;
  return typeof startTime === 'number' && Number.isFinite(startTime) ? startTime : null;
}
