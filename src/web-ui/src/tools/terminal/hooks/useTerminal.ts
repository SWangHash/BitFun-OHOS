/**
 * Terminal hook for state and event handling.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getTerminalService, TerminalService } from '../services';
import {
  peekPendingTerminalSpawn,
  registerPendingTerminalSpawn,
  takePendingTerminalSpawn,
} from '../services/pendingTerminalSpawn';
import { getActiveSurfaceScope } from '@/infrastructure/peer-device/deviceSurface';
import { createLogger } from '@/shared/utils/logger';
import type {
  SessionResponse,
  TerminalReplayEvent,
  TerminalEvent,
  TerminalEventCallback,
} from '../types';

const log = createLogger('useTerminal');

export interface UseTerminalOptions {
  sessionId: string;
  autoConnect?: boolean;
  onEvent?: TerminalEventCallback;
  onOutput?: (data: string) => void;
  onReady?: () => void;
  onExit?: (exitCode?: number) => void;
  onError?: (message: string) => void;
  /** Called with ordered replay events before live events are subscribed. */
  onReplay?: (events: TerminalReplayEvent[]) => void;
  /** @deprecated Use onReplay so resize/write ordering is preserved. */
  onHistoryDims?: (cols: number, rows: number) => void;
}

export interface UseTerminalReturn {
  service: TerminalService;
  session: SessionResponse | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  /**
   * The session is reserved but its shell does not exist yet.
   *
   * The panel must stay mounted while this is set — it is the only place that can measure
   * the geometry the shell has to start with — and `spawnPendingSession` creates the PTY
   * once it reports that size.
   */
  isAwaitingSpawn: boolean;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  sendCtrlC: () => Promise<void>;
  close: () => Promise<void>;
  refresh: () => Promise<void>;
  /**
   * Create the PTY for a session that was opened before its panel could measure its own
   * geometry. Safe to call repeatedly: only the first call creates the shell.
   */
  spawnPendingSession: (cols: number, rows: number) => Promise<void>;
}

export function useTerminal(options: UseTerminalOptions): UseTerminalReturn {
  const {
    sessionId,
    autoConnect = true,
    onEvent,
    onOutput,
    onReady,
    onExit,
    onError,
    onReplay,
    onHistoryDims,
  } = options;

  const [session, setSession] = useState<SessionResponse | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAwaitingSpawn, setIsAwaitingSpawn] = useState(
    () => Boolean(peekPendingTerminalSpawn(sessionId)),
  );

  const serviceRef = useRef<TerminalService>(getTerminalService());
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const cancelledRef = useRef(false);
  const spawnPromiseRef = useRef<Promise<void> | null>(null);
  const isAwaitingSpawnRef = useRef(isAwaitingSpawn);
  isAwaitingSpawnRef.current = isAwaitingSpawn;

  // Use refs for callbacks to avoid re-creating handleEvent and re-triggering useEffect
  const onEventRef = useRef(onEvent);
  const onOutputRef = useRef(onOutput);
  const onReadyRef = useRef(onReady);
  const onExitRef = useRef(onExit);
  const onErrorRef = useRef(onError);
  const onReplayRef = useRef(onReplay);
  const onHistoryDimsRef = useRef(onHistoryDims);

  // Keep refs updated
  useEffect(() => {
    onEventRef.current = onEvent;
    onOutputRef.current = onOutput;
    onReadyRef.current = onReady;
    onExitRef.current = onExit;
    onErrorRef.current = onError;
    onReplayRef.current = onReplay;
    onHistoryDimsRef.current = onHistoryDims;
  });

  useEffect(() => {
    // A panel can be reused for another session; keep the reserved state in step with it.
    setIsAwaitingSpawn(Boolean(peekPendingTerminalSpawn(sessionId)));
  }, [sessionId]);

  // Stable event handler that uses refs
  const handleEvent = useCallback((event: TerminalEvent) => {
    if (event.sessionId !== sessionId) return;

    onEventRef.current?.(event);

    switch (event.type) {
      case 'output':
        onOutputRef.current?.((event as any).data);
        break;
      case 'ready':
        onReadyRef.current?.();
        break;
      case 'exit':
        onExitRef.current?.((event as any).exitCode);
        break;
      case 'error':
        onErrorRef.current?.((event as any).message);
        setError((event as any).message);
        break;
      case 'resize':
        // Backend resize confirmation requires no extra UI work.
        break;
    }
  }, [sessionId]); // Only depend on sessionId, not the callbacks

  /** Attach to a session that already exists on the host. */
  const attachToSession = useCallback(async () => {
    const service = serviceRef.current;

    // Get session info
    const sessionInfo = await service.getSession(sessionId);
    if (cancelledRef.current) return;

    setSession(sessionInfo);

    // Replay output history BEFORE subscribing to live events.
    // This prevents overlap: history covers [past → now], events cover [now → future].
    // If we subscribed first, events arriving between subscribe and getHistory would
    // appear in both the event stream and the history buffer, causing duplicate output.
    try {
      const historyResponse = await service.getHistory(sessionId);
      if (!cancelledRef.current) {
        const replayEvents = historyResponse.events?.length
          ? historyResponse.events
          : historyResponse.data
            ? [{
                cols: historyResponse.cols,
                rows: historyResponse.rows,
                data: historyResponse.data,
              }]
            : [];

        if (replayEvents.length > 0) {
          if (onReplayRef.current) {
            onReplayRef.current(replayEvents);
          } else {
            replayEvents.forEach((event) => {
              onHistoryDimsRef.current?.(event.cols, event.rows);
              if (event.data) {
                onOutputRef.current?.(event.data);
              }
            });
          }
        }
      }
    } catch (histErr) {
      // History replay is optional — a failed fetch must not break the terminal.
      log.warn('Failed to fetch terminal history', { sessionId, error: histErr });
    }

    if (cancelledRef.current) return;

    // Subscribe to live events AFTER history replay to eliminate overlap.
    const unsubscribe = service.onSessionEvent(sessionId, handleEvent);
    if (cancelledRef.current) {
      unsubscribe();
      return;
    }
    unsubscribeRef.current = unsubscribe;

    setIsAwaitingSpawn(false);
    setIsLoading(false);
  }, [sessionId, handleEvent]);

  useEffect(() => {
    const service = serviceRef.current;
    cancelledRef.current = false;

    const connect = async () => {
      try {
        setIsLoading(true);
        setError(null);

        if (autoConnect && !service.isConnected()) {
          await service.connect();
        }

        if (cancelledRef.current) return;

        setIsConnected(service.isConnected());

        // A manual terminal opens before its shell exists: its panel has to measure its
        // own geometry first, and `spawnPendingSession` creates the PTY with that size.
        // Resolving the session here would fail and start the shell at a guessed size.
        if (isAwaitingSpawnRef.current) return;

        await attachToSession();
      } catch (err) {
        if (cancelledRef.current) return;
        const message = err instanceof Error ? err.message : 'Connection failed';
        setError(message);
        setIsLoading(false);
        log.error('Failed to connect', { sessionId, error: err });
      }
    };

    connect();

    return () => {
      cancelledRef.current = true;
      // Clean up the subscription
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [sessionId, autoConnect, handleEvent, attachToSession]);

  const spawnPendingSession = useCallback(async (cols: number, rows: number): Promise<void> => {
    if (spawnPromiseRef.current) return spawnPromiseRef.current;

    const spawn = takePendingTerminalSpawn(sessionId);
    if (!spawn) {
      // Nothing left to create: either this session is already attachable, or its
      // reservation expired. Attaching makes the second case fail loudly instead of
      // leaving the panel waiting for a shell that nothing will create any more.
      if (isAwaitingSpawnRef.current) {
        try {
          await attachToSession();
        } catch (err) {
          if (!cancelledRef.current) {
            setError(err instanceof Error ? err.message : 'Terminal session was not created');
            setIsLoading(false);
            log.error('Terminal reservation expired before the shell was created', { sessionId, error: err });
          }
        }
      }
      return;
    }

    const task = (async () => {
      try {
        setIsLoading(true);
        setError(null);

        // A shell must be created on the device that owns this panel. A surface switch
        // while the panel was being measured must degrade instead of spawning elsewhere.
        if (spawn.surfaceId !== getActiveSurfaceScope().surfaceId) {
          throw new Error('Terminal device surface changed before the shell was created');
        }

        const service = serviceRef.current;
        if (autoConnect && !service.isConnected()) {
          await service.connect();
        }

        await service.createSession({ ...spawn.request, sessionId, cols, rows });
        if (cancelledRef.current) return;

        setIsConnected(service.isConnected());
        await attachToSession();
      } catch (err) {
        // Let a retry claim the same intent instead of leaving the tab without a shell.
        // `isAwaitingSpawn` stays set for the same reason: the shell still does not exist.
        if (!cancelledRef.current) {
          registerPendingTerminalSpawn(sessionId, spawn);
          const message = err instanceof Error ? err.message : 'Terminal creation failed';
          setError(message);
          setIsLoading(false);
          log.error('Failed to create terminal session', { sessionId, cols, rows, error: err });
        }
        spawnPromiseRef.current = null;
      }
    })();

    spawnPromiseRef.current = task;
    return task;
  }, [attachToSession, autoConnect, sessionId]);

  const write = useCallback(async (data: string) => {
    try {
      await serviceRef.current.write(sessionId, data);
    } catch (err) {
      log.error('Failed to write', { sessionId, error: err });
      throw err;
    }
  }, [sessionId]);

  const resize = useCallback(async (cols: number, rows: number) => {
    try {
      await serviceRef.current.resize(sessionId, cols, rows);
    } catch (err) {
      log.error('Failed to resize', { sessionId, cols, rows, error: err });
      throw err;
    }
  }, [sessionId]);

  const sendCtrlC = useCallback(async () => {
    try {
      await serviceRef.current.sendCtrlC(sessionId);
    } catch (err) {
      log.error('Failed to send Ctrl+C', { sessionId, error: err });
      throw err;
    }
  }, [sessionId]);

  const close = useCallback(async () => {
    try {
      await serviceRef.current.closeSession(sessionId);
      setSession(null);
    } catch (err) {
      log.error('Failed to close', { sessionId, error: err });
      throw err;
    }
  }, [sessionId]);

  const refresh = useCallback(async () => {
    try {
      const sessionInfo = await serviceRef.current.getSession(sessionId);
      setSession(sessionInfo);
    } catch (err) {
      log.error('Failed to refresh session', { sessionId, error: err });
      throw err;
    }
  }, [sessionId]);

  return {
    service: serviceRef.current,
    session,
    isConnected,
    isLoading,
    error,
    isAwaitingSpawn,
    write,
    resize,
    sendCtrlC,
    close,
    refresh,
    spawnPendingSession,
  };
}
