/**
 * Resize decision for a container measurement that is partly unusable.
 *
 * A split panel can measure a width that is too narrow to lay out a terminal in, and the
 * commit that introduced the minimum column count refused the whole measurement for it.
 * The terminal then also stopped following the container height, so a panel that was
 * split again kept the row count of its previous box: one visible row of scrollback
 * behind a scrollbar, in every terminal that was not the one being dragged.
 *
 * The two axes are independent. An axis that measured below its minimum keeps its current
 * value; the other axis still follows the container.
 */

export interface FitDimensionInput {
  /** Columns the container measured. */
  measuredCols: number;
  /** Rows the container measured. */
  measuredRows: number;
  /** Columns the terminal currently holds. */
  currentCols: number;
  /** Rows the terminal currently holds. */
  currentRows: number;
  /** Narrowest column count the terminal will lay out at. */
  minCols: number;
  /** Smallest row count the terminal will lay out at. */
  minRows: number;
}

export type FitResizeDecision =
  | { kind: 'resize'; cols: number; rows: number }
  | { kind: 'skip' };

export function decideFitResize(input: FitDimensionInput): FitResizeDecision {
  const colsUsable = input.measuredCols >= input.minCols;
  const rowsUsable = input.measuredRows >= input.minRows;

  if (!colsUsable && !rowsUsable) {
    return { kind: 'skip' };
  }

  const cols = colsUsable ? input.measuredCols : input.currentCols;
  const rows = rowsUsable ? input.measuredRows : input.currentRows;

  if (cols === input.currentCols && rows === input.currentRows) {
    return { kind: 'skip' };
  }

  return { kind: 'resize', cols, rows };
}
