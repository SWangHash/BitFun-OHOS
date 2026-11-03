/** Smallest readable pane: one section header plus one row. */
const PANE_MIN_HEIGHT = 88;

/** A pane this short never scrolls and never claims more than its content. */
const PANE_FULL_HEIGHT = 160;

/**
 * Splits the height the project permissions dialog can hand to its two panes.
 *
 * A pane that holds only a few lines keeps its natural height, so an empty or
 * almost empty pane costs what its content costs instead of reserving a
 * proportional slice of empty space. Anything longer is split by content size,
 * and both panes stay readable.
 */
export function distributePaneHeights(naturalHeights: number[], available: number): number[] {
  const naturals = naturalHeights.map((height) => Math.max(0, Math.round(height)));
  const total = naturals.reduce((sum, height) => sum + height, 0);
  const space = Math.max(0, Math.round(available));
  if (total === 0 || space === 0) {
    return naturals.map(() => 0);
  }
  if (total <= space) {
    return naturals;
  }

  // Short panes first: they keep their natural height as long as every other
  // pane still gets a readable minimum out of what is left.
  const heights = naturals.slice();
  const pending = new Set(naturals.map((_, index) => index));
  let remaining = space;
  for (const index of [...pending].sort((left, right) => naturals[left] - naturals[right])) {
    const reservedForOthers = (pending.size - 1) * PANE_MIN_HEIGHT;
    if (naturals[index] <= PANE_FULL_HEIGHT && naturals[index] <= remaining - reservedForOthers) {
      heights[index] = naturals[index];
      remaining -= naturals[index];
      pending.delete(index);
    }
  }

  const pendingNatural = [...pending].reduce((sum, index) => sum + naturals[index], 0);
  if (pendingNatural > 0) {
    for (const index of pending) {
      heights[index] = Math.floor((remaining * naturals[index]) / pendingNatural);
    }
  }

  return heights.map((height, index) => Math.max(height, Math.min(PANE_MIN_HEIGHT, naturals[index])));
}

/** Height a section would have if nothing clipped it. */
export function naturalSectionHeight(section: HTMLElement): number {
  const list = section.querySelector<HTMLElement>('[data-bitfun-part="grants"], [data-bitfun-part="rules"]');
  let height = 0;
  for (const child of Array.from(section.children)) {
    const element = child as HTMLElement;
    // The list is clipped by design, so its own height is the pane, not the content.
    height += element === list ? list.scrollHeight : element.offsetHeight;
  }
  return height + 2;
}
