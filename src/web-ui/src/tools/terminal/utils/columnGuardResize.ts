/**
 * Resize decision for a container measurement while the replay column guard is armed.
 *
 * The guard exists to keep replayed history from being reflowed into a narrower width
 * than it was recorded at. It protects columns only: a terminal that refuses the whole
 * measurement keeps the row count of the geometry the replay was recorded at, so a panel
 * re-parented into a taller or shorter box showed a single row of its scrollback behind a
 * scrollbar until the user happened to resize the panel again.
 */

export interface ColumnGuardResizeInput {
  /** Columns the container measured. */
  targetCols: number;
  /** Rows the container measured. */
  targetRows: number;
  /** Columns the terminal currently holds. */
  currentCols: number;
  /** Rows the terminal currently holds. */
  currentRows: number;
  /** Column count the replay guard still protects; 0 when unarmed or expired. */
  protectedCols: number;
  /** Whether the terminal actually shows replayed screen text the guard can protect. */
  hasBufferedScreenText: boolean;
}

export type ColumnGuardResizeDecision =
  | { kind: 'resize'; cols: number; rows: number }
  | { kind: 'rows-only'; cols: number; rows: number }
  | { kind: 'skip' };

export function decideResizeUnderColumnGuard(
  input: ColumnGuardResizeInput,
): ColumnGuardResizeDecision {
  const protectsWidth =
    input.protectedCols > 0
    && input.hasBufferedScreenText
    && input.targetCols < input.protectedCols;

  if (!protectsWidth) {
    return { kind: 'resize', cols: input.targetCols, rows: input.targetRows };
  }

  if (input.targetRows !== input.currentRows) {
    // Keep the protected columns, follow the container height.
    return { kind: 'rows-only', cols: input.currentCols, rows: input.targetRows };
  }

  return { kind: 'skip' };
}
