/**
 * Helpers for positioning `position: fixed` popovers anchored to another element,
 * staying within the visual viewport with optional flip above the anchor.
 */

export const DEFAULT_POPOVER_VIEWPORT_PADDING = 8;

export type FixedPopoverPlacement = 'top' | 'bottom';

// 'start' aligns the menu's left edge with the anchor's left edge; 'end'
// aligns the right edges instead, for anchors that sit near the window's
// right side where a start-aligned wide menu would overflow.
export type FixedPopoverAlignment = 'start' | 'end';

export interface FixedPopoverViewport {
  width: number;
  height: number;
}

export interface FixedPopoverPositionOptions {
  gap?: number;
  padding?: number;
  /**
   * Space the popover must keep clear of at the viewport start edge, for host
   * window chrome such as the OpenHarmony caption buttons. Defaults to 0.
   */
  topInset?: number;
  preferredPlacement?: FixedPopoverPlacement;
  alignment?: FixedPopoverAlignment;
}

interface FixedPopoverAnchorRect {
  left: number;
  right?: number;
  top: number;
  bottom: number;
}

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), Math.max(min, max));
};

const clampFixedPopoverLeftInViewport = (
  preferredLeft: number,
  menuWidth: number,
  viewportWidth: number,
  padding: number,
): number => {
  return clamp(preferredLeft, padding, viewportWidth - menuWidth - padding);
};

const fixedPopoverFitsVertically = (
  top: number,
  menuHeight: number,
  viewportHeight: number,
  padding: number,
  topInset: number,
): boolean => {
  return top >= Math.max(padding, topInset) && top + menuHeight <= viewportHeight - padding;
};

const clampFixedPopoverTopInViewport = (
  anchorRect: FixedPopoverAnchorRect,
  menuHeight: number,
  viewportHeight: number,
  preferredPlacement: FixedPopoverPlacement,
  gap: number,
  padding: number,
  topInset: number,
): number => {
  const belowTop = anchorRect.bottom + gap;
  const aboveTop = anchorRect.top - gap - menuHeight;
  const preferredTop = preferredPlacement === 'bottom' ? belowTop : aboveTop;
  const alternateTop = preferredPlacement === 'bottom' ? aboveTop : belowTop;

  if (fixedPopoverFitsVertically(preferredTop, menuHeight, viewportHeight, padding, topInset)) {
    return preferredTop;
  }

  if (fixedPopoverFitsVertically(alternateTop, menuHeight, viewportHeight, padding, topInset)) {
    return alternateTop;
  }

  const minimumTop = Math.max(padding, topInset);
  return clamp(preferredTop, minimumTop, viewportHeight - padding - menuHeight);
};

/**
 * Horizontal placement on its own, for a popover that anchors its vertical axis
 * to an edge instead of to a measured height.
 */
export function computeFixedPopoverLeftInViewport(
  anchorRect: FixedPopoverAnchorRect,
  menuWidth: number,
  viewportWidth: number,
  options: { padding?: number; alignment?: FixedPopoverAlignment } = {},
): number {
  const { padding = DEFAULT_POPOVER_VIEWPORT_PADDING, alignment = 'start' } = options;

  // Without a measured right edge an end-aligned menu has nothing to align
  // to, so it degrades to the start edge rather than to a wrong position.
  const preferredLeft = alignment === 'end' && typeof anchorRect.right === 'number'
    ? anchorRect.right - menuWidth
    : anchorRect.left;

  return clampFixedPopoverLeftInViewport(
    preferredLeft,
    menuWidth,
    viewportWidth,
    padding,
  );
}

export function computeFixedPopoverPositionInViewport(
  anchorRect: FixedPopoverAnchorRect,
  menuWidth: number,
  menuHeight: number,
  viewport: FixedPopoverViewport,
  options: FixedPopoverPositionOptions = {},
): { top: number; left: number } {
  const {
    gap = 6,
    padding = DEFAULT_POPOVER_VIEWPORT_PADDING,
    topInset = 0,
    preferredPlacement = 'bottom',
    alignment = 'start',
  } = options;

  return {
    top: clampFixedPopoverTopInViewport(
      anchorRect,
      menuHeight,
      viewport.height,
      preferredPlacement,
      gap,
      padding,
      topInset,
    ),
    left: computeFixedPopoverLeftInViewport(anchorRect, menuWidth, viewport.width, {
      padding,
      alignment,
    }),
  };
}

export function clampFixedPopoverLeft(
  preferredLeft: number,
  menuWidth: number,
  padding = DEFAULT_POPOVER_VIEWPORT_PADDING,
): number {
  return clampFixedPopoverLeftInViewport(
    preferredLeft,
    menuWidth,
    window.innerWidth,
    padding,
  );
}

/**
 * Prefer opening below the anchor; if that overflows the bottom, flip above when possible;
 * otherwise pin within the viewport (menu taller than viewport should use max-height + scroll).
 */
export function clampFixedPopoverTop(
  anchorRect: DOMRectReadOnly,
  menuHeight: number,
  gap = 6,
  padding = DEFAULT_POPOVER_VIEWPORT_PADDING,
): number {
  return clampFixedPopoverTopInViewport(
    anchorRect,
    menuHeight,
    window.innerHeight,
    'bottom',
    gap,
    padding,
    0,
  );
}

export function computeFixedPopoverPosition(
  anchorRect: DOMRectReadOnly,
  menuWidth: number,
  menuHeight: number,
  gap = 6,
  padding = DEFAULT_POPOVER_VIEWPORT_PADDING,
): { top: number; left: number } {
  return computeFixedPopoverPositionInViewport(
    anchorRect,
    menuWidth,
    menuHeight,
    { width: window.innerWidth, height: window.innerHeight },
    { gap, padding },
  );
}
