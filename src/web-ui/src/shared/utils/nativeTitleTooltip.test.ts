/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function installInterceptor(): Promise<void> {
  vi.resetModules();
  const { installNativeTitleTooltip } = await import('./nativeTitleTooltip');
  installNativeTitleTooltip();
}

function dispatchPointer(type: string, target: Element, init: MouseEventInit = {}): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }));
}

function createTitledButton(title = 'Refresh view'): HTMLButtonElement {
  const button = document.createElement('button');
  button.setAttribute('title', title);
  document.body.appendChild(button);
  return button;
}

function getBubble(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.bitfun-tooltip');
}

describe('nativeTitleTooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('strips the native title and shows the themed tooltip chrome at the pointer', async () => {
    await installInterceptor();
    const button = createTitledButton();

    dispatchPointer('pointerover', button, { clientX: 40, clientY: 60 });

    // Stripped synchronously so the WebView never paints its own bubble.
    expect(button.hasAttribute('title')).toBe(false);
    expect(getBubble()).toBeNull();

    vi.advanceTimersByTime(450);

    const bubble = getBubble();
    expect(bubble).not.toBeNull();
    expect(bubble?.getAttribute('data-bitfun-component')).toBe('tooltip');
    expect(bubble?.getAttribute('data-bitfun-part')).toBe('root');
    expect(bubble?.getAttribute('data-bitfun-state')).toBe('visible');
    expect(bubble?.getAttribute('data-bitfun-placement')).toBe('bottom');
    expect(bubble?.classList.contains('bitfun-tooltip--bottom')).toBe(true);
    expect(bubble?.querySelector('.bitfun-tooltip__arrow')).not.toBeNull();
    expect(bubble?.querySelector('.bitfun-tooltip__body')?.textContent).toBe('Refresh view');
    expect(document.getElementById('bitfun-appearance-overlay-host')?.contains(bubble as Node)).toBe(true);
    expect(bubble?.style.left).toBe('52px');
    expect(bubble?.style.top).toBe('68px');
  });

  it('restores the title and removes the bubble when the pointer leaves', async () => {
    await installInterceptor();
    const button = createTitledButton();

    dispatchPointer('pointerover', button, { clientX: 40, clientY: 60 });
    vi.advanceTimersByTime(450);
    expect(getBubble()).not.toBeNull();

    dispatchPointer('pointerout', button);

    expect(button.getAttribute('title')).toBe('Refresh view');
    expect(getBubble()).toBeNull();
  });

  it('follows the pointer only until the tooltip appears, then freezes its anchor', async () => {
    await installInterceptor();
    const button = createTitledButton();

    dispatchPointer('pointerover', button, { clientX: 40, clientY: 60 });
    dispatchPointer('pointermove', button, { clientX: 100, clientY: 120 });
    vi.advanceTimersByTime(450);
    expect(getBubble()?.style.left).toBe('112px');
    expect(getBubble()?.style.top).toBe('128px');

    dispatchPointer('pointermove', button, { clientX: 300, clientY: 320 });

    expect(getBubble()?.style.left).toBe('112px');
    expect(getBubble()?.style.top).toBe('128px');
  });

  it('leaves opted-out elements to the native tooltip', async () => {
    await installInterceptor();
    const button = createTitledButton();
    button.setAttribute('data-native-title-keep', '');

    dispatchPointer('pointerover', button, { clientX: 40, clientY: 60 });
    vi.advanceTimersByTime(450);

    expect(button.getAttribute('title')).toBe('Refresh view');
    expect(getBubble()).toBeNull();
  });

  it('keeps a title set while hovering stripped and refreshes the bubble', async () => {
    await installInterceptor();
    const button = createTitledButton();

    dispatchPointer('pointerover', button, { clientX: 40, clientY: 60 });
    vi.advanceTimersByTime(450);

    button.setAttribute('title', 'Renamed action');
    await Promise.resolve();

    expect(button.hasAttribute('title')).toBe(false);
    expect(getBubble()?.querySelector('.bitfun-tooltip__body')?.textContent).toBe('Renamed action');
  });
});
