// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tooltip } from './Tooltip';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Tooltip geometry recalc while visible', () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let trigger: HTMLButtonElement;
  let triggerRect: DOMRect;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (
      window.setTimeout(() => callback(performance.now()), 16)
    ));
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle));
    triggerRect = new DOMRect(100, 100, 24, 24);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.hasAttribute('data-testid') && this.dataset.testid === 'trigger') {
        return triggerRect;
      }
      // The bubble itself: an approximate fixed-size hint box.
      return new DOMRect(80, 80, 24, 24);
    });

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function bubble(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-bitfun-component="tooltip"][data-bitfun-part="root"]');
  }

  async function show() {
    trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await act(async () => vi.advanceTimersByTimeAsync(450));
    await act(async () => vi.advanceTimersByTimeAsync(16));
  }

  it('re-measures on pointerover after a window geometry change', async () => {
    await act(async () => root?.render(
      <Tooltip content="hint" placement="top">
        <button type="button" data-testid="trigger">trigger</button>
      </Tooltip>,
    ));
    trigger = document.querySelector('[data-testid="trigger"]') as HTMLButtonElement;

    await show();
    expect(bubble()).not.toBeNull();
    // top = trigger.top(100) - bubbleH(24) - gap(8)
    expect(bubble()?.style.top).toBe('68px');

    // Window geometry changed and ArkWeb kept the layout stale for a while:
    // the trigger now sits lower. No resize event marks the settle.
    triggerRect = new DOMRect(100, 300, 24, 24);

    // A stale measurement must not be corrected without a signal...
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(bubble()?.style.top).toBe('68px');

    // ...but any boundary crossing while visible re-measures (issue #443:
    // the first hover after unmaximize computed its position from the
    // maximized-era trigger rect and stayed offset until the next hover).
    trigger.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    await act(async () => vi.advanceTimersByTimeAsync(16));
    // top = trigger.top(300) - bubbleH(24) - gap(8)
    expect(bubble()?.style.top).toBe('268px');
  });
});
