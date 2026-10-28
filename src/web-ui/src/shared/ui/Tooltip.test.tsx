// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tooltip } from '@bitfun/ui';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('interactive tooltip pointer transfer', () => {
  let host: HTMLDivElement;
  let root: Root;

  const tooltip = () => document.querySelector<HTMLElement>('[role="tooltip"]');

  /**
   * React derives mouseenter/mouseleave from delegated over/out pairs, so the
   * pointer is reported the way a browser reports it: one event naming the
   * element the pointer left and the one it entered.
   */
  const pointerEnter = (element: Element) => act(() => {
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
  });

  const pointerLeaveTo = (element: Element, relatedTarget: Element | null) => act(() => {
    element.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget }));
  });

  const reveal = () => {
    act(() => vi.advanceTimersByTime(500));
    act(() => vi.advanceTimersByTime(20));
  };

  const renderTooltip = (interactive: boolean) => act(() => root.render(
    <Tooltip content={'Remember approval, limited to:\nsrc/*'} placement="top" interactive={interactive}>
      <button type="button">Always allow this scope</button>
    </Tooltip>,
  ));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.querySelector('[data-bitfun-overlay-host="true"]')?.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps the content open when the pointer crosses the placement gap', () => {
    renderTooltip(true);
    const trigger = host.querySelector('button')!;
    pointerEnter(trigger);
    reveal();

    const popup = tooltip()!;
    const bridge = popup.querySelector<HTMLElement>('[data-bitfun-part="bridge"]');
    // The gap between trigger and bubble is part of the tooltip surface, so the
    // trigger's leave reports a target that already belongs to the pair.
    expect(bridge).not.toBeNull();

    pointerLeaveTo(trigger, bridge);
    reveal();
    expect(tooltip()).toBe(popup);

    pointerLeaveTo(popup, document.body);
    reveal();
    expect(tooltip()).toBeNull();
  });

  it('still closes immediately when the content is not meant to be entered', () => {
    renderTooltip(false);
    const trigger = host.querySelector('button')!;
    pointerEnter(trigger);
    reveal();

    const popup = tooltip()!;
    expect(popup.querySelector('[data-bitfun-part="bridge"]')).toBeNull();

    pointerLeaveTo(trigger, popup);
    reveal();
    expect(tooltip()).toBeNull();
  });
});
