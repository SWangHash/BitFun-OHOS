/**
 * Terminal resize debouncer with split X/Y strategies and visibility-aware scheduling.
 */

import type { Terminal } from '@xterm/xterm';

/** Start debouncing when buffer rows exceed this threshold. */
const START_DEBOUNCING_THRESHOLD = 200;

/** Debounce delay for X-axis resize (ms). */
const RESIZE_X_DEBOUNCE_MS = 100;

/** Backend resize merge delay (ms). */
const BACKEND_RESIZE_DEBOUNCE_MS = 50;

/**
 * Quiet period a layout sweep must observe before the PTY is resized (ms).
 *
 * A panel that moves or animates measures a new size on every frame, and each of
 * those sizes used to reach the PTY. Every PTY resize raises SIGWINCH, and a shell
 * redraws its prompt for it: a long prompt that no longer fits the intermediate
 * width wraps, and the shell's next redraw clears only the row it believes it owns,
 * leaving the clipped rows of the narrower layout on screen after the panel
 * settles. Those frames are not a settled layout — only the last one is — so the
 * PTY is told once, after the sweep goes quiet. (Whether xterm follows each frame
 * locally depends on the buffer: below `START_DEBOUNCING_THRESHOLD` it does, above
 * it the column resize is itself debounced by `RESIZE_X_DEBOUNCE_MS`.)
 */
const BACKEND_RESIZE_SETTLE_MS = 150;

/**
 * Upper bound on how long a continuously changing layout may keep the PTY at its
 * previous size (ms), measured from the first measurement of the current sweep.
 *
 * The settle above is a trailing debounce, so on its own it never fires while a
 * layout keeps producing new sizes faster than the quiet period: a long drag or
 * window resize would leave the shell laying out its next output for a width the
 * panel no longer has for the whole interaction, and a sweep that never goes quiet
 * would never resize the PTY at all. The cap lets at most a few intermediate sizes
 * through during the interaction. Terminal's xterm/PTY lockstep guard still drops
 * any target xterm has not accepted, so a capped send can never move the PTY alone.
 */
const BACKEND_RESIZE_MAX_DEFER_MS = 300;

/** Idle callback timeout (ms). */
const IDLE_CALLBACK_TIMEOUT_MS = 2000;

export interface ResizeCallback {
  (cols: number, rows: number): void | Promise<void>;
}

export interface ResizeDebounceOptions {
  getTerminal: () => Terminal | null;
  isVisible: () => boolean;
  /** Local xterm resize callback. Returns false when resize was intentionally skipped. */
  onXtermResize: (cols: number, rows: number) => boolean;
  /** Backend PTY resize callback (debounced/merged). */
  onBackendResize: (cols: number, rows: number) => void | Promise<void>;
  /** Optional hook invoked after flush. */
  onFlush?: () => void;
  /** Optional hook invoked after resize completes. */
  onResizeComplete?: () => void;
}

// Legacy options interface.
export interface LegacyResizeDebounceOptions {
  getTerminal: () => Terminal | null;
  isVisible: () => boolean;
  onResizeBoth: ResizeCallback;
  onResizeX: (cols: number) => void | Promise<void>;
  onResizeY: (rows: number) => void | Promise<void>;
  /** Optional hook invoked after flush. */
  onFlush?: () => void;
}

/** requestIdleCallback polyfill. */
const requestIdleCallback = 
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? window.requestIdleCallback
    : (cb: IdleRequestCallback, options?: IdleRequestOptions) => {
        const start = Date.now();
        return window.setTimeout(() => {
          cb({
            didTimeout: false,
            timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
          });
        }, options?.timeout ?? 1) as unknown as number;
      };

const cancelIdleCallback =
  typeof window !== 'undefined' && 'cancelIdleCallback' in window
    ? window.cancelIdleCallback
    : (id: number) => clearTimeout(id);

/** Check whether options use the new API. */
function isNewOptions(options: ResizeDebounceOptions | LegacyResizeDebounceOptions): options is ResizeDebounceOptions {
  return 'onXtermResize' in options && 'onBackendResize' in options;
}

/**
 * Debounced terminal resize controller.
 * Uses immediate resize for small buffers, debounced backend updates, and idle scheduling when hidden.
 */
export class TerminalResizeDebouncer {
  private latestCols = 0;
  private latestRows = 0;
  
  private resizeXTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private resizeXIdleCallbackId: number | null = null;
  private resizeYIdleCallbackId: number | null = null;
  
  private backendResizeTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private pendingBackendResize: { cols: number; rows: number } | null = null;
  /** Start of the current PTY-resize sweep, used to bound the trailing deferral. */
  private backendResizeFirstRequestAtMs: number | null = null;
  
  private readonly options: ResizeDebounceOptions | LegacyResizeDebounceOptions;
  private readonly isNewApi: boolean;
  private disposed = false;

  constructor(options: ResizeDebounceOptions | LegacyResizeDebounceOptions) {
    this.options = options;
    this.isNewApi = isNewOptions(options);
  }

  /**
   * Request a resize operation.
   */
  resize(cols: number, rows: number, immediate = false): void {
    if (this.disposed) return;

    this.latestCols = cols;
    this.latestRows = rows;

    const terminal = this.options.getTerminal();
    if (!terminal) return;

    const currentCols = terminal.cols;
    const currentRows = terminal.rows;

    if (cols === currentCols && rows === currentRows) {
      return;
    }

    const bufferLength = terminal.buffer.normal.length;

    if (immediate || bufferLength < START_DEBOUNCING_THRESHOLD) {
      this.clearPendingJobs();
      if (this.isNewApi) {
        const opts = this.options as ResizeDebounceOptions;
        // Backend resize is scheduled only after xterm accepted the same size.
        // This prevents PTY/frontend geometry drift when callers suppress a fit.
        if (opts.onXtermResize(cols, rows)) {
          // A caller that asks for an immediate resize is reacting to a settled
          // size; a small-buffer measurement can still be one frame of a sweep.
          const backendDelay = immediate
            ? BACKEND_RESIZE_DEBOUNCE_MS
            : BACKEND_RESIZE_SETTLE_MS;
          this.scheduleBackendResize(cols, rows, backendDelay);
        }
      } else {
        this.executeResize(cols, rows, true);
      }
      return;
    }

    if (!this.options.isVisible()) {
      this.scheduleIdleResize(cols, rows);
      return;
    }

    const colsChanged = cols !== currentCols;
    const rowsChanged = rows !== currentRows;

    if (this.isNewApi) {
      const opts = this.options as ResizeDebounceOptions;
      
      if (rowsChanged) {
        // Row-only updates are still gated by local success; skipped local
        // resizes must not be mirrored to the PTY.
        if (opts.onXtermResize(currentCols, rows)) {
          this.scheduleBackendResize(currentCols, rows, BACKEND_RESIZE_SETTLE_MS);
        }
      }
      if (colsChanged) {
        this.debounceXtermResizeX(cols, rows);
      }
    } else {
      const opts = this.options as LegacyResizeDebounceOptions;
      
      if (rowsChanged) {
        opts.onResizeY(rows);
      }

      if (colsChanged) {
        this.debounceResizeXLegacy(cols);
      }
    }
  }

  /**
   * Flush pending resize work.
   */
  flush(forceCallback = false): void {
    if (this.disposed) return;

    const hasPendingResize = 
      this.resizeXTimeoutId !== null ||
      this.resizeXIdleCallbackId !== null ||
      this.resizeYIdleCallbackId !== null ||
      this.backendResizeTimeoutId !== null;

    if (hasPendingResize) {
      this.clearPendingJobs();
      // Flushing delivers the pending size, so the next sweep starts its own
      // deferral budget.
      this.backendResizeFirstRequestAtMs = null;
      this.executeResize(this.latestCols, this.latestRows, true);
    }
    
    if ((hasPendingResize || forceCallback) && this.options.onFlush) {
      this.options.onFlush();
    }
  }

  /**
   * Get the latest target size.
   */
  getLatestSize(): { cols: number; rows: number } {
    return {
      cols: this.latestCols,
      rows: this.latestRows,
    };
  }

  hasPendingResize(): boolean {
    return (
      this.resizeXTimeoutId !== null ||
      this.resizeXIdleCallbackId !== null ||
      this.resizeYIdleCallbackId !== null ||
      this.backendResizeTimeoutId !== null
    );
  }

  dispose(): void {
    // A pending PTY resize is the last thing the shell would learn about this
    // panel. Dropping it here leaves the session's PTY on a geometry the panel has
    // already left until the next reattach fits again, so deliver it first. The
    // xterm/PTY lockstep guard still refuses a target xterm never accepted.
    this.flushPendingBackendResize();
    this.disposed = true;
    this.clearPendingJobs();
    this.backendResizeFirstRequestAtMs = null;
  }

  private executeResize(cols: number, rows: number, includeBackend: boolean): void {
    if (this.isNewApi) {
      const opts = this.options as ResizeDebounceOptions;
      const resized = opts.onXtermResize(cols, rows);
      if (includeBackend) {
        // Flush can run after a suspended resize. Respect the local result so a
        // stale pending target cannot resize only the backend.
        if (resized) {
          opts.onBackendResize(cols, rows);
          opts.onResizeComplete?.();
        }
      }
    } else {
      const opts = this.options as LegacyResizeDebounceOptions;
      opts.onResizeBoth(cols, rows);
    }
  }

  private debounceXtermResizeX(cols: number, rows: number): void {
    if (this.resizeXTimeoutId !== null) {
      clearTimeout(this.resizeXTimeoutId);
    }

    this.resizeXTimeoutId = setTimeout(() => {
      this.resizeXTimeoutId = null;
      if (!this.disposed && this.isNewApi) {
        const opts = this.options as ResizeDebounceOptions;
        if (opts.onXtermResize(cols, rows)) {
          this.scheduleBackendResize(cols, rows, BACKEND_RESIZE_SETTLE_MS);
        }
      }
    }, RESIZE_X_DEBOUNCE_MS);
  }

  private scheduleBackendResize(cols: number, rows: number, delayMs: number): void {
    if (!this.isNewApi) return;

    this.pendingBackendResize = { cols, rows };

    // Trailing: every newer measurement cancels the pending PTY resize, so a
    // layout sweep reaches the PTY once, at the size the panel settles on.
    if (this.backendResizeTimeoutId !== null) {
      clearTimeout(this.backendResizeTimeoutId);
    }

    const nowMs = Date.now();
    if (this.backendResizeFirstRequestAtMs === null) {
      this.backendResizeFirstRequestAtMs = nowMs;
    }
    // Cap the total deferral: a sweep that never goes quiet still has to reach the
    // PTY eventually instead of holding the old geometry for the whole interaction.
    const remainingDeferMs =
      BACKEND_RESIZE_MAX_DEFER_MS - (nowMs - this.backendResizeFirstRequestAtMs);
    const effectiveDelayMs = Math.max(0, Math.min(delayMs, remainingDeferMs));

    this.backendResizeTimeoutId = setTimeout(() => {
      this.backendResizeTimeoutId = null;
      this.backendResizeFirstRequestAtMs = null;
      if (!this.disposed && this.pendingBackendResize) {
        const opts = this.options as ResizeDebounceOptions;
        const { cols: c, rows: r } = this.pendingBackendResize;
        this.pendingBackendResize = null;
        opts.onBackendResize(c, r);
        opts.onResizeComplete?.();
      }
    }, effectiveDelayMs);
  }

  /**
   * Deliver a pending PTY resize synchronously. Used when the scheduler is going
   * away, where waiting out the settle delay is no longer an option.
   */
  private flushPendingBackendResize(): void {
    if (!this.isNewApi) return;

    const pending = this.pendingBackendResize;
    if (!pending) return;

    this.pendingBackendResize = null;
    if (this.backendResizeTimeoutId !== null) {
      clearTimeout(this.backendResizeTimeoutId);
      this.backendResizeTimeoutId = null;
    }

    const opts = this.options as ResizeDebounceOptions;
    opts.onBackendResize(pending.cols, pending.rows);
  }

  private debounceResizeXLegacy(cols: number): void {
    if (this.resizeXTimeoutId !== null) {
      clearTimeout(this.resizeXTimeoutId);
    }

    this.resizeXTimeoutId = setTimeout(() => {
      this.resizeXTimeoutId = null;
      if (!this.disposed && !this.isNewApi) {
        const opts = this.options as LegacyResizeDebounceOptions;
        opts.onResizeX(cols);
      }
    }, RESIZE_X_DEBOUNCE_MS);
  }

  private scheduleIdleResize(cols: number, rows: number): void {
    const terminal = this.options.getTerminal();
    if (!terminal) return;

    const currentCols = terminal.cols;
    const currentRows = terminal.rows;

    if (this.isNewApi) {
      if (this.resizeXIdleCallbackId === null) {
        this.resizeXIdleCallbackId = requestIdleCallback(
          () => {
            this.resizeXIdleCallbackId = null;
            if (!this.disposed) {
              this.executeResize(this.latestCols, this.latestRows, true);
            }
          },
          { timeout: IDLE_CALLBACK_TIMEOUT_MS }
        );
      }
    } else {
      const opts = this.options as LegacyResizeDebounceOptions;
      
      if (cols !== currentCols && this.resizeXIdleCallbackId === null) {
        this.resizeXIdleCallbackId = requestIdleCallback(
          () => {
            this.resizeXIdleCallbackId = null;
            if (!this.disposed) {
              opts.onResizeX(this.latestCols);
            }
          },
          { timeout: IDLE_CALLBACK_TIMEOUT_MS }
        );
      }

      if (rows !== currentRows && this.resizeYIdleCallbackId === null) {
        this.resizeYIdleCallbackId = requestIdleCallback(
          () => {
            this.resizeYIdleCallbackId = null;
            if (!this.disposed) {
              opts.onResizeY(this.latestRows);
            }
          },
          { timeout: IDLE_CALLBACK_TIMEOUT_MS }
        );
      }
    }
  }

  private clearPendingJobs(): void {
    if (this.resizeXTimeoutId !== null) {
      clearTimeout(this.resizeXTimeoutId);
      this.resizeXTimeoutId = null;
    }

    if (this.resizeXIdleCallbackId !== null) {
      cancelIdleCallback(this.resizeXIdleCallbackId);
      this.resizeXIdleCallbackId = null;
    }

    if (this.resizeYIdleCallbackId !== null) {
      cancelIdleCallback(this.resizeYIdleCallbackId);
      this.resizeYIdleCallbackId = null;
    }

    if (this.backendResizeTimeoutId !== null) {
      clearTimeout(this.backendResizeTimeoutId);
      this.backendResizeTimeoutId = null;
      this.pendingBackendResize = null;
    }
  }
}

export default TerminalResizeDebouncer;
