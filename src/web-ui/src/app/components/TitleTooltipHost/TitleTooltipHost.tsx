import React, { useEffect, useRef } from 'react';
import './TitleTooltipHost.scss';

const SHOW_DELAY_MS = 400;
const SCROLL_SETTLE_MS = 240;
const VIEWPORT_MARGIN = 8;
const GAP = 6;

// Monaco's find-widget buttons only carry `aria-label` (their `title`
// attribute is set conditionally on internal heading nodes), so the host
// also matches labelled elements inside the editor chrome.
const TOOLTIP_SELECTOR = '[title], .find-widget [aria-label], .monaco-editor [aria-label]';

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

    const hide = (): void => {
      if (showTimer !== undefined) {
        window.clearTimeout(showTimer);
        showTimer = undefined;
      }
      target = null;
      bubble.setAttribute('data-visible', 'false');
    };

    const show = (): void => {
      if (!target) return;
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
      const withLabel = node.closest<HTMLElement>(TOOLTIP_SELECTOR);
      if (!withLabel || withLabel === target) return;
      hide();
      target = withLabel;
      showTimer = window.setTimeout(show, SHOW_DELAY_MS);
    };

    const onOut = (event: MouseEvent): void => {
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
    document.addEventListener('wheel', onScrollInterrupt, { capture: true, passive: true });
    document.addEventListener('scroll', onScrollInterrupt, true);
    window.addEventListener('blur', onInterrupt);

    return () => {
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('mousedown', onInterrupt, true);
      document.removeEventListener('wheel', onScrollInterrupt, true);
      document.removeEventListener('scroll', onScrollInterrupt, true);
      window.removeEventListener('blur', onInterrupt);
      if (showTimer !== undefined) {
        window.clearTimeout(showTimer);
      }
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
