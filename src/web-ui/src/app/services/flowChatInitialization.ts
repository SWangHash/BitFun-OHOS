import {
  getActiveSurfaceScope,
  isSurfaceChangedError,
  type SurfaceScope,
} from '@/infrastructure/peer-device/deviceSurface';

interface FlowChatInitialization {
  initialize: () => Promise<boolean>;
  onInitialized: (hasHistoricalSessions: boolean, isCurrent: () => boolean) => Promise<void>;
  onError: (error: unknown, retryDelayMs: number | null) => void;
}

/** Retry history/subscription recovery, without replaying session creation or sends. */
export function startFlowChatInitialization(
  callbacks: FlowChatInitialization,
  scope: SurfaceScope = getActiveSurfaceScope(),
): () => void {
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelayMs = 1000;
  const isCurrent = () => !stopped && scope.isCurrent();
  const stop = () => {
    stopped = true;
    clearTimeout(retryTimer);
    scope.signal.removeEventListener('abort', stop);
  };

  const attempt = async () => {
    if (!isCurrent()) return;
    let hasHistoricalSessions: boolean;
    try {
      hasHistoricalSessions = await callbacks.initialize();
    } catch (error) {
      if (!isCurrent() || isSurfaceChangedError(error)) return;
      callbacks.onError(error, retryDelayMs);
      retryTimer = setTimeout(() => { void attempt(); }, retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
      return;
    }

    if (!isCurrent()) return;
    try {
      await callbacks.onInitialized(hasHistoricalSessions, isCurrent);
    } catch (error) {
      if (isCurrent() && !isSurfaceChangedError(error)) {
        // A write may have succeeded before its acknowledgement failed.
        // Keep that failure visible; only initialization reads are replayable.
        callbacks.onError(error, null);
      }
    }
  };

  scope.signal.addEventListener('abort', stop, { once: true });
  void attempt();
  return stop;
}
