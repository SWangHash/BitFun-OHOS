// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { xtermAppearanceAdapter } from '@/infrastructure/appearance/adapters/XtermAppearanceAdapter';
import Terminal from './Terminal';

/**
 * jsdom cannot lay out an xterm viewport, but keyboard handling does not need one:
 * `terminal.open()` only has to attach the helper textarea that receives the key
 * events. Cell measurement, observers and WebGL are stubbed so the real component
 * and the real key handler are what runs here.
 */
function stubBrowserSurface(): void {
  if (!window.matchMedia) {
    (window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }

  const fakeContext = {
    font: '',
    measureText: () => ({ width: 8 }),
    fillText: () => {},
    save: () => {},
    restore: () => {},
    clearRect: () => {},
    setTransform: () => {},
    scale: () => {},
    fillRect: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
  HTMLCanvasElement.prototype.getContext = (() => fakeContext) as never;

  class NoopObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): [] {
      return [];
    }
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopObserver;
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = NoopObserver;
}

function applyTerminalAppearance(): void {
  const colors = { background: '#000000', foreground: '#ffffff', cursor: '#ffffff' };
  xtermAppearanceAdapter.apply(
    { surfaces: { terminal: colors, output: colors } } as never,
    undefined,
    {} as never,
  );
}

function press(textarea: HTMLElement, init: { key: string; keyCode: number }): void {
  const event = new KeyboardEvent('keydown', {
    key: init.key,
    code: init.key,
    keyCode: init.keyCode,
    which: init.keyCode,
    bubbles: true,
    cancelable: true,
    composed: true,
  } as KeyboardEventInit);
  textarea.dispatchEvent(event);
  textarea.dispatchEvent(
    new KeyboardEvent('keyup', {
      key: init.key,
      code: init.key,
      keyCode: init.keyCode,
      which: init.keyCode,
      bubbles: true,
      cancelable: true,
      composed: true,
    } as KeyboardEventInit),
  );
}

describe('Terminal keyboard input', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const onData = vi.fn();

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    stubBrowserSurface();
    applyTerminalAppearance();
    onData.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<Terminal onData={onData} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function helperTextarea(): HTMLElement {
    const textarea = container.querySelector<HTMLElement>('.xterm-helper-textarea');
    if (!textarea) {
      throw new Error('xterm helper textarea was not attached');
    }
    return textarea;
  }

  it('sends arrow keys that arrive with a normal key code', () => {
    press(helperTextarea(), { key: 'ArrowUp', keyCode: 38 });
    press(helperTextarea(), { key: 'ArrowDown', keyCode: 40 });

    expect(onData.mock.calls).toEqual([['\x1b[A'], ['\x1b[B']]);
  });

  it('sends arrow keys that arrive with an IME key code', () => {
    // ArkWeb reports 229 for keydown events inside an IME session, and xterm gives
    // up on that code. Without a fallback the shell never sees the press, so history
    // navigation needs an extra press for every dropped one.
    press(helperTextarea(), { key: 'ArrowUp', keyCode: 229 });
    press(helperTextarea(), { key: 'ArrowDown', keyCode: 229 });

    expect(onData.mock.calls).toEqual([['\x1b[A'], ['\x1b[B']]);
  });

  it('leaves key codes that are not IME reports to xterm', () => {
    press(helperTextarea(), { key: 'a', keyCode: 65 });

    expect(onData.mock.calls).toEqual([['a']]);
  });
});
