// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BitFunDesignSystemProvider } from './BitFunDesignSystemProvider';

const appearanceState = vi.hoisted(() => ({ mode: 'dark' as 'dark' | 'light' }));
const hostState = vi.hoisted(() => ({ openHarmony: false }));

vi.mock('@/infrastructure/runtime/environment', async importOriginal => {
  const actual = await importOriginal<
    typeof import('@/infrastructure/runtime/environment')
  >();
  return { ...actual, isOpenHarmonyRuntime: () => hostState.openHarmony };
});

vi.mock('@/infrastructure/appearance', () => ({
  useAppearance: () => ({ current: { mode: appearanceState.mode } }),
}));

vi.mock('@/infrastructure/appearance/runtime/AppearanceOverlayHost', () => ({
  getAppearanceOverlayHost: () => document.body,
}));

vi.mock('@/infrastructure/i18n', () => ({
  useI18n: () => ({
    currentLanguage: 'en',
    t: (key: string) => key,
  }),
}));

describe('BitFunDesignSystemProvider', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    appearanceState.mode = 'dark';
    hostState.openHarmony = false;
    document.documentElement.removeAttribute('style');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.documentElement.removeAttribute('style');
    vi.unstubAllGlobals();
  });

  it('maps product appearance and desktop density onto the global package token root', () => {
    act(() => {
      root.render(
        <BitFunDesignSystemProvider>
          <span>content</span>
        </BitFunDesignSystemProvider>,
      );
    });

    expect(document.documentElement.getAttribute('data-bitfun-design-system-root')).toBe('');
    expect(document.documentElement.getAttribute('data-color-scheme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-contrast')).toBe('standard');
    expect(document.documentElement.getAttribute('data-density')).toBe('compact');

    appearanceState.mode = 'light';
    act(() => {
      root.render(
        <BitFunDesignSystemProvider>
          <span>content</span>
        </BitFunDesignSystemProvider>,
      );
    });

    expect(document.documentElement.getAttribute('data-color-scheme')).toBe('light');
  });

  it('hands the desktop scrollbar thickness to the ArkWeb host', () => {
    hostState.openHarmony = true;
    act(() => {
      root.render(
        <BitFunDesignSystemProvider>
          <span>content</span>
        </BitFunDesignSystemProvider>,
      );
    });

    expect(document.documentElement.style.getPropertyValue('--bitfun-scrollbar-width')).toBe('10px');
  });

  it('leaves the scrollbar token to the design system on other hosts', () => {
    act(() => {
      root.render(
        <BitFunDesignSystemProvider>
          <span>content</span>
        </BitFunDesignSystemProvider>,
      );
    });

    expect(document.documentElement.style.getPropertyValue('--bitfun-scrollbar-width')).toBe('');
  });

  it('tracks the operating system high-contrast preference', () => {
    let matches = true;
    let changeListener: (() => void) | undefined;
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      get matches() {
        return matches;
      },
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === 'change') changeListener = listener;
      }),
      removeEventListener: vi.fn(),
    })));

    act(() => {
      root.render(
        <BitFunDesignSystemProvider>
          <span>content</span>
        </BitFunDesignSystemProvider>,
      );
    });
    expect(document.documentElement.getAttribute('data-contrast')).toBe('high');

    matches = false;
    act(() => changeListener?.());
    expect(document.documentElement.getAttribute('data-contrast')).toBe('standard');
  });
});
