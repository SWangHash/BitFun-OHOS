import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DesignSystemProvider, Tooltip } from "../dist/index.js";

test("Tooltip renders only the trigger until it is shown", () => {
  const markup = renderToStaticMarkup(
    createElement(
      Tooltip,
      { content: "Open settings" },
      createElement("button", { type: "button" }, "Settings"),
    ),
  );

  assert.match(markup, /<button type="button">Settings<\/button>/);
  assert.doesNotMatch(markup, /role="tooltip"/);
});

test("DesignSystemProvider owns shared tooltip delay and portal configuration", () => {
  const markup = renderToStaticMarkup(
    createElement(
      DesignSystemProvider,
      { tooltipDelay: 0, portalHost: null },
      createElement(
        Tooltip,
        { content: "Rename", placement: "right" },
        createElement("button", { type: "button" }, "Rename"),
      ),
    ),
  );

  assert.match(markup, /<button type="button">Rename<\/button>/);
});

test("Tooltip owns delayed opening, viewport flipping, and pointer-anchored closing", async () => {
  const source = await readFile(
    new URL("../src/components/Tooltip/Tooltip.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /DEFAULT_TOOLTIP_DELAY_MS = 450/);
  assert.match(source, /WARM_WINDOW_MS/);
  assert.match(source, /determineBestPlacement/);
  assert.match(source, /applyBoundaryConstraints/);
  assert.match(source, /followCursor/);
  assert.match(source, /aria-describedby/);
  assert.match(source, /role="tooltip"/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /useDesignSystem/);
  assert.match(source, /<Portal/);
  // Leaving the trigger hides immediately; only a pointer that moves into the
  // tooltip itself keeps it open.
  assert.match(source, /if \(!keepsPointerInside\(event\)\) hideTooltip\(\);/);
  assert.doesNotMatch(source, /INTERACTIVE_HIDE_DELAY_MS/);
});

test("Interactive content stays reachable across the placement gap", async () => {
  const source = await readFile(
    new URL("../src/components/Tooltip/Tooltip.tsx", import.meta.url),
    "utf8",
  );
  const styles = await readFile(
    new URL("../src/components/Tooltip/Tooltip.module.css", import.meta.url),
    "utf8",
  );

  // A pointer cannot jump the placement gap, so leaving the trigger would hide
  // the tooltip before the pointer ever reaches its content.
  assert.match(source, /function getBridgeStyle\(placement: TooltipPlacement\)/);
  assert.match(source, /return \{ bottom: -GAP, left: 0, right: 0, height: GAP \};/);
  assert.match(source, /return \{ right: -GAP, top: 0, bottom: 0, width: GAP \};/);
  assert.match(source, /interactive && !followCursor && isShown \? \(/);
  assert.match(source, /data-bitfun-part="bridge"/);
  assert.match(source, /style=\{getBridgeStyle\(layout\.placement\)\}/);
  // The corridor belongs to the tooltip surface so the trigger's own mouseleave
  // reports a target inside the pair.
  assert.match(styles, /\.bridge \{[^}]*position: absolute;[^}]*pointer-events: auto;/s);
});

test("Tooltip closes on scroll and refuses to reopen until the gesture settles", async () => {
  const source = await readFile(
    new URL("../src/components/Tooltip/Tooltip.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const SCROLL_SUPPRESS_MS = 300;/);
  assert.match(source, /if \(Date\.now\(\) < scrollSuppressUntilRef\.current\) return;/);
  assert.match(source, /scrollSuppressUntilRef\.current = Date\.now\(\) \+ SCROLL_SUPPRESS_MS;/);
  assert.match(source, /hideCurrentRef\.current\(\);/);
  assert.match(source, /addEventListener\("scroll", onScroll, \{ capture: true, passive: true \}\)/);
  // Scrolling the tooltip's own content must not close it.
  assert.match(source, /tooltipRef\.current\?\.contains\(target\)/);
});

test("Tooltip only opens for an aimed pointer and never paints a corner slot", async () => {
  const source = await readFile(
    new URL("../src/components/Tooltip/Tooltip.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const POINTER_INTENT_MS = 200;/);
  // Content sliding under a stationary pointer reports a hover nobody aimed at.
  assert.match(source, /if \(event && !pointedRecently\(element\.ownerDocument\)\) return;/);
  assert.match(source, /function pointedRecently\(ownerDocument: Document\): boolean/);
  assert.match(source, /return lastMoveAt >= lastGestureAt && Date\.now\(\) - lastMoveAt <= POINTER_INTENT_MS;/);
  assert.match(source, /function noteContentMovement\(ownerDocument: Document\): void/);
  // Touch drags and compat mouse events are the gesture, not pointer intent.
  assert.match(source, /sourceCapabilities\?\.firesTouchEvents/);
  // A detached or scrolled-away trigger must close its bubble instead of being
  // boundary-clamped into a viewport corner far from the pointer.
  assert.match(source, /function isAnchorPlaceable\(triggerRect: DOMRect\): boolean/);
  assert.match(source, /if \(!triggerRef\.current\.isConnected \|\| !isAnchorPlaceable\(triggerRect\)\) \{/);
  assert.match(source, /hideCurrentRef\.current\(\);\s*return;/);
  // A gesture spans more than the scroll events it emits.
  assert.match(source, /addEventListener\("wheel", onGesture, \{ capture: true, passive: true \}\)/);
  assert.match(source, /addEventListener\("touchmove", onGesture, \{ capture: true, passive: true \}\)/);
});

test("Tooltip styling uses only public surface, geometry, and elevation tokens", async () => {
  const styles = await readFile(
    new URL("../src/components/Tooltip/Tooltip.module.css", import.meta.url),
    "utf8",
  );

  assert.match(styles, /--bitfun-overlay-tooltip-max-inline-size/);
  assert.match(styles, /--bitfun-overlay-tooltip-arrow-size/);
  assert.match(styles, /--bitfun-color-surface-raised/);
  assert.match(styles, /--bitfun-color-border-subtle/);
  assert.match(styles, /--bitfun-shadow-sm/);
  assert.match(styles, /--bitfun-layer-tooltip/);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}/i);
});
