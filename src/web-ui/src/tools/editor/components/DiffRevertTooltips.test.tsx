// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as monaco from 'monaco-editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiffRevertTooltips } from './DiffRevertTooltips';
import { TitleTooltipHost } from '@/app/components/TitleTooltipHost/TitleTooltipHost';

vi.mock('@/infrastructure/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key === 'editor.diffEditor.revertChangeTooltip' ? '撤销此处更改' : key,
  }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('DiffRevertTooltips', () => {
  let container: HTMLDivElement;
  let editorContainer: HTMLDivElement;
  let buttons: HTMLDivElement;
  let root: Root | null;
  let editor: monaco.editor.IStandaloneDiffEditor;
  let onScroll: (() => void) | undefined;
  let disposeScroll: ReturnType<typeof vi.fn>;
  let clock = Date.UTC(2026, 9, 20);

  beforeEach(() => {
    vi.useFakeTimers();
    // Each fixture starts beyond the shared Tooltip's warm hover window.
    clock += 10_000;
    vi.setSystemTime(clock);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (
      window.setTimeout(() => callback(performance.now()), 16)
    ));
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(80, 80, 24, 24));

    container = document.createElement('div');
    editorContainer = document.createElement('div');
    editorContainer.className = 'monaco-diff-editor';
    const gutter = document.createElement('div');
    gutter.className = 'gutter monaco-editor';
    const gutterItem = document.createElement('div');
    gutterItem.className = 'gutterItem';
    buttons = document.createElement('div');
    buttons.className = 'buttons';
    gutterItem.append(buttons);
    gutter.append(gutterItem);
    editorContainer.append(gutter);
    document.body.append(container, editorContainer);
    root = createRoot(container);
    onScroll = undefined;
    disposeScroll = vi.fn();
    editor = {
      getContainerDomNode: () => editorContainer,
      getModifiedEditor: () => ({
        onDidScrollChange: (listener: () => void) => {
          onScroll = listener;
          return { dispose: disposeScroll };
        },
      }),
    } as unknown as monaco.editor.IStandaloneDiffEditor;
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container.remove();
    editorContainer.remove();
    document.querySelector('[data-bitfun-overlay-host="true"]')?.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function revertButton(icon: 'arrow-right' | 'discard', label = 'Revert Block') {
    const item = document.createElement('div');
    item.className = 'action-item';
    const button = document.createElement('a');
    button.className = `action-label codicon codicon-${icon}`;
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', label);
    button.tabIndex = 0;
    item.append(button);
    return { item, button };
  }

  async function render(withTitleHost = false) {
    await act(async () => root?.render(<>
      <DiffRevertTooltips editor={editor} />
      {withTitleHost && <TitleTooltipHost />}
    </>));
  }

  async function advance(milliseconds: number) {
    await act(async () => vi.advanceTimersByTimeAsync(milliseconds));
  }

  async function hover(button: HTMLElement) {
    await act(async () => {
      button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('mouseenter'));
    });
  }

  async function showTooltip(button: HTMLElement) {
    await hover(button);
    await advance(450);
    await advance(16);
  }

  function tooltip() {
    return document.querySelector<HTMLElement>('[role="tooltip"][data-bitfun-state="visible"]');
  }

  it.each(['arrow-right', 'discard'] as const)(
    'shows the shared delayed tooltip for %s and describes the original control',
    async (icon) => {
      const { item, button } = revertButton(icon);
      buttons.append(item);
      await render(true);

      await hover(button);
      await advance(449);
      expect(document.querySelector('[data-bitfun-component="tooltip"]')).toBeNull();
      await advance(1);
      await advance(16);

      expect(tooltip()?.textContent).toBe('撤销此处更改');
      expect(tooltip()?.getAttribute('data-bitfun-component')).toBe('tooltip');
      expect(button.getAttribute('aria-describedby')).toBe(tooltip()?.id);
      expect(button.getAttribute('aria-label')).toBe('Revert Block');
      expect(document.querySelector('[data-bitfun-component="title-tooltip"][data-visible="true"]')).toBeNull();

      await act(async () => button.dispatchEvent(new MouseEvent('mouseleave')));
      expect(tooltip()).toBeNull();
      expect(button.hasAttribute('aria-describedby')).toBe(false);

      await act(async () => button.focus());
      await advance(450);
      await advance(16);
      expect(tooltip()?.textContent).toBe('撤销此处更改');
      await act(async () => button.blur());
      expect(tooltip()).toBeNull();
    },
  );

  it('closes on click without consuming the existing revert action', async () => {
    const { item, button } = revertButton('arrow-right');
    const revert = vi.fn();
    item.addEventListener('click', event => {
      revert();
      event.stopPropagation();
    });
    buttons.append(item);
    await render();
    await showTooltip(button);
    expect(tooltip()).not.toBeNull();

    await act(async () => button.click());

    expect(revert).toHaveBeenCalledOnce();
    expect(tooltip()).toBeNull();
    expect(button.hasAttribute('aria-describedby')).toBe(false);

    await hover(button);
    await act(async () => button.click());
    await advance(1_000);
    expect(revert).toHaveBeenCalledTimes(2);
    expect(tooltip()).toBeNull();
  });

  it('follows dynamically replaced selection controls and dismisses removed targets', async () => {
    const block = revertButton('arrow-right');
    buttons.append(block.item);
    await render();
    await hover(block.button);
    await advance(200);

    const selection = revertButton('discard', 'Revert Selection');
    await act(async () => buttons.replaceChildren(selection.item));
    await advance(1_000);
    expect(tooltip()).toBeNull();
    expect(block.button.hasAttribute('aria-describedby')).toBe(false);

    await showTooltip(selection.button);
    expect(tooltip()?.textContent).toBe('撤销此处更改');
    expect(selection.button.getAttribute('aria-describedby')).toBe(tooltip()?.id);

    await act(async () => selection.item.remove());
    expect(tooltip()).toBeNull();
    expect(selection.button.hasAttribute('aria-describedby')).toBe(false);
  });

  it('dismisses on editor scrolling and releases subscriptions and tooltips on unmount', async () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const { item, button } = revertButton('discard');
    buttons.append(item);
    await render();
    await showTooltip(button);
    expect(tooltip()).not.toBeNull();

    await act(async () => onScroll?.());
    expect(tooltip()).toBeNull();
    expect(button.hasAttribute('aria-describedby')).toBe(false);

    await showTooltip(button);
    expect(tooltip()).not.toBeNull();
    await act(async () => root?.unmount());
    root = null;

    expect(tooltip()).toBeNull();
    expect(button.hasAttribute('aria-describedby')).toBe(false);
    expect(disposeScroll).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();

    await hover(button);
    await advance(1_000);
    expect(tooltip()).toBeNull();
  });
});
