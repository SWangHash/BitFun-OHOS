import { describe, expect, it } from 'vitest';

import { decideResizeUnderColumnGuard } from './columnGuardResize';

describe('decideResizeUnderColumnGuard', () => {
  it('applies the measured geometry when nothing is protected', () => {
    expect(
      decideResizeUnderColumnGuard({
        targetCols: 100,
        targetRows: 24,
        currentCols: 80,
        currentRows: 24,
        protectedCols: 0,
        hasBufferedScreenText: true,
      }),
    ).toEqual({ kind: 'resize', cols: 100, rows: 24 });
  });

  it('still follows the container height when the protected width refuses the shrink', () => {
    // Regression: a replay armed the guard at 93 columns, the panel was re-parented
    // into a taller box, and refusing the whole measurement left the terminal at the
    // recorded row count: one visible row of scrollback behind a scrollbar.
    expect(
      decideResizeUnderColumnGuard({
        targetCols: 60,
        targetRows: 30,
        currentCols: 93,
        currentRows: 4,
        protectedCols: 93,
        hasBufferedScreenText: true,
      }),
    ).toEqual({ kind: 'rows-only', cols: 93, rows: 30 });
  });

  it('does nothing when the protected geometry already matches the height', () => {
    expect(
      decideResizeUnderColumnGuard({
        targetCols: 60,
        targetRows: 30,
        currentCols: 93,
        currentRows: 30,
        protectedCols: 93,
        hasBufferedScreenText: true,
      }),
    ).toEqual({ kind: 'skip' });
  });

  it('lets a wider measurement through while the guard is armed', () => {
    expect(
      decideResizeUnderColumnGuard({
        targetCols: 120,
        targetRows: 30,
        currentCols: 93,
        currentRows: 30,
        protectedCols: 93,
        hasBufferedScreenText: true,
      }),
    ).toEqual({ kind: 'resize', cols: 120, rows: 30 });
  });

  it('ignores the guard for a terminal without replayed screen text', () => {
    // An empty new terminal must follow the panel immediately, otherwise it keeps
    // xterm's default 80x24 while the PTY moves to the real size.
    expect(
      decideResizeUnderColumnGuard({
        targetCols: 60,
        targetRows: 12,
        currentCols: 80,
        currentRows: 24,
        protectedCols: 93,
        hasBufferedScreenText: false,
      }),
    ).toEqual({ kind: 'resize', cols: 60, rows: 12 });
  });
});
