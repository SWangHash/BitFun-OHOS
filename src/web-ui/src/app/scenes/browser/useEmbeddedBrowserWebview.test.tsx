// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useEmbeddedBrowserWebview } from './useEmbeddedBrowserWebview';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => {}),
  listen: vi.fn(),
}));
vi.mock('@/infrastructure/api/service-api/ApiClient', () => ({ api: { invoke: mocks.invoke } }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));

const log = { warn: vi.fn(), error: vi.fn() };
function invokeCount(command: string): number {
  return mocks.invoke.mock.calls.filter(call => call[0] === command).length;
}
let browser: ReturnType<typeof useEmbeddedBrowserWebview>;
function Harness({ active }: { active: boolean }) {
  browser = useEmbeddedBrowserWebview({ defaultUrl: 'https://example.com', isVisible: active, labelPrefix: 'test', log });
  return <div ref={browser.viewportRef} />;
}

let root: Root;
let container: HTMLDivElement;
let viewportBounds: DOMRect;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoke.mockImplementation(async () => {});
  mocks.listen.mockImplementation(async () => () => {});
  vi.stubGlobal('__TAURI_INTERNALS__', { invoke: () => {} });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  viewportBounds = new DOMRect(0, 0, 200, 200);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => viewportBounds);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(active = true) {
  await act(async () => root.render(<Harness active={active} />));
}
async function mutate(change: () => void) {
  await act(async () => { change(); });
}
function overlay() {
  const node = document.createElement('div');
  node.setAttribute('data-bitfun-native-webview-occlusion', '');
  node.getBoundingClientRect = () => new DOMRect(50, 50, 100, 100);
  return node;
}

it('keeps creation, navigation, resize and activation hidden while any floating panel overlaps', async () => {
  const first = overlay();
  const second = overlay();
  document.body.append(first, second);
  await render();
  expect(invokeCount('browser_webview_show')).toBe(0);
  expect(invokeCount('browser_webview_set_focus')).toBe(0);

  await act(async () => browser.loadUrl('https://example.com/next'));
  await mutate(() => { viewportBounds = new DOMRect(0, 0, 250, 250); window.dispatchEvent(new Event('resize')); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });
  await render(false);
  await render(true);
  expect(invokeCount('browser_webview_show')).toBe(0);
  expect(invokeCount('browser_webview_set_focus')).toBe(0);
  await mutate(() => first.remove());
  expect(invokeCount('browser_webview_show')).toBe(0);
  await mutate(() => second.remove());
  expect(invokeCount('browser_webview_show')).toBe(1);
  expect(invokeCount('browser_webview_set_focus')).toBe(0);
});

it('responds to an already mounted panel becoming visible and restores only the active tab', async () => {
  const panel = overlay();
  panel.style.visibility = 'hidden';
  document.body.append(panel);
  await render();
  expect(invokeCount('browser_webview_show')).toBe(1);
  await mutate(() => { panel.style.visibility = 'visible'; });
  expect(invokeCount('browser_webview_hide')).toBe(1);
  await render(false);
  await mutate(() => panel.remove());
  expect(invokeCount('browser_webview_show')).toBe(1);
  await render(true);
  expect(invokeCount('browser_webview_show')).toBe(2);
});

it('does not show or focus when navigation finishes after deactivation', async () => {
  await render();
  mocks.invoke.mockClear();
  let finishNavigation!: () => void;
  mocks.invoke.mockImplementation(async (...args) => {
    if (args[0] === 'browser_webview_navigate') await new Promise<void>(resolve => { finishNavigation = resolve; });
  });
  let navigation!: Promise<void>;
  await act(async () => { navigation = browser.loadUrl('https://example.com/slow'); });
  await render(false);
  await act(async () => { finishNavigation(); await navigation; });
  expect(invokeCount('browser_webview_show')).toBe(0);
  expect(invokeCount('browser_webview_set_focus')).toBe(0);
});

it('releases temporary toolbar suppression after activation settles', async () => {
  await render();
  await mutate(() => window.dispatchEvent(new Event('toolbar-mode-activating')));
  expect(invokeCount('browser_webview_hide')).toBe(1);
  await act(async () => browser.loadUrl('https://example.com/next'));
  expect(invokeCount('browser_webview_show')).toBe(1);
  await mutate(() => window.dispatchEvent(new Event('toolbar-mode-activation-finished')));
  expect(invokeCount('browser_webview_show')).toBe(2);
});

it('keeps the old native rectangle occluded until the delayed bounds update completes', async () => {
  const panel = overlay();
  document.body.append(panel);
  await render();
  let finishBounds!: () => void;
  mocks.invoke.mockImplementation(async (...args) => {
    if (args[0] === 'browser_webview_set_bounds') await new Promise<void>(resolve => { finishBounds = resolve; });
  });
  await mutate(() => {
    viewportBounds = new DOMRect(500, 0, 200, 200);
    window.dispatchEvent(new Event('resize'));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });
  expect(invokeCount('browser_webview_show')).toBe(0);
  await act(async () => {
    finishBounds();
    await new Promise(resolve => setTimeout(resolve, 40));
  });
  expect(invokeCount('browser_webview_show')).toBe(1);
});

it('serializes resize updates and applies only the latest pending rectangle', async () => {
  await render();
  mocks.invoke.mockClear();
  let finishFirstBounds!: () => void;
  let boundsCallCount = 0;
  mocks.invoke.mockImplementation(async (...args) => {
    if (args[0] !== 'browser_webview_set_bounds') return;
    boundsCallCount += 1;
    if (boundsCallCount === 1) {
      await new Promise<void>(resolve => { finishFirstBounds = resolve; });
    }
  });

  await mutate(() => {
    viewportBounds = new DOMRect(0, 0, 300, 300);
    window.dispatchEvent(new Event('resize'));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(invokeCount('browser_webview_set_bounds')).toBe(1);
  expect(invokeCount('browser_webview_hide')).toBe(0);

  await mutate(() => {
    viewportBounds = new DOMRect(0, 0, 350, 350);
    window.dispatchEvent(new Event('resize'));
    viewportBounds = new DOMRect(0, 0, 400, 400);
    window.dispatchEvent(new Event('resize'));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(invokeCount('browser_webview_set_bounds')).toBe(1);

  await act(async () => {
    finishFirstBounds();
    await new Promise(resolve => setTimeout(resolve, 70));
  });
  const updates = mocks.invoke.mock.calls
    .filter(call => call[0] === 'browser_webview_set_bounds')
    .map(call => (call[1] as { request: { width: number; height: number } }).request);
  expect(updates.map(update => [update.width, update.height])).toEqual([
    [300, 300],
    [400, 400],
  ]);
  expect(invokeCount('browser_webview_show')).toBe(0);
});

it('does not invoke native APIs in the web surface', async () => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  await render();
  await act(async () => browser.loadUrl('https://example.com/next'));
  await mutate(() => document.body.append(overlay()));
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it.each(['pending', 'rejected'])('shows the first page even when script injection is %s', async (outcome) => {
  let pageLoadListener: ((event: { payload: { label: string; event: 'finished'; url: string } }) => void) | undefined;
  mocks.listen.mockImplementation(async (_event: string, listener: typeof pageLoadListener) => {
    pageLoadListener = listener;
    return () => {};
  });
  mocks.invoke.mockImplementation(async (command, args) => {
    if (command === 'browser_webview_create') {
      const { request } = args as { request: { label: string; url: string } };
      // A cached page can finish loading before the create command returns.
      pageLoadListener?.({ payload: { ...request, event: 'finished' } });
    }
    if (command === 'browser_webview_eval') {
      if (outcome === 'pending') return new Promise(() => {});
      throw new Error('Script execution failed');
    }
  });

  await render();
  expect(invokeCount('browser_webview_eval')).toBe(1);
  expect(invokeCount('browser_webview_show')).toBe(1);
  expect(browser.hasWebview()).toBe(true);
  expect(browser.error).toBeNull();
});

it('releases the page-load listener when native creation fails', async () => {
  const unlisten = vi.fn();
  mocks.listen.mockResolvedValue(unlisten);
  mocks.invoke.mockImplementation(async command => {
    if (command === 'browser_webview_create') throw new Error('Native controller unavailable');
  });

  await render();
  expect(unlisten).toHaveBeenCalledOnce();
  expect(browser.error).toBe('Native controller unavailable');
  expect(invokeCount('browser_webview_show')).toBe(0);
});

it('releases late listener registration without creating a view after unmount', async () => {
  const unlisten = vi.fn();
  let finishListening!: (listener: () => void) => void;
  mocks.listen.mockImplementation(() => new Promise<() => void>(resolve => { finishListening = resolve; }));

  await render();
  await act(async () => root.unmount());
  await act(async () => finishListening(unlisten));
  expect(unlisten).toHaveBeenCalledOnce();
  expect(invokeCount('browser_webview_create')).toBe(0);
});

it('injects scripts on each finished document, including initial load, reload and redirect', async () => {
  let pageLoadListener: ((event: { payload: { label: string; event: 'started' | 'finished'; url: string } }) => void) | undefined;
  mocks.listen.mockImplementation(async (_event: string, listener: typeof pageLoadListener) => {
    pageLoadListener = listener;
    return () => {};
  });

  await render();
  expect(pageLoadListener).toBeDefined();
  expect(invokeCount('browser_webview_eval')).toBe(0);

  // The first load and a reload keep the same URL; neither can be deduplicated by URL.
  for (const reload of [false, true]) {
    await act(async () => {
      if (reload) browser.reload();
      pageLoadListener?.({ payload: { label: browser.webviewLabel, event: 'started', url: 'https://example.com' } });
      pageLoadListener?.({ payload: { label: browser.webviewLabel, event: 'finished', url: 'https://example.com' } });
    });
    expect(invokeCount('browser_webview_eval')).toBe(reload ? 2 : 1);
  }

  await act(async () => browser.loadUrl('https://example.com/next'));
  await act(async () => {
    pageLoadListener?.({ payload: { label: browser.webviewLabel, event: 'started', url: 'https://example.com/next' } });
    pageLoadListener?.({ payload: { label: browser.webviewLabel, event: 'started', url: 'https://example.com/login' } });
  });
  expect(invokeCount('browser_webview_eval')).toBe(2);
  await act(async () => {
    pageLoadListener?.({ payload: { label: browser.webviewLabel, event: 'finished', url: 'https://example.com/login' } });
  });

  expect(invokeCount('browser_webview_eval')).toBe(3);
  expect(browser.currentUrl).toBe('https://example.com/login');
  expect(browser.isLoading).toBe(false);
  expect(browser.pageLoadRevision).toBe(4);
});

it('aligns native and preview edges at fractional DPI and applies a one-physical-pixel move', async () => {
  vi.stubGlobal('devicePixelRatio', 1.5);
  viewportBounds = new DOMRect(912.333374, 128.333343, 747, 938.333374);
  await render();
  const creation = mocks.invoke.mock.calls.find(call => call[0] === 'browser_webview_create')!;
  const { request } = creation[1] as { request: { x: number; y: number; width: number; height: number } };
  expect(request.x * 1.5).toBeCloseTo(1369);
  expect(request.y * 1.5).toBeCloseTo(193);
  expect((request.x + request.width) * 1.5).toBeCloseTo(2489);
  expect((request.y + request.height) * 1.5).toBeCloseTo(1600);
  expect(viewportBounds.left + browser.previewBounds!.left).toBeCloseTo(request.x);
  expect(viewportBounds.top + browser.previewBounds!.top).toBeCloseTo(request.y);
  expect(browser.previewBounds!.width).toBe(request.width);
  expect(browser.previewBounds!.height).toBe(request.height);

  mocks.invoke.mockClear();
  await mutate(() => {
    viewportBounds = new DOMRect(viewportBounds.left, viewportBounds.top + 2 / 3, viewportBounds.width, viewportBounds.height);
    window.dispatchEvent(new Event('resize'));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });
  const update = mocks.invoke.mock.calls.find(call => call[0] === 'browser_webview_set_bounds')!;
  expect(update).toBeDefined();
  const updated = (update[1] as { request: { y: number } }).request;
  expect(updated.y * 1.5).toBeCloseTo(194);
  expect(viewportBounds.top + browser.previewBounds!.top).toBeCloseTo(updated.y);
});

it('keeps the decoded preview beneath a popup without waiting for the next capture', async () => {
  vi.stubGlobal('Image', class { src = ''; decode = async () => {}; });
  mocks.invoke.mockImplementation(async command => command === 'browser_webview_capture_preview'
    ? { status: 'ready', dataUrl: 'data:image/jpeg;base64,preview' } : undefined);
  await render();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(browser.previewUrl).toBe('data:image/jpeg;base64,preview');
  await mutate(() => document.body.append(overlay()));
  expect(invokeCount('browser_webview_hide')).toBe(1);
  expect(browser.previewUrl).toBe('data:image/jpeg;base64,preview');
  await act(async () => browser.loadUrl('https://example.com/new-page'));
  expect(browser.previewUrl).toBeNull();
});
