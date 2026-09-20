import {
  getActiveSurfaceScope,
  type SurfaceScope,
} from '@/infrastructure/peer-device/deviceSurface';

export const SUBMITTED_MESSAGE_PRESENTATION_MS = 300;
const STATUS_REVEAL_AFTER_MS = 160;

export interface SubmittedMessageArrival {
  readonly startedAt: number;
  readonly scope: SurfaceScope;
}

interface PendingArrival extends SubmittedMessageArrival {
  messageId: string;
  claimed: boolean;
}

// Presentation receipts only: never persisted or inferred from transcript growth.
// The short lifetime also prevents an offscreen send from animating on a later visit.
const arrivals = new Map<string, PendingArrival>();

function arrivalKey(scope: SurfaceScope, sessionId: string, turnId: string): string {
  return scope.key('submitted-message', scope.epoch, sessionId, turnId);
}

export function registerSubmittedMessage(
  scope: SurfaceScope,
  sessionId: string,
  turnId: string,
  messageId: string,
): void {
  if (!scope.isCurrent()) return;
  const key = arrivalKey(scope, sessionId, turnId);
  if (arrivals.has(key)) return;

  const arrival: PendingArrival = { startedAt: performance.now(), scope, messageId, claimed: false };
  arrivals.set(key, arrival);
  const timer = setTimeout(dispose, SUBMITTED_MESSAGE_PRESENTATION_MS);
  function dispose() {
    if (arrivals.get(key) === arrival) arrivals.delete(key);
    clearTimeout(timer);
    scope.signal.removeEventListener('abort', dispose);
  }
  scope.signal.addEventListener('abort', dispose, { once: true });
}

function getArrival(sessionId: string, turnId: string): PendingArrival | undefined {
  const scope = getActiveSurfaceScope();
  const arrival = arrivals.get(arrivalKey(scope, sessionId, turnId));
  return arrival && performance.now() - arrival.startedAt < SUBMITTED_MESSAGE_PRESENTATION_MS
    ? arrival
    : undefined;
}

/** One renderer can claim the send; virtualized remounts and replay get nothing. */
export function consumeSubmittedMessageArrival(
  sessionId: string,
  turnId: string,
  messageId: string,
): SubmittedMessageArrival | undefined {
  const arrival = getArrival(sessionId, turnId);
  if (!arrival || arrival.claimed || arrival.messageId !== messageId) return undefined;
  arrival.claimed = true;
  return arrival;
}

/** Only the initial send can defer paint; runtime status and output remain immediate. */
export function submittedMessageStatusDelay(sessionId: string, turnId: string): number {
  const arrival = getArrival(sessionId, turnId);
  return arrival ? Math.max(0, STATUS_REVEAL_AFTER_MS - (performance.now() - arrival.startedAt)) : 0;
}
