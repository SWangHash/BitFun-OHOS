import { describe, expect, it } from 'vitest';

import { REPLAY_COLUMN_GUARD_MAX_AGE_MS, ReplayColumnGuard } from './replayColumnGuard';

describe('ReplayColumnGuard', () => {
  it('protects the width a replay was recorded at', () => {
    const guard = new ReplayColumnGuard();
    guard.arm(93, 1000);

    expect(guard.protectedCols(1000)).toBe(93);
  });

  it('keeps the widest width when a replay reports several geometries', () => {
    const guard = new ReplayColumnGuard();
    guard.arm(93, 1000);
    guard.arm(80, 1010);
    guard.arm(120, 1020);

    expect(guard.protectedCols(1020)).toBe(120);
  });

  it('stops protecting once the window has passed', () => {
    const guard = new ReplayColumnGuard();
    guard.arm(93, 1000);

    expect(guard.protectedCols(1000 + REPLAY_COLUMN_GUARD_MAX_AGE_MS)).toBe(93);
    expect(guard.protectedCols(1000 + REPLAY_COLUMN_GUARD_MAX_AGE_MS + 1)).toBe(0);
  });

  it('releases the width after the window even when nothing else clears it', () => {
    const guard = new ReplayColumnGuard();
    guard.arm(93, 0);

    // An idle shell produces no live output, so the guard is the only thing that
    // can let a settled layout shrink the terminal back to its container width.
    expect(guard.protectedCols(5_000)).toBe(0);
  });

  it('extends the window from the latest replay step', () => {
    const guard = new ReplayColumnGuard();
    guard.arm(93, 0);
    guard.arm(93, REPLAY_COLUMN_GUARD_MAX_AGE_MS);

    expect(guard.protectedCols(REPLAY_COLUMN_GUARD_MAX_AGE_MS + 500)).toBe(93);
    expect(guard.protectedCols(REPLAY_COLUMN_GUARD_MAX_AGE_MS * 2 + 1)).toBe(0);
  });

  it('clears immediately when the layout settles', () => {
    const guard = new ReplayColumnGuard();
    guard.arm(93, 1000);
    guard.clear();

    expect(guard.protectedCols(1000)).toBe(0);
  });

  it('ignores widths that cannot protect anything', () => {
    const guard = new ReplayColumnGuard();
    guard.arm(0, 1000);
    guard.arm(Number.NaN, 1000);

    expect(guard.protectedCols(1000)).toBe(0);
  });
});
