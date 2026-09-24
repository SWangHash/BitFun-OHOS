/**
 * Intercepts native `title` tooltips and re-renders them as themed tooltips.
 *
 * Native title bubbles are painted by the WebView itself, so page CSS cannot
 * theme them. On pointer entry we synchronously strip the `title` attribute:
 * Chromium evaluates native tooltips lazily (roughly one second after hover),
 * so a synchronous strip prevents the native bubble from ever appearing. The
 * same themed `.bitfun-tooltip` chrome used by the Tooltip component (driven
 * by `--bf-appearance-token-*` variables) is then shown near the cursor. Like
 * the native bubble, it is anchored where the pointer was when it appeared and
 * does not follow later pointer movement inside the element.
 *
 * The attribute is restored as soon as the pointer leaves, so DevTools, tests,
 * and accessibility tooling still observe the original value. While the
 * pointer stays inside the element (after a click or scroll dismissed the
 * bubble) the attribute intentionally stays stripped to avoid the WebView
 * re-evaluating it and flashing the native bubble.
 *
 * Keyboard focus is intentionally left to the native tooltip: focus-driven
 * native bubbles only appear during keyboard navigation, and stripping
 * `title` on focus would briefly remove the accessible name of icon-only
 * controls.
 *
 * Add `data-native-title-keep` to an element to opt itself out of
 * interception.
 */

import { getAppearanceOverlayHost } from '@/infrastructure/appearance/runtime/AppearanceOverlayHost';

const TITLE_SELECTOR = '[title]';
const OPT_OUT_SELECTOR = 'iframe, [data-native-title-keep]';
const SHOW_DELAY_MS = 450;
const WARM_WINDOW_MS = 300;
const VIEWPORT_PADDING = 8;
const CURSOR_OFFSET_X = 12;
const CURSOR_OFFSET_Y = 8;
const CURSOR_GAP = 8;

interface ActiveTitleTarget {
  element: Element;
  title: string;
}

let installed = false;
let warmUntil = 0;
let active: ActiveTitleTarget | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let anchor: { x: number; y: number } | null = null;
let bubble: HTMLDivElement | null = null;

function findTitledTarget(node: EventTarget | null): Element | null {
  if (!(node instanceof Element)) return null;
  const el = node.closest(TITLE_SELECTOR);
  if (!el || el.matches(OPT_OUT_SELECTOR)) return null;
  const title = el.getAttribute('title');
  if (!title || !title.trim()) return null;
  return el;
}

function cancelShowTimer(): void {
  if (showTimer !== null) {
    clearTimeout(showTimer);
    showTimer = null;
  }
}

function restoreActiveTitle(): void {
  if (!active) return;
  active.element.setAttribute('title', active.title);
  active = null;
}

function hideBubble(): void {
  if (bubble && bubble.isConnected) {
    bubble.remove();
    if (Date.now() < warmUntil + WARM_WINDOW_MS) {
      warmUntil = Date.now() + WARM_WINDOW_MS;
    }
  }
  bubble = null;
}

/** Hide the bubble but keep the title stripped while the pointer remains. */
function suppressActive(): void {
  cancelShowTimer();
  hideBubble();
}

/** Fully dismiss: restore the attribute and reset tracking state. */
function dismissActive(): void {
  cancelShowTimer();
  restoreActiveTitle();
  hideBubble();
  anchor = null;
}

function ensureBubble(): HTMLDivElement {
  if (bubble && bubble.isConnected) return bubble;
  bubble = document.createElement('div');
  bubble.className = 'bitfun-tooltip bitfun-tooltip--bottom bitfun-tooltip--visible';
  bubble.setAttribute('data-bitfun-component', 'tooltip');
  bubble.setAttribute('data-bitfun-part', 'root');
  bubble.setAttribute('data-bitfun-placement', 'bottom');
  bubble.setAttribute('data-bitfun-state', 'visible');

  const arrow = document.createElement('div');
  arrow.className = 'bitfun-tooltip__arrow';
  arrow.setAttribute('data-bitfun-component', 'tooltip');
  arrow.setAttribute('data-bitfun-part', 'arrow');
  arrow.setAttribute('aria-hidden', 'true');

  const content = document.createElement('div');
  content.className = 'bitfun-tooltip__content';
  content.setAttribute('data-bitfun-component', 'tooltip');
  content.setAttribute('data-bitfun-part', 'content');

  const body = document.createElement('div');
  body.className = 'bitfun-tooltip__body';
  body.setAttribute('data-bitfun-component', 'tooltip');
  body.setAttribute('data-bitfun-part', 'body');
  // Native title tooltips honor newline characters; keep that behavior.
  body.style.whiteSpace = 'pre-line';

  content.appendChild(body);
  bubble.appendChild(arrow);
  bubble.appendChild(content);
  getAppearanceOverlayHost().appendChild(bubble);
  return bubble;
}

function positionBubble(): void {
  if (!bubble || !bubble.isConnected || !anchor) return;
  const rect = bubble.getBoundingClientRect();
  let left = anchor.x + CURSOR_OFFSET_X;
  let top = anchor.y + CURSOR_OFFSET_Y;
  if (left + rect.width > window.innerWidth - VIEWPORT_PADDING) {
    left = anchor.x - rect.width - CURSOR_GAP;
    if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;
  }
  if (top + rect.height > window.innerHeight - VIEWPORT_PADDING) {
    top = anchor.y - rect.height - CURSOR_GAP;
    if (top < VIEWPORT_PADDING) top = VIEWPORT_PADDING;
  }
  bubble.style.left = `${Math.round(left)}px`;
  bubble.style.top = `${Math.round(top)}px`;
}

function showBubble(text: string): void {
  const el = ensureBubble();
  const body = el.querySelector<HTMLElement>('.bitfun-tooltip__body');
  if (body) body.textContent = text;
  positionBubble();
}

function onPointerOver(event: PointerEvent): void {
  const el = findTitledTarget(event.target);
  if (!el) return;
  if (active && active.element === el) return;
  if (active) restoreActiveTitle();
  suppressActive();
  const title = el.getAttribute('title') ?? '';
  active = { element: el, title };
  el.removeAttribute('title');
  anchor = { x: event.clientX, y: event.clientY };
  const delay = Date.now() < warmUntil ? 0 : SHOW_DELAY_MS;
  showTimer = setTimeout(() => {
    showTimer = null;
    if (!active) return;
    // Anchor where the pointer is at show time, like the native bubble; after
    // appearing, later pointer movement no longer moves it (see onPointerMove).
    showBubble(active.title);
  }, delay);
}

function onPointerMove(event: PointerEvent): void {
  // While waiting to show, keep the anchor under the pointer so the bubble
  // appears where the cursor actually is. Once shown, the anchor is frozen
  // and the bubble no longer follows the pointer, matching native titles.
  if (!active || (bubble && bubble.isConnected)) return;
  const target = event.target;
  if (!(target instanceof Element) || !active.element.contains(target)) return;
  anchor = { x: event.clientX, y: event.clientY };
}

function onPointerOut(event: PointerEvent): void {
  if (!active) return;
  const target = event.target;
  if (!(target instanceof Element) || !active.element.contains(target)) return;
  const related = event.relatedTarget;
  if (related instanceof Element && active.element.contains(related)) return;
  dismissActive();
}

function onPointerDown(event: PointerEvent): void {
  if (!active) return;
  const target = event.target;
  if (target instanceof Element && active.element.contains(target)) {
    suppressActive();
  }
}

function onScroll(): void {
  if (active) suppressActive();
}

function onWindowBlur(): void {
  if (active) suppressActive();
}

function startObserver(): void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'attributes' || mutation.attributeName !== 'title') continue;
      const el = mutation.target;
      if (!(el instanceof Element)) continue;
      if (!active || el !== active.element) continue;
      const next = el.getAttribute('title');
      if (next === null) continue;
      // JS re-set the title while the pointer is on the element; keep it
      // stripped and refresh the themed bubble content instead.
      active = { element: el, title: next };
      el.removeAttribute('title');
      if (bubble && bubble.isConnected) {
        const body = bubble.querySelector<HTMLElement>('.bitfun-tooltip__body');
        if (body) body.textContent = next;
        positionBubble();
      }
    }
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['title'],
    subtree: true,
  });
}

/**
 * Install the global interception. Idempotent. Call once during startup,
 * before the first React paint, so no native tooltip can appear at any point.
 */
export function installNativeTitleTooltip(): void {
  if (installed) return;
  installed = true;

  window.addEventListener('pointerover', onPointerOver, { capture: true });
  window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  window.addEventListener('pointerout', onPointerOut, { capture: true });
  window.addEventListener('pointercancel', onPointerOut, { capture: true });
  window.addEventListener('pointerdown', onPointerDown, { capture: true });
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('blur', onWindowBlur);
  startObserver();
}
