import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { TerminalResizeDebouncer } from './TerminalResizeDebouncer';

interface FakeTerminal {
  cols: number;
  rows: number;
  buffer: { normal: { length: number } };
}

interface HarnessOptions {
  /** Buffer row count; above 200 the debouncer also debounces the local X resize. */
  bufferRows?: number;
  cols?: number;
  rows?: number;
  /** Simulate a local resize that xterm refused (replay guard, suspension). */
  acceptResize?: boolean;
}

const FRAME_MS = 16;
const SWEEP_QUIET_MS = 400;
const SCROLLBACK_THRESHOLD = 200;

function createHarness({
  bufferRows = 10,
  cols = 80,
  rows = 24,
  acceptResize = true,
}: HarnessOptions = {}) {
  const terminal: FakeTerminal = {
    cols,
    rows,
    buffer: { normal: { length: bufferRows } },
  };
  const backendResizes: Array<{ cols: number; rows: number }> = [];
  const xtermResizes: Array<{ cols: number; rows: number }> = [];
  const completes: number[] = [];

  const debouncer = new TerminalResizeDebouncer({
    getTerminal: () => terminal as unknown as Terminal,
    isVisible: () => true,
    onXtermResize: (nextCols, nextRows) => {
      if (!acceptResize) return false;
      terminal.cols = nextCols;
      terminal.rows = nextRows;
      xtermResizes.push({ cols: nextCols, rows: nextRows });
      return true;
    },
    onBackendResize: (backendCols, backendRows) => {
      backendResizes.push({ cols: backendCols, rows: backendRows });
    },
    onResizeComplete: () => {
      completes.push(1);
    },
  });

  return { terminal, debouncer, backendResizes, xtermResizes, completes };
}

describe('TerminalResizeDebouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resizes the PTY once for a sweep while xterm follows each frame (small buffer)', () => {
    const { debouncer, backendResizes, xtermResizes, completes } = createHarness();

    // A panel that moves measures a new size on each frame, and the size keeps
    // changing until the layout settles.
    const sweep = [93, 88, 80, 70, 60, 51, 47, 55, 66, 78, 90, 93];
    for (const cols of sweep) {
      debouncer.resize(cols, 30);
      vi.advanceTimersByTime(FRAME_MS);
    }
    vi.advanceTimersByTime(SWEEP_QUIET_MS);

    // Below the scrollback threshold the local resize is not debounced.
    expect(xtermResizes).toHaveLength(sweep.length);
    // Every intermediate width raises SIGWINCH in the shell, which redraws its
    // prompt for it; only the settled width may reach the PTY.
    expect(backendResizes).toEqual([{ cols: 93, rows: 30 }]);
    expect(completes).toHaveLength(1);
  });

  it('collapses the whole sweep into one local and one PTY resize (large buffer)', () => {
    const { debouncer, backendResizes, xtermResizes, completes } = createHarness({
      bufferRows: SCROLLBACK_THRESHOLD + 50,
      rows: 30,
    });

    const sweep = [93, 88, 80, 70, 60, 51, 47, 55, 66, 78, 90, 93];
    for (const cols of sweep) {
      debouncer.resize(cols, 30);
      vi.advanceTimersByTime(FRAME_MS);
    }
    vi.advanceTimersByTime(SWEEP_QUIET_MS);

    // Above the threshold the column resize is itself debounced, so the local
    // geometry only moves once, after the sweep stops measuring new sizes.
    expect(xtermResizes).toEqual([{ cols: 93, rows: 30 }]);
    expect(backendResizes).toEqual([{ cols: 93, rows: 30 }]);
    expect(completes).toHaveLength(1);
  });

  it('resizes the PTY after the settle delay when only rows change', () => {
    const { debouncer, backendResizes, xtermResizes } = createHarness({
      bufferRows: SCROLLBACK_THRESHOLD + 50,
      rows: 30,
    });

    debouncer.resize(80, 25);

    expect(xtermResizes).toEqual([{ cols: 80, rows: 25 }]);
    vi.advanceTimersByTime(140);
    expect(backendResizes).toEqual([]);

    vi.advanceTimersByTime(20);
    expect(backendResizes).toEqual([{ cols: 80, rows: 25 }]);
  });

  it('bounds the deferral when the layout never goes quiet', () => {
    const { debouncer, backendResizes } = createHarness({ rows: 30 });

    // A long drag keeps alternating between two widths. A pure trailing debounce
    // would never let any size through for the whole interaction.
    for (let frame = 0; frame < 40; frame += 1) {
      debouncer.resize(frame % 2 === 0 ? 60 : 70, 30);
      vi.advanceTimersByTime(FRAME_MS);
    }

    const duringSweep = backendResizes.length;
    expect(duringSweep).toBeGreaterThan(0);

    vi.advanceTimersByTime(SWEEP_QUIET_MS);

    // The last measurement still reaches the PTY once the sweep settles ...
    expect(backendResizes[backendResizes.length - 1]).toEqual({ cols: 70, rows: 30 });
    // ... and the cap keeps the intermediate traffic to a few resizes, not one per frame.
    expect(backendResizes.length).toBeLessThanOrEqual(4);
  });

  it('sends the settled size once for a short sweep below the scrollback threshold', () => {
    const { debouncer, backendResizes } = createHarness();

    debouncer.resize(70, 30);
    vi.advanceTimersByTime(FRAME_MS);
    debouncer.resize(50, 30);
    vi.advanceTimersByTime(FRAME_MS);
    debouncer.resize(66, 30);
    vi.advanceTimersByTime(SWEEP_QUIET_MS);

    expect(backendResizes).toEqual([{ cols: 66, rows: 30 }]);
  });

  it('keeps an explicit immediate resize on the short merge delay', () => {
    const { debouncer, backendResizes } = createHarness();

    debouncer.resize(100, 30, true);
    vi.advanceTimersByTime(60);

    expect(backendResizes).toEqual([{ cols: 100, rows: 30 }]);
  });

  it('flushes the pending settled size without waiting for the quiet period', () => {
    const { debouncer, backendResizes } = createHarness();

    debouncer.resize(93, 30);
    vi.advanceTimersByTime(FRAME_MS);
    debouncer.resize(88, 30);
    vi.advanceTimersByTime(FRAME_MS);
    debouncer.resize(72, 30);

    expect(backendResizes).toEqual([]);

    debouncer.flush();

    expect(backendResizes).toEqual([{ cols: 72, rows: 30 }]);

    // The flushed timer must not fire a second time.
    vi.advanceTimersByTime(SWEEP_QUIET_MS);
    expect(backendResizes).toEqual([{ cols: 72, rows: 30 }]);
  });

  it('delivers the pending PTY resize on dispose instead of dropping it', () => {
    const { debouncer, backendResizes } = createHarness();

    debouncer.resize(93, 30);
    vi.advanceTimersByTime(FRAME_MS);
    expect(backendResizes).toEqual([]);

    debouncer.dispose();

    expect(backendResizes).toEqual([{ cols: 93, rows: 30 }]);

    // Disposal must not leave a timer behind that fires a second time.
    debouncer.resize(100, 30);
    vi.advanceTimersByTime(SWEEP_QUIET_MS);
    expect(backendResizes).toEqual([{ cols: 93, rows: 30 }]);
  });

  it('does not resize the PTY when xterm refused the size', () => {
    const { debouncer, backendResizes, completes } = createHarness({
      acceptResize: false,
    });

    debouncer.resize(93, 30);
    vi.advanceTimersByTime(SWEEP_QUIET_MS);

    expect(backendResizes).toEqual([]);
    expect(completes).toHaveLength(0);
  });
});
