// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type AnyProps = Record<string, unknown> & { children?: React.ReactNode };

const mocks = vi.hoisted(() => ({
  addContext: vi.fn(),
  evalInWebview: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
  listen: vi.fn(),
  unlisteners: [] as Array<ReturnType<typeof vi.fn>>,
}));

let browserState: Record<string, unknown>;

vi.mock('@bitfun/ui', () => ({
  Icon: () => <i />,
  IconButton: ({ icon, ...props }: AnyProps) => <button {...props}>{icon as React.ReactNode}</button>,
  Input: ({ leading, onValueChange, ...props }: AnyProps) => (
    <label>
      {leading as React.ReactNode}
      <input
        {...props}
        onChange={(event) => (onValueChange as ((value: string) => void) | undefined)?.(event.target.value)}
      />
    </label>
  ),
  OverflowText: ({ children, ...props }: AnyProps) => <span {...props}>{children}</span>,
  Tooltip: ({ children }: AnyProps) => <>{children}</>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/shared/context-system', () => ({
  useContextStore: () => mocks.addContext,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen,
}));

vi.mock('./useEmbeddedBrowserWebview', () => ({
  useEmbeddedBrowserWebview: () => browserState,
}));

vi.mock('./BrowserPreview', () => ({
  BrowserPreview: () => null,
}));

import BrowserPanel from './BrowserPanel';

describe('BrowserPanel element inspector', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    mocks.evalInWebview.mockClear();
    mocks.listen.mockReset();
    mocks.unlisteners.length = 0;
    mocks.listen.mockImplementation(async () => {
      const unlisten = vi.fn();
      mocks.unlisteners.push(unlisten);
      return unlisten;
    });
    browserState = {
      currentUrl: 'https://example.com/',
      error: null,
      evalInWebview: mocks.evalInWebview,
      getCurrentUrl: () => 'https://example.com/',
      getWebviewLabel: () => 'browser-test',
      goBack: vi.fn(),
      goForward: vi.fn(),
      hasWebview: () => true,
      inputValue: 'https://example.com/',
      isLoading: false,
      isTauri: true,
      loadUrl: vi.fn(),
      pageLoadRevision: 0,
      previewBounds: null,
      previewUrl: null,
      reload: vi.fn(),
      setInputValue: vi.fn(),
      viewportRef: { current: null },
      webviewLabel: 'browser-test',
    };
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  const inspectorButton = () => container.querySelector<HTMLButtonElement>(
    '[aria-label="browserView.startElementSelection"], [aria-label="browserView.stopElementSelection"]',
  );

  it('resets the toolbar and listeners after even a fast new-document load', async () => {
    await act(async () => root.render(<BrowserPanel isActive />));

    await act(async () => {
      inspectorButton()?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(inspectorButton()?.getAttribute('aria-pressed')).toBe('true');
    expect(inspectorButton()?.getAttribute('aria-label')).toBe('browserView.stopElementSelection');
    expect(mocks.unlisteners).toHaveLength(2);

    browserState.pageLoadRevision = 1;
    await act(async () => root.render(<BrowserPanel isActive />));

    expect(inspectorButton()?.getAttribute('aria-pressed')).toBe('false');
    expect(inspectorButton()?.getAttribute('aria-label')).toBe('browserView.startElementSelection');
    expect(mocks.evalInWebview.mock.calls.at(-1)?.[0]).toContain('__bitfun_inspector_cancel');
    expect(mocks.unlisteners[0]).toHaveBeenCalledOnce();
    expect(mocks.unlisteners[1]).toHaveBeenCalledOnce();
  });
});
