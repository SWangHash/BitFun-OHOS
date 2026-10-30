import { describe, expect, it } from 'vitest';

import { decideFitResize } from './fitDimensions';

const limits = { minCols: 40, minRows: 3 };

describe('decideFitResize', () => {
  it('applies both axes when the measurement is usable', () => {
    expect(
      decideFitResize({
        measuredCols: 120,
        measuredRows: 30,
        currentCols: 80,
        currentRows: 24,
        ...limits,
      }),
    ).toEqual({ kind: 'resize', cols: 120, rows: 30 });
  });

  it('still follows the height when the panel is too narrow for the minimum column count', () => {
    // Regression: a split panel narrower than the minimum column count used to refuse
    // the whole measurement, so every terminal that was not the one being dragged kept
    // the row count of its previous box: one row of scrollback behind a scrollbar.
    expect(
      decideFitResize({
        measuredCols: 28,
        measuredRows: 30,
        currentCols: 93,
        currentRows: 4,
        ...limits,
      }),
    ).toEqual({ kind: 'resize', cols: 93, rows: 30 });
  });

  it('still follows the width when the panel is too short for the minimum row count', () => {
    expect(
      decideFitResize({
        measuredCols: 120,
        measuredRows: 2,
        currentCols: 93,
        currentRows: 8,
        ...limits,
      }),
    ).toEqual({ kind: 'resize', cols: 120, rows: 8 });
  });

  it('does nothing when both axes already match', () => {
    expect(
      decideFitResize({
        measuredCols: 28,
        measuredRows: 2,
        currentCols: 93,
        currentRows: 8,
        ...limits,
      }),
    ).toEqual({ kind: 'skip' });
  });

  it('skips a measurement that is unusable on both axes', () => {
    expect(
      decideFitResize({
        measuredCols: 20,
        measuredRows: 2,
        currentCols: 93,
        currentRows: 8,
        ...limits,
      }),
    ).toEqual({ kind: 'skip' });
  });
});
