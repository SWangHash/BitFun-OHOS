// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TitleTooltipHost } from './TitleTooltipHost';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('TitleTooltipHost', () => {
  let host: HTMLDivElement;
  let fixture: HTMLDivElement;
  let root: Root | null;

  beforeEach(async () => {
    vi.useFakeTimers();
    host = document.createElement('div');
    fixture = document.createElement('div');
    document.body.append(host, fixture);
    root = createRoot(host);
    await act(async () => root?.render(<TitleTooltipHost />));
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    host.remove();
    fixture.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function titledButton(text = 'Fold region') {
    const button = document.createElement('button');
    button.title = text;
    fixture.append(button);
    return button;
  }

  function hover(element: HTMLElement) {
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  }

  function visibleTooltip() {
    return host.querySelector<HTMLElement>('[role="tooltip"][data-visible="true"]');
  }

  async function advance(milliseconds = 400) {
    await act(async () => vi.advanceTimersByTimeAsync(milliseconds));
  }

  it.each(['title', 'find-widget'] as const)('keeps the delayed fallback for %s controls', async kind => {
    let button: HTMLElement;
    if (kind === 'title') {
      button = titledButton('Fold region');
    } else {
      const findWidget = document.createElement('div');
      findWidget.className = 'find-widget';
      button = document.createElement('button');
      button.setAttribute('aria-label', 'Next match');
      button.setAttribute('custom-hover', 'true');
      findWidget.append(button);
      fixture.append(findWidget);
    }

    hover(button);
    await advance(399);
    expect(visibleTooltip()).toBeNull();
    await advance(1);
    expect(visibleTooltip()?.textContent).toBe(kind === 'title' ? 'Fold region' : 'Next match');

    button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: fixture }));
    expect(visibleTooltip()).toBeNull();
  });

  it('leaves controls with a shared tooltip owner to that tooltip', async () => {
    const normal = titledButton();
    hover(normal);
    await advance();
    expect(visibleTooltip()).not.toBeNull();

    const gutter = document.createElement('div');
    gutter.className = 'gutter monaco-editor';
    const button = document.createElement('a');
    button.setAttribute('aria-label', 'Revert Block');
    button.setAttribute('data-bitfun-tooltip-trigger', '');
    const icon = document.createElement('span');
    button.append(icon);
    gutter.append(button);
    fixture.append(gutter);

    hover(icon);
    expect(visibleTooltip()).toBeNull();
    await advance(1_000);
    expect(visibleTooltip()).toBeNull();
  });

  it('closes when a new pointer target has no tooltip label', async () => {
    hover(titledButton());
    await advance();
    expect(visibleTooltip()).not.toBeNull();

    // DOM replacement can prevent the original target from emitting mouseout.
    hover(fixture);
    expect(visibleTooltip()).toBeNull();
    await advance(1_000);
    expect(visibleTooltip()).toBeNull();
  });

  it('cancels a pending tooltip when its target is removed without mouseout', async () => {
    const button = titledButton();
    hover(button);
    await advance(200);

    await act(async () => button.remove());
    // Reconnecting the same node must not revive the hover that removal cancelled.
    // Otherwise the delayed isConnected guard alone would make this test pass.
    fixture.append(button);
    await advance(1_000);

    expect(visibleTooltip()).toBeNull();
  });

  it('closes a visible tooltip when its target is replaced and follows the replacement', async () => {
    const button = titledButton();
    hover(button);
    await advance();
    expect(visibleTooltip()).not.toBeNull();

    const replacement = document.createElement('button');
    replacement.title = 'Unfold region';
    await act(async () => button.replaceWith(replacement));
    expect(visibleTooltip()).toBeNull();

    hover(replacement);
    await advance();
    expect(visibleTooltip()?.textContent).toBe('Unfold region');
  });

  it('observes removals only while tracking a target and releases tracking on unmount', async () => {
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    expect(observe).not.toHaveBeenCalled();

    const button = titledButton();
    hover(button);
    expect(observe).toHaveBeenCalledOnce();
    button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: fixture }));
    expect(disconnect).toHaveBeenCalled();

    hover(button);
    expect(observe).toHaveBeenCalledTimes(2);
    disconnect.mockClear();
    await act(async () => root?.unmount());
    root = null;
    expect(disconnect).toHaveBeenCalledOnce();
    await advance(1_000);
    expect(visibleTooltip()).toBeNull();
  });
});
