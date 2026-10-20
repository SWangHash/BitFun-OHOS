/**
 * Lifetime of the replay column guard.
 *
 * Replaying history rebuilds the screen from bytes that were recorded at the
 * geometries of the session's earlier resizes. While that replay is on screen, a
 * shrink to a narrower intermediate width would reflow it and clip content the
 * terminal can never get back, so the terminal refuses to shrink until something
 * proves the geometry is settled again.
 *
 * The guard is armed when the replay starts and has to end on its own. It used
 * to end only when the shell produced live output, which never happens while a
 * prompt sits idle: after moving the terminal panel to another dock, the panel
 * measured its new size, the guard refused the shrink, the PTY was left at the
 * old dock's column count, and the terminal stayed clipped at a width that no
 * longer had anything to do with its container.
 */
export const REPLAY_COLUMN_GUARD_MAX_AGE_MS = 1_000;

function currentTimeMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

interface ArmedGuard {
  cols: number;
  armedAtMs: number;
}

/**
 * Column count the terminal must refuse to shrink below right now.
 *
 * A guard that outlives its window reports 0, so a layout that has settled is
 * never blocked by a replay that has already finished.
 */
export class ReplayColumnGuard {
  private armed: ArmedGuard | null = null;

  /**
   * Raise the protected column count. Repeated calls during one replay keep the
   * widest value and extend the window, since the replay is still being applied.
   */
  arm(cols: number, nowMs: number = currentTimeMs()): void {
    if (!Number.isFinite(cols) || cols <= 0) {
      return;
    }

    this.armed = {
      cols: Math.max(this.armed?.cols ?? 0, cols),
      armedAtMs: nowMs,
    };
  }

  clear(): void {
    this.armed = null;
  }

  protectedCols(nowMs: number = currentTimeMs()): number {
    const armed = this.armed;
    if (!armed) {
      return 0;
    }

    if (nowMs - armed.armedAtMs > REPLAY_COLUMN_GUARD_MAX_AGE_MS) {
      this.armed = null;
      return 0;
    }

    return armed.cols;
  }
}
