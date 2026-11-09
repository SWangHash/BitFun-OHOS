import React, { useEffect, useRef } from 'react';
import './TitleTooltipHost.scss';

const SHOW_DELAY_MS = 400;
const SCROLL_SETTLE_MS = 240;
const VIEWPORT_MARGIN = 8;
const GAP = 6;

// Serves `[title]` elements in app chrome. Editor-internal labelled elements
// (find-widget buttons, fold glyphs) are owned by the dedicated editor chrome
// hover layer and must not be matched here: the overlap duplicated every
// chrome hint on OHOS and pinned when ArkWeb dropped the mouseout (issue
// #432).
const TOOLTIP_SELECTOR = '[title]';

function readTooltipText(element: HTMLElement): string {
  return element.getAttribute('title') ?? element.getAttribute('aria-label') ?? '';
}

/**
 * ArkWeb (OHOS) does not render native `title` attribute tooltips, which
 * leaves Monaco find-widget buttons and fold-margin hints without any hover
 * feedback on OHOS PC. This host delegates mouseover to `[title]` elements
 * and renders one shared bubble. Desktop runtimes keep native tooltips and
 * do not mount this component.
 */
export const TitleTooltipHost: React.FC = () => {
  const bubbleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const bubble = bubbleRef.current;
    if (!bubble) {
      return undefined;
    }

    let target: HTMLElement | null = null;
    let showTimer: number | undefined;
    let settleTimer: number | undefined;
    let scrolling = false;
    const observer = new MutationObserver(handleTargetRemoval);

    const hide = (): void => {
      if (showTimer !== undefined) {
        window.clearTimeout(showTimer);
        showTimer = undefined;
      }
      target = null;
      observer.disconnect();
      bubble.setAttribute('data-visible', 'false');
    };

    // Monaco can replace a hovered gutter action without emitting mouseout.
    function handleTargetRemoval(): void {
      if (target && !target.isConnected) hide();
    }

    const show = (): void => {
      showTimer = undefined;
      if (!target?.isConnected) {
        hide();
        return;
      }
      const text = readTooltipText(target);
      if (!text) {
        hide();
        return;
      }
      bubble.textContent = text;
      const rect = target.getBoundingClientRect();
      const bubbleRect = bubble.getBoundingClientRect();
      const left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(rect.left, window.innerWidth - bubbleRect.width - VIEWPORT_MARGIN),
      );
      const below = rect.bottom + GAP;
      const top = below + bubbleRect.height > window.innerHeight - VIEWPORT_MARGIN
        ? Math.max(VIEWPORT_MARGIN, rect.top - bubbleRect.height - GAP)
        : below;
      bubble.style.left = `${Math.round(left)}px`;
      bubble.style.top = `${Math.round(top)}px`;
      bubble.setAttribute('data-visible', 'true');
    };

    const onOver = (event: MouseEvent): void => {
      // Browsers re-run hover hit testing while a scroll area moves content
      // under a stationary pointer. Ignoring that synthetic hover keeps the
      // bubble closed until the scroll gesture has settled.
      if (scrolling) return;
      const node = event.target instanceof Node ? event.target : null;
      if (!(node instanceof HTMLElement)) return;
      if (bubble.contains(node)) return;
      if (node.closest('[data-bitfun-tooltip-trigger]')) {
        hide();
        return;
      }
      const withLabel = node.closest<HTMLElement>(TOOLTIP_SELECTOR);
      if (!withLabel) {
        hide();
        return;
      }
      // The editor chrome hover layer (monacoChromeI18n) owns the find-widget
      // buttons and the fold-margin glyphs: it localizes their labels and
      // hides its bubble on leave. Serving the same elements here showed a
      // second bubble for every chrome hint and stayed pinned when ArkWeb
      // dropped the synthetic mouseout (issue #432).
      if (withLabel.closest('.find-widget, .margin-view-overlays')) {
        hide();
        return;
      }
      // An iframe's title names the frame for assistive tech; it is not a
      // hover hint. A bubble pinned to the frame's whole rect is noise
      // (miniapp runner iframes carry the app name, issue #457/#475).
      if (withLabel.tagName === 'IFRAME') {
        hide();
        return;
      }
      if (withLabel === target) return;
      hide();
      target = withLabel;
      observer.observe(document.documentElement, { childList: true, subtree: true });
      showTimer = window.setTimeout(show, SHOW_DELAY_MS);
    };

    const onOut = (event: MouseEvent): void => {
      if (!target) return;
      const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (next && target.contains(next)) return;
      hide();
    };

    // Pointer-event interrupts. ArkWeb can swallow the synthesized mouse
    // sequence (mouseout, touch-driven mousedown), which left a shown bubble
    // pinned until the next mouseover replaced it — every reported
    // never-disappearing tooltip (#432/#457/#475) followed this gap. Pointer
    // events are the native unified input stream and are not synthesized, so
    // they stay deliverable where the mouse events do not. Only the
    // low-frequency pointerout/pointerdown are hooked: a document-wide
    // pointermove listener ran on every pointer move and measurably janked
    // window maximize/restore on device.
    const onPointerOut = (event: PointerEvent): void => {
      if (!target) return;
      const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (next && target.contains(next)) return;
      hide();
    };

    const onInterrupt = (): void => {
      hide();
    };

    const onScrollInterrupt = (): void => {
      hide();
      scrolling = true;
      if (settleTimer !== undefined) {
        window.clearTimeout(settleTimer);
      }
      settleTimer = window.setTimeout(() => {
        settleTimer = undefined;
        scrolling = false;
      }, SCROLL_SETTLE_MS);
    };

    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('mousedown', onInterrupt, true);
    document.addEventListener('pointerout', onPointerOut, true);
    document.addEventListener('pointerdown', onInterrupt, true);
    document.addEventListener('wheel', onScrollInterrupt, { capture: true, passive: true });
    document.addEventListener('scroll', onScrollInterrupt, true);
    window.addEventListener('blur', onInterrupt);

    return () => {
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('mousedown', onInterrupt, true);
      document.removeEventListener('pointerout', onPointerOut, true);
      document.removeEventListener('pointerdown', onInterrupt, true);
      document.removeEventListener('wheel', onScrollInterrupt, true);
      document.removeEventListener('scroll', onScrollInterrupt, true);
      window.removeEventListener('blur', onInterrupt);
      hide();
      if (settleTimer !== undefined) {
        window.clearTimeout(settleTimer);
      }
    };
  }, []);

  return (
    <div
      ref={bubbleRef}
      className="bitfun-title-tooltip-host"
      data-visible="false"
      role="tooltip"
      aria-hidden="true"
      data-bitfun-component="title-tooltip"
      data-bitfun-part="root"
    />
  );
};

export default TitleTooltipHost;
