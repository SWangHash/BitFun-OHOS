/**
 * Connected terminal component that streams a backend session.
 * Optimizations: debounced resize, post-resize refresh, visibility-aware sync.
 */

import React, { useEffect, useRef, useCallback, useState, memo } from 'react';
import { Button, Icon, IconButton } from '@bitfun/ui';
import { useI18n } from '@/infrastructure/i18n';
import { AlertCircle } from 'lucide-react';
import Terminal, { TerminalRef, type TerminalOptions } from './Terminal';
import { useTerminal } from '../hooks/useTerminal';
import { peekPendingTerminalSpawn } from '../services/pendingTerminalSpawn';
import { registerTerminalActions, unregisterTerminalActions } from '../services/TerminalActionManager';
import {
  POWERSHELL_READLINE_PASTE_SEQUENCE,
  ReplayColumnGuard,
  ResizeRepaintGuard,
  TerminalInputQueue,
  createResizeRepaintScreenSnapshot,
  resolveTerminalPaste,
  shouldUsePowerShellReadlinePaste,
  terminalReplayHasScreenText,
} from '../utils';
import { createLogger } from '@/shared/utils/logger';
import type { SessionResponse, TerminalReplayEvent } from '../types';
import type { TerminalPasteDecision } from '../utils';
import './Terminal.scss';

const log = createLogger('ConnectedTerminal');

/**
 * Matches a standalone absolute cursor position command: ESC [ R ; C H
 * ConPTY sends these after resize to reposition the cursor in its own coordinate
 * system, which diverges from xterm.js coordinates after history replay.
 */
// eslint-disable-next-line no-control-regex -- ESC-based cursor reposition sequences are part of terminal protocol parsing.
const CURSOR_POS_RE = /^\x1b\[(\d+);(\d+)H$/;

/** Upper bound on waiting for the terminal typeface set before creating the shell. */
const TERMINAL_TYPEFACE_WAIT_TIMEOUT_MS = 2_000;

/**
 * Resolve once the terminal font set has loaded.
 *
 * A session whose shell has not started yet must be created at the geometry the terminal
 * will keep. xterm measures its cell size when the terminal opens and re-measures after
 * the font set loads, so a shell created before that would be resized right after its
 * first prompt had been laid out — the rows left behind stay in the buffer.
 */
function waitForTerminalFonts(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) {
    return Promise.resolve();
  }

  const fontSet = document.fonts as FontFaceSet;
  if (fontSet.status === 'loaded') {
    return Promise.resolve();
  }

  // A font that never resolves must not keep the terminal without a shell.
  return Promise.race([
    fontSet.ready.then(() => undefined),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, TERMINAL_TYPEFACE_WAIT_TIMEOUT_MS);
    }),
  ]);
}

type QueuedTerminalItem =
  | { type: 'write'; data: string; source: 'live' | 'replay' }
  // Replay resize entries may be pure geometry snapshots. Only protect column
  // width when the same replay batch contains visible screen text.
  | { type: 'replayResize'; cols: number; rows: number; protectScreenText: boolean }
  | { type: 'replayComplete' };

export interface ConnectedTerminalProps {
  sessionId: string;
  className?: string;
  autoFocus?: boolean;
  showToolbar?: boolean;
  showStatusBar?: boolean;
  /** Optional xterm options (e.g. smaller font in embedded dialogs). */
  options?: TerminalOptions;
  /** Optional session data; fetched when omitted. */
  session?: SessionResponse;
  onClose?: () => void;
  /** Closing a resource view must not terminate the host-owned PTY. */
  closeBehavior?: 'detach' | 'terminate';
  onTitleChange?: (title: string) => void;
  onExit?: (exitCode?: number) => void;
  resizeSuspended?: boolean;
  supportsCopyPaste?: boolean;
}

const ConnectedTerminal: React.FC<ConnectedTerminalProps> = memo(({
  sessionId,
  className = '',
  autoFocus = true,
  showToolbar = false,
  showStatusBar = false,
  options,
  session: initialSession,
  onClose,
  closeBehavior = 'terminate',
  onTitleChange,
  onExit,
  resizeSuspended = false,
  supportsCopyPaste = true,
}) => {
  const { t } = useI18n('panels/terminal');
  const terminalRef = useRef<TerminalRef>(null);
  const [title, setTitle] = useState<string>(initialSession?.name || 'Terminal');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [isExited, setIsExited] = useState(false);

  const lastSentSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const resizeRepaintGuardRef = useRef(new ResizeRepaintGuard());
  // A reserved session creates its shell once, from the first measured panel size.
  const spawnStartedRef = useRef(false);
  const lastMeasuredSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  // Buffer output until the terminal is ready.
  // Use a ref (not state) to avoid stale closure issues with isTerminalReady.
  const isTerminalReadyRef = useRef(false);
  const outputQueueRef = useRef<QueuedTerminalItem[]>([]);

  // After history replay, ConPTY sends absolute cursor-position commands (ESC[R;CH)
  // that reference its own coordinate system, which diverges from xterm.js after replay.
  // We let those commands pass through (to avoid side effects from redirecting them) and
  // instead restore the correct cursor position via write callbacks after each one.
  const postHistoryCursorRef = useRef<{ row: number; col: number; ignoreCount: number } | null>(null);

  // While armed, Terminal's doXtermResize refuses to shrink the column count
  // below the width it protects. Armed during history replay so that the CSS
  // open-animation (which drives the terminal through many narrow intermediate
  // widths) cannot permanently truncate content written at the historical width.
  // It also has to end on its own: an idle shell produces no live output to clear
  // it, which used to leave the terminal pinned to the previous dock's width.
  const replayColumnGuardRef = useRef(new ReplayColumnGuard());

  const queueWrite = useCallback((data: string, source: 'live' | 'replay' = 'live') => {
    outputQueueRef.current.push({ type: 'write', data, source });
  }, []);

  const setReplayColumnGuard = useCallback((cols: number) => {
    replayColumnGuardRef.current.arm(cols);
  }, []);

  const clearReplayColumnGuard = useCallback(() => {
    replayColumnGuardRef.current.clear();
  }, []);

  const applyReplayResize = useCallback((cols: number, rows: number, protectScreenText: boolean) => {
    const xterm = terminalRef.current?.getTerminal?.();
    if (!xterm) return;

    if (protectScreenText) {
      setReplayColumnGuard(cols);
    }
    try {
      if (xterm.cols !== cols || xterm.rows !== rows) {
        xterm.resize(cols, rows);
      }
    } catch (error) {
      log.warn('Replay resize failed', { sessionId, cols, rows, error });
    }
  }, [sessionId, setReplayColumnGuard]);

  const capturePostReplayCursor = useCallback(() => {
    const xterm = terminalRef.current?.getTerminal?.();
    if (!xterm) return;

    xterm.write('', () => {
      const cursorY = xterm.buffer.active.cursorY; // 0-indexed
      const cursorRow = cursorY + 1; // 1-indexed for ANSI
      if (cursorRow > 0) {
        const cursorCol = xterm.buffer.active.cursorX + 1; // 1-indexed
        postHistoryCursorRef.current = { row: cursorRow, col: cursorCol, ignoreCount: 10 };
      }
    });
  }, []);

  const handleOutput = useCallback((data: string) => {
    const repaintDecision = resizeRepaintGuardRef.current.inspect(data);
    if (repaintDecision.suppress) {
      return;
    }

    // Post-history cursor restoration:
    // ConPTY sends standalone cursor-position commands after resize in its own coordinate
    // system. We let them pass through unmodified (redirecting them caused content side
    // effects) and instead snap the cursor back to the saved correct position via a
    // write callback after each one is processed by xterm.js.
    if (postHistoryCursorRef.current && postHistoryCursorRef.current.ignoreCount > 0) {
      const isCursorOnly = CURSOR_POS_RE.test(data);
      if (isCursorOnly) {
        const cursor = postHistoryCursorRef.current;
        cursor.ignoreCount--;
        const restoreSeq = `\x1b[${cursor.row};${cursor.col}H`;
        if (!isTerminalReadyRef.current || !terminalRef.current) {
          queueWrite(data);
          queueWrite(restoreSeq);
          return;
        }
        const xterm = terminalRef.current.getTerminal?.();
        if (xterm) {
          // Write the original cursor move, then immediately queue the restore so
          // the visible cursor always lands at the correct history-end position.
          xterm.write(data, () => {
            xterm.write(restoreSeq);
          });
        } else {
          terminalRef.current.write(data);
          terminalRef.current.write(restoreSeq);
        }
        return;
      } else {
        // Real content arrived — cursor is already at correct position from last restore.
        postHistoryCursorRef.current = null;
        clearReplayColumnGuard();
      }
    }

    if (!isTerminalReadyRef.current || !terminalRef.current) {
      queueWrite(data);
      return;
    }
    terminalRef.current.write(data);
  }, [queueWrite, clearReplayColumnGuard]); // No state deps - reads from refs which are always current

  const flushOutputQueue = useCallback(() => {
    const queue = outputQueueRef.current;
    if (queue.length === 0) return;
    // Clear first to prevent orphaned items if new data arrives during flush
    outputQueueRef.current = [];

    queue.forEach((item, index) => {
      switch (item.type) {
        case 'replayResize':
          applyReplayResize(item.cols, item.rows, item.protectScreenText);
          break;
        case 'write':
          if (item.source === 'live') {
            postHistoryCursorRef.current = null;
            clearReplayColumnGuard();
          }
          terminalRef.current?.write(item.data);
          break;
        case 'replayComplete':
          // Cursor restoration is only meaningful after visible replay content.
          // Pure metadata replay should not enter post-history mode because the
          // next live shell startup output owns the real cursor position.
          if (queue.slice(index + 1).some(next => next.type === 'write' && next.source === 'live')) {
            clearReplayColumnGuard();
          } else {
            capturePostReplayCursor();
          }
          break;
      }
    });
  }, [applyReplayResize, capturePostReplayCursor, clearReplayColumnGuard]);

  const handleReady = useCallback(() => {
    // Backend ready event - terminal UI is already ready via handleTerminalReady
    // No need to flush queue again here
  }, []);

  const handleExit = useCallback((code?: number) => {
    setExitCode(code ?? null);
    setIsExited(true);
    onExit?.(code);
  }, [onExit]);

  const handleError = useCallback((message: string) => {
    log.error('Terminal error', { sessionId, message });
  }, [sessionId]);

  const handleReplay = useCallback((events: TerminalReplayEvent[]) => {
    if (events.length === 0) return;

    resizeRepaintGuardRef.current.clear();

    // A new session can replay only resize/OSC metadata. Treating that as
    // protected history would lock the initial 80-column xterm size and let the
    // backend resize first, which produced blank scrollback on right terminals.
    const hasReplayScreenText = terminalReplayHasScreenText(events);
    const maxReplayCols = hasReplayScreenText
      ? events.reduce((max, event) => Math.max(max, event.cols), 0)
      : 0;
    if (maxReplayCols > 0) {
      setReplayColumnGuard(maxReplayCols);
    }

    events.forEach((event) => {
      outputQueueRef.current.push({
        type: 'replayResize',
        cols: event.cols,
        rows: event.rows,
        protectScreenText: hasReplayScreenText,
      });
      if (event.data) {
        queueWrite(event.data, 'replay');
      }
    });
    if (hasReplayScreenText) {
      outputQueueRef.current.push({ type: 'replayComplete' });
    }

    if (isTerminalReadyRef.current && terminalRef.current) {
      terminalRef.current.flushResize();
      flushOutputQueue();
    }
  }, [flushOutputQueue, queueWrite, setReplayColumnGuard]);

  const {
    session,
    isLoading,
    error,
    isAwaitingSpawn,
    write,
    resize,
    sendCtrlC,
    close,
    refresh,
    spawnPendingSession,
  } = useTerminal({
    sessionId,
    autoConnect: true,
    onOutput: handleOutput,
    onReady: handleReady,
    onExit: handleExit,
    onError: handleError,
    onReplay: handleReplay,
  });

  // Keep latest write in a ref so the input queue closure stays stable without
  // recreating the queue on every render.
  const writeRef = useRef(write);
  writeRef.current = write;

  // Coalesce rapid keystrokes into batched, sequentially-ordered IPC writes.
  // Without this, each keystroke fires a separate fire-and-forget
  // `invoke('terminal_write')`, which on macOS can lose characters due to IPC
  // latency and lack of ordering guarantees for concurrent async command
  // handlers. The queue buffers input and flushes it as a single batched write,
  // with only one flush in flight at a time.
  const inputQueueRef = useRef<TerminalInputQueue | null>(null);
  if (!inputQueueRef.current) {
    inputQueueRef.current = new TerminalInputQueue(
      (data) => writeRef.current(data),
      (err) => log.error('Write failed', { sessionId, error: err }),
    );
  }

  const handleData = useCallback((data: string) => {
    if (!isExited) {
      resizeRepaintGuardRef.current.clear();
      inputQueueRef.current?.enqueue(data);
    }
  }, [isExited]);

  const handleResize = useCallback((cols: number, rows: number) => {
    // A reserved session has no shell yet: `spawnPendingSession` creates its PTY *with*
    // this geometry, so the resize must not be sent before the session exists.
    if (peekPendingTerminalSpawn(sessionId)) return;

    const lastSize = lastSentSizeRef.current;
    if (lastSize && lastSize.cols === cols && lastSize.rows === rows) {
      return;
    }

    const xterm = terminalRef.current?.getTerminal?.() ?? null;
    const screen = createResizeRepaintScreenSnapshot(xterm);
    if (screen) {
      resizeRepaintGuardRef.current.markResize({
        cols,
        rows,
        previousCols: lastSize?.cols,
        previousRows: lastSize?.rows,
        shellType: session?.shellType ?? initialSession?.shellType,
        screen,
      });
    }

    lastSentSizeRef.current = { cols, rows };

    // If post-history cursor mode is active, update the saved cursor position
    // ONLY when the terminal is growing (wider cols). Shrinking resizes may place
    // the cursor at a damaged/truncated position, so we ignore those updates.
    // Growing resizes simply add columns on the right; the cursor row/col stays valid.
    if (postHistoryCursorRef.current) {
      const xterm = terminalRef.current?.getTerminal?.();
      if (xterm && cols >= xterm.cols) {
        postHistoryCursorRef.current.row = xterm.buffer.active.cursorY + 1;
        postHistoryCursorRef.current.col = xterm.buffer.active.cursorX + 1;
      }
    }

    resize(cols, rows).then(() => {
    }).catch(err => {
      log.error('Resize failed', { sessionId, cols, rows, error: err });
      resizeRepaintGuardRef.current.clear();
      lastSentSizeRef.current = null;
    });
  }, [initialSession?.shellType, resize, session?.shellType, sessionId]);

  const handleTitleChange = useCallback((newTitle: string) => {
    setTitle(newTitle);
    onTitleChange?.(newTitle);
  }, [onTitleChange]);

  const handleTerminalReady = useCallback(() => {
    // Set the ref synchronously first so handleOutput immediately writes directly
    // instead of queuing. This eliminates the stale-closure window where new data
    // would be queued after flushOutputQueue() cleared the queue but before React
    // re-rendered and updated onOutputRef.current.
    isTerminalReadyRef.current = true;
    flushOutputQueue();
  }, [flushOutputQueue]);

  /**
   * A reserved session has no shell until this panel has measured itself: creating the
   * PTY earlier would start the shell at the backend default width and leave its first
   * prompt behind after the panel's real size was applied.
   */
  const handleSizeSettled = useCallback((size: { cols: number; rows: number }) => {
    lastMeasuredSizeRef.current = size;
    if (!isAwaitingSpawn) return;
    if (spawnStartedRef.current) return;
    spawnStartedRef.current = true;

    void waitForTerminalFonts().then(() => {
      if (unmountedRef.current) return;
      // The panel may have settled on another size while fonts were loading; the shell
      // must be created for the geometry the terminal holds when it actually starts.
      const latest = terminalRef.current?.getSize?.() ?? size;
      void spawnPendingSession(latest.cols, latest.rows);
    });
  }, [isAwaitingSpawn, spawnPendingSession]);

  const handlePasteShortcut = useCallback(async (): Promise<boolean> => {
    const shellType = session?.shellType ?? initialSession?.shellType;
    if (isExited || !shouldUsePowerShellReadlinePaste(shellType)) {
      return false;
    }

    inputQueueRef.current?.enqueue(POWERSHELL_READLINE_PASTE_SEQUENCE);
    return true;
  }, [initialSession?.shellType, isExited, session?.shellType]);

  // Handle paste with VS Code-style multi-line safety policy.
  const handlePaste = useCallback(async (
    text: string,
    context: { bracketedPasteMode: boolean },
  ): Promise<TerminalPasteDecision> => {
    if (isExited) {
      return { allow: false };
    }

    return resolveTerminalPaste(text, {
      bracketedPasteMode: context.bracketedPasteMode,
    });
  }, [isExited]);

  const handleSendCtrlC = useCallback(() => {
    sendCtrlC().catch(err => {
      log.error('Failed to send Ctrl+C', { sessionId, error: err });
    });
  }, [sendCtrlC, sessionId]);

  const handleClose = useCallback(() => {
    if (closeBehavior === 'terminate') {
      close().catch(err => {
        log.error('Failed to close', { sessionId, error: err });
      });
    }
    onClose?.();
  }, [close, closeBehavior, onClose, sessionId]);

  const handleRetry = useCallback(() => {
    // A reserved session whose creation failed has no shell to look up: retry the
    // creation with the size this panel already measured.
    const size = terminalRef.current?.getSize?.() ?? lastMeasuredSizeRef.current;
    if (isAwaitingSpawn && size) {
      spawnStartedRef.current = false;
      void spawnPendingSession(size.cols, size.rows);
      return;
    }

    refresh().catch(err => {
      log.error('Retry failed', { sessionId, error: err });
    });
  }, [isAwaitingSpawn, refresh, sessionId, spawnPendingSession]);

  useEffect(() => {
    if (session) {
      setTitle(session.name);
      if (session.status === 'Exited' || session.status === 'Error') {
        setIsExited(true);
      }
    }
  }, [session]);

  // Discard pending input when the terminal exits to avoid cascading write errors.
  useEffect(() => {
    if (isExited) {
      inputQueueRef.current?.clear();
    }
  }, [isExited]);

  const terminalId = `terminal-${sessionId}`;

  useEffect(() => {
    registerTerminalActions(terminalId, {
      getTerminal: () => terminalRef.current?.getTerminal() || null,
      isReadOnly: isExited,
      pasteShortcut: handlePasteShortcut,
      paste: (data: string) => {
        if (!isExited) {
          terminalRef.current?.paste(data);
        }
      },
      clear: () => {
        terminalRef.current?.clear();
      },
    });

    return () => {
      unregisterTerminalActions(terminalId);
    };
  }, [terminalId, isExited, handlePasteShortcut]);

  // A reserved session renders the terminal before its shell exists: the panel has to be
  // laid out and measure itself first, and `spawnPendingSession` needs that size. Showing
  // the connecting state here would leave the terminal unmounted, so nothing would ever be
  // measured and the PTY would never be created.
  if (isLoading && !isAwaitingSpawn) {
    return (
      <div className={`bitfun-terminal ${className}`} data-testid="shell-command-list" data-bitfun-component="terminal-tool" data-bitfun-part="root" data-bitfun-state="loading">
        <div className="bitfun-terminal__loading" data-testid="shell-command-status" data-command-status="loading" data-bitfun-component="terminal-tool" data-bitfun-part="loading">
          <div className="bitfun-terminal__loading-spinner" />
          <span className="bitfun-terminal__loading-text">Connecting to terminal...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bitfun-terminal ${className}`} data-testid="shell-command-list" data-bitfun-component="terminal-tool" data-bitfun-part="root" data-bitfun-state="error">
        <div className="bitfun-terminal__error" data-testid="shell-command-status" data-command-status="error" data-bitfun-component="terminal-tool" data-bitfun-part="error">
          <AlertCircle className="bitfun-terminal__error-icon" size={32} />
          <span className="bitfun-terminal__error-message">{error}</span>
          <Button
            variant="outline"
            size="sm"
            leadingIcon={<Icon name="refresh" size="lg" />}
            onClick={handleRetry}
            data-testid="shell-command-rerun"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`bitfun-terminal ${className}`}
      data-testid="shell-command-list"
      data-command-id={sessionId}
      data-command-status={isExited ? 'exited' : 'running'}
      data-bitfun-component="terminal-tool"
      data-bitfun-part="root"
      data-bitfun-state={isExited ? 'exited' : 'running'}
    >
      {showToolbar && (
        <div className="bitfun-terminal__toolbar" data-bitfun-component="terminal-tool" data-bitfun-part="toolbar">
          <div className="bitfun-terminal__toolbar-left">
            <Icon name="terminal" size="sm" />
            <span className="bitfun-terminal__toolbar-title" data-testid="shell-panel-title">
              {title}
              {session && (
                <span className="shell-type">({session.shellType})</span>
              )}
            </span>
          </div>
          <div className="bitfun-terminal__toolbar-right">
            <IconButton
              className="bitfun-terminal__toolbar-btn"
              onClick={handleSendCtrlC}
              title="Send Ctrl+C"
              aria-label="Send Ctrl+C"
              data-testid="shell-command-rerun"
              icon={<span style={{ fontSize: 'var(--bitfun-type-micro-font-size)', fontWeight: 'var(--bitfun-type-heading-page-font-weight)' }}>^C</span>}
            />
            <IconButton
              className={`bitfun-terminal__toolbar-btn${closeBehavior === 'terminate' ? ' bitfun-terminal__toolbar-btn--danger' : ''}`}
              onClick={handleClose}
              title={closeBehavior === 'detach' ? t('actions.closeView') : t('actions.stopTerminal')}
              aria-label={closeBehavior === 'detach' ? t('actions.closeView') : t('actions.stopTerminal')}
              data-testid="shell-panel-close"
              icon={closeBehavior === 'detach' ? <Icon name="xmark" size="sm" /> : <Icon name="delete" size="sm" />}
            />
          </div>
        </div>
      )}

      <Terminal
        ref={terminalRef}
        terminalId={terminalId}
        sessionId={sessionId}
        autoFocus={autoFocus}
        options={options}
        onData={handleData}
        onResize={handleResize}
        onTitleChange={handleTitleChange}
        onReady={handleTerminalReady}
        onPasteShortcut={handlePasteShortcut}
        onPaste={handlePaste}
        replayColumnGuardRef={replayColumnGuardRef}
        resizeSuspended={resizeSuspended}
        onSizeSettled={handleSizeSettled}
        onLayoutSettled={clearReplayColumnGuard}
        supportsCopyPaste={supportsCopyPaste}
      />

      {showStatusBar && session && (
        <div className={`bitfun-terminal__statusbar ${
          isExited ? 'bitfun-terminal__statusbar--exited' : ''
        } ${
          error ? 'bitfun-terminal__statusbar--error' : ''
        }`} data-bitfun-component="terminal-tool" data-bitfun-part="statusBar">
          <div className="bitfun-terminal__statusbar-left">
            <span
              className="bitfun-terminal__statusbar-item"
              data-testid="shell-command-status"
              data-command-status={isExited ? 'exited' : 'running'}
            >
              {session.shellType}
            </span>
            <span className="bitfun-terminal__statusbar-item">
              PID: {session.pid || '-'}
            </span>
            <span className="bitfun-terminal__statusbar-item">
              {session.cwd}
            </span>
          </div>
          <div className="bitfun-terminal__statusbar-right">
            <span className="bitfun-terminal__statusbar-item">
              {session.cols}×{session.rows}
            </span>
            {isExited && exitCode !== null && (
              <span
                className="bitfun-terminal__statusbar-item"
                data-testid="shell-command-exit-code"
                data-exit-code={exitCode}
                data-status={exitCode === 0 ? 'success' : 'failed'}
              >
                Exit code: {exitCode}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

ConnectedTerminal.displayName = 'ConnectedTerminal';

export default ConnectedTerminal;
