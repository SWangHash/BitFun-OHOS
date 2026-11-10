// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useEmbeddedBrowserWebview, type UseEmbeddedBrowserWebviewOptions } from './useEmbeddedBrowserWebview';
import { BROWSER_WEBVIEW_DOCUMENT_READY_EVENT, createBrowserPageLifecycleScript, type BrowserDocumentReadyPayload } from './browserPageLifecycleScript';

type PageLoadPayload = { label: string; url: string } &
  ({ event: 'started' | 'finished' } | { event: 'failed'; error: string });

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => {}),
  hostVisible: true,
  hostListeners: new Set<(visible: boolean) => void>(),
  pageLoadListeners: new Set<(event: { payload: PageLoadPayload }) => void>(),
  documentReadyListeners: new Set<(event: { payload: BrowserDocumentReadyPayload }) => void>(),
}));
vi.mock('./browserPageLifecycleScript', async importOriginal => {
  const actual = await importOriginal<typeof import('./browserPageLifecycleScript')>();
  return { ...actual, createBrowserPageLifecycleScript: vi.fn(actual.createBrowserPageLifecycleScript) };
});
vi.mock('@/infrastructure/runtime/windowVisibility', () => ({
  observeCurrentWindowVisibility: (changed: (visible: boolean) => void) => {
    mocks.hostListeners.add(changed);
    changed(mocks.hostVisible);
    return () => mocks.hostListeners.delete(changed);
  },
}));
vi.mock('@/infrastructure/api/service-api/ApiClient', () => ({ api: { invoke: mocks.invoke } }));
vi.mock('@tauri-apps/api/webview', () => ({
  Webview: {
    // The hook must never resolve a native page through Tauri's registry: OHOS
    // ArkUI pages are invisible to it, and the plugin rejects the API on mobile.
    getByLabel: () => { throw new Error('Webview API not available on mobile'); },
  },
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, handler: (event: { payload: PageLoadPayload | BrowserDocumentReadyPayload }) => void) => {
    if (name === BROWSER_WEBVIEW_DOCUMENT_READY_EVENT) {
      mocks.documentReadyListeners.add(handler);
      return () => mocks.documentReadyListeners.delete(handler);
    }
    if (name !== 'browser-webview-page-load') return () => {};
    mocks.pageLoadListeners.add(handler);
    return () => mocks.pageLoadListeners.delete(handler);
  },
}));

const log = { warn: vi.fn(), error: vi.fn() };
function invokeCount(command: string): number {
  return mocks.invoke.mock.calls.filter(call => call[0] === command).length;
}
function commandLabel(call: unknown[]): string | undefined {
  const request = (call[1] as { request?: { label?: string } } | undefined)?.request;
  return request?.label;
}
function labelledCount(command: string, label: string): number {
  return mocks.invoke.mock.calls.filter(call => call[0] === command && commandLabel(call) === label).length;
}
const showCount = (label?: string) => label === undefined ? invokeCount('browser_webview_show') : labelledCount('browser_webview_show', label);
const hideCount = (label?: string) => label === undefined ? invokeCount('browser_webview_hide') : labelledCount('browser_webview_hide', label);
const closeCount = () => invokeCount('browser_webview_close');
const focusCount = () => invokeCount('browser_webview_set_focus');
/** Reject the address probe the way a real host reports an unknown label. */
function webviewNotFound(label: string): Error {
  return new Error(`Webview not found: ${label}`);
}
let browser: ReturnType<typeof useEmbeddedBrowserWebview>;
function Harness({ active, targetId, manual = false, options }: {
  active: boolean;
  targetId?: string;
  manual?: boolean;
  options?: Partial<UseEmbeddedBrowserWebviewOptions>;
}) {
  browser = useEmbeddedBrowserWebview({ defaultUrl: 'https://example.com', isVisible: active, labelPrefix: 'test', log,
    targetId, openRequestId: targetId && !manual ? 'open-request' : undefined, conversationId: targetId ? 'owner' : undefined,
    ...options });
  return <div ref={browser.viewportRef} />;
}

let root: Root;
let container: HTMLDivElement;
let viewportBounds: DOMRect;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.hostVisible = true;
  mocks.hostListeners.clear();
  mocks.pageLoadListeners.clear();
  mocks.documentReadyListeners.clear();
  mocks.invoke.mockImplementation(async () => {});
  vi.stubGlobal('__TAURI__', {});
  // The hook detects the runtime through the IPC bridge, which OHOS exposes
  // without the global API namespace.
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
  vi.useRealTimers();
});

async function render(active = true) {
  await act(async () => root.render(<Harness active={active} />));
}
async function mutate(change: () => void) {
  await act(async () => { change(); });
}
function emitPageLoad(event: 'started' | 'finished', label = browser.webviewLabel) {
  for (const listener of mocks.pageLoadListeners) {
    listener({ payload: { label, event, url: 'https://example.com/slow' } });
  }
}
function emitDocumentReady(overrides: Partial<BrowserDocumentReadyPayload> = {}) {
  const sequence = vi.mocked(createBrowserPageLifecycleScript).mock.lastCall?.[1];
  if (sequence === undefined) throw new Error('No document lifecycle subscription');
  for (const listener of mocks.documentReadyListeners) {
    listener({ payload: { label: browser.webviewLabel, sequence, url: browser.currentUrl, ...overrides } });
  }
}
function overlay() {
  const node = document.createElement('div');
  node.setAttribute('data-bitfun-native-webview-occlusion', '');
  node.getBoundingClientRect = () => new DOMRect(50, 50, 100, 100);
  return node;
}

it('reattaches the exact session page after unmount without closing, recreating or navigating it', async () => {
  const label = 'test-browser';
  let currentUrl = 'https://example.com/form-in-progress';
  mocks.invoke.mockImplementation(async command => command === 'browser_get_url' ? currentUrl : undefined);
  await act(async () => root.render(<Harness active targetId={label} />));
  expect(browser.currentUrl).toBe(currentUrl);
  await act(async () => root.render(null));
  expect(hideCount()).toBe(1);
  expect(closeCount()).toBe(0);
  currentUrl = 'https://example.com/background-result';
  await act(async () => root.render(<Harness active targetId={label} />));
  expect(browser.currentUrl).toBe(currentUrl);
  expect(invokeCount('browser_get_url')).toBe(2);
  expect(mocks.invoke.mock.calls.some(([command]) => command === 'browser_webview_create' || command === 'browser_webview_navigate')).toBe(false);
  expect(showCount()).toBe(2);
});

it('shows a retained page while its native URL is temporarily unavailable', async () => {
  mocks.invoke.mockImplementation(async command => command === 'browser_get_url' ? '' : undefined);
  await act(async () => root.render(<Harness active targetId="test-browser" />));
  expect(showCount()).toBe(1);
  expect(browser.error).toBeNull();
  expect(browser.currentUrl).toBe('https://example.com');
  expect(browser.isLoading).toBe(true);
  expect(createBrowserPageLifecycleScript).not.toHaveBeenCalled();
  await mutate(() => emitPageLoad('started'));
  await mutate(() => emitPageLoad('finished'));
  expect(browser.currentUrl).toBe('https://example.com/slow');
  expect(browser.isLoading).toBe(false);
  expect(mocks.invoke.mock.calls.some(([command]) => command === 'browser_webview_navigate'
    || command === 'browser_webview_reload' || command === 'browser_webview_create')).toBe(false);
});

it('keeps an unreadable native page attached instead of creating a replacement', async () => {
  // ArkWeb rejects the address read until its node is attached, and a failed
  // navigation keeps reporting the failure. Neither means the page is gone.
  mocks.invoke.mockImplementation(async command => {
    if (command === 'browser_get_url') throw new Error('getUrl failed: BusinessError');
  });
  await act(async () => root.render(<Harness active targetId="unattached-page" />));
  expect(invokeCount('browser_webview_create')).toBe(0);
  expect(showCount('unattached-page')).toBe(1);
});

it('shows the retained native page and reports a failure that happened before attachment', async () => {
  mocks.invoke.mockImplementation(async command => {
    if (command === 'browser_get_url') throw new Error('Navigation failed: Could not connect');
  });
  await act(async () => root.render(<Harness active targetId="test-browser" />));
  expect(showCount()).toBe(1);
  expect(browser.error).toBe('Navigation failed: Could not connect');
  expect(invokeCount('browser_webview_create')).toBe(0);
});

it('switches presentation between independent native pages while retaining both', async () => {
  await act(async () => root.render(<Harness key="a" active targetId="page-a" />));
  await act(async () => root.render(<Harness key="b" active targetId="page-b" />));
  expect(hideCount('page-a')).toBe(1);
  expect(showCount('page-b')).toBe(1);
  expect(closeCount()).toBe(0);
  await act(async () => root.render(<Harness key="a" active targetId="page-a" />));
  expect(hideCount('page-b')).toBe(1);
  expect(showCount('page-a')).toBe(2);
});

it('ignores a late attachment from an unmounted conversation', async () => {
  let resolveA!: (url: string) => void;
  mocks.invoke.mockImplementation(async (command, args) => {
    if (command === 'browser_get_url' && commandLabel([command, args]) === 'page-a') {
      return new Promise<string>(resolve => { resolveA = resolve; });
    }
  });
  await act(async () => root.render(<Harness key="a" active targetId="page-a" />));
  await act(async () => root.render(<Harness key="b" active targetId="page-b" />));
  await act(async () => resolveA('https://example.com/a'));
  expect(showCount('page-a')).toBe(0);
  expect(hideCount('page-a')).toBe(0);
  expect(browser.webviewLabel).toBe('page-b');
});

it('does not recreate a host-owned target that was explicitly closed', async () => {
  mocks.invoke.mockImplementation(async command => {
    if (command === 'browser_get_url') throw webviewNotFound('closed-page');
  });
  await act(async () => root.render(<Harness active targetId="closed-page" />));
  expect(browser.error).toContain('Webview not found');
  expect(mocks.invoke.mock.calls.some(([command]) => command === 'browser_webview_create')).toBe(false);
});

it('creates a manually opened session page with its stable identity and keeps it on unmount', async () => {
  let created = false;
  mocks.invoke.mockImplementation(async command => {
    if (command === 'browser_get_url') {
      if (!created) throw webviewNotFound('manual-page');
      return 'https://example.com/manual';
    }
    if (command === 'browser_webview_create') created = true;
  });
  await act(async () => root.render(<Harness active targetId="manual-page" manual />));
  expect(mocks.invoke).toHaveBeenCalledWith('browser_webview_create', expect.objectContaining({
    request: expect.objectContaining({ label: 'manual-page', conversationId: 'owner' }),
  }));
  expect(browser.currentUrl).toBe('https://example.com/manual');
  await act(async () => root.render(null));
  expect(closeCount()).toBe(0);
});

it('keeps a retained page presented when agent target metadata cannot be updated', async () => {
  mocks.invoke.mockImplementation(async command => {
    if (command === 'browser_get_url') return 'https://example.com/live';
    if (command === 'browser_webview_set_agent_target_state') throw webviewNotFound('test-browser');
  });
  await act(async () => root.render(<Harness active targetId="test-browser" />));
  expect(browser.error).toBeNull();
  expect(showCount('test-browser')).toBe(1);
  expect(log.warn).toHaveBeenCalledWith('Update browser agent target state failed', expect.anything());
});

it('presents a newly created page when its address read is not ready yet', async () => {
  let created = false;
  mocks.invoke.mockImplementation(async command => {
    if (command === 'browser_get_url') {
      if (!created) throw webviewNotFound('manual-page');
      throw new Error('getUrl failed: BusinessError');
    }
    if (command === 'browser_webview_create') created = true;
  });
  await act(async () => root.render(<Harness active targetId="manual-page" manual />));
  expect(invokeCount('browser_webview_create')).toBe(1);
  expect(browser.error).toBeNull();
  expect(showCount('manual-page')).toBe(1);
});

it('reattaches a manual page whose first creation finishes after a rapid session switch', async () => {
  let finishCreation!: () => void;
  let created = false;
  mocks.invoke.mockImplementation(async command => {
    if (command === 'browser_get_url') {
      if (!created) throw webviewNotFound('pending-manual-page');
      return '';
    }
    if (command === 'browser_webview_create') {
      await new Promise<void>(resolve => { finishCreation = resolve; });
      created = true;
    }
  });
  await act(async () => root.render(<Harness key="first" active targetId="pending-manual-page" manual />));
  await act(async () => root.render(<Harness key="next" active targetId="pending-manual-page" manual />));
  await act(async () => finishCreation());
  expect(mocks.invoke.mock.calls.filter(([command]) => command === 'browser_webview_create')).toHaveLength(1);
  expect(browser.error).toBeNull();
  expect(showCount()).toBe(1);
  expect(closeCount()).toBe(0);
});

it('retains an ArkUI page missing from the Tauri inventory across session remounts', async () => {
  const label = 'arkui-manual-page';
  mocks.invoke.mockImplementation(async command => command === 'browser_get_url'
    ? 'https://example.com/filled-form' : undefined);
  await act(async () => root.render(<Harness active targetId={label} manual />));
  await act(async () => root.render(null));
  await act(async () => root.render(<Harness active targetId={label} manual />));
  expect(browser.error).toBeNull();
  expect(browser.currentUrl).toBe('https://example.com/filled-form');
  expect(invokeCount('browser_webview_create')).toBe(0);
  expect(invokeCount('browser_webview_navigate')).toBe(0);
  expect(invokeCount('browser_webview_close')).toBe(0);
  expect(invokeCount('browser_webview_show')).toBe(2);
});

async function hostVisibility(visible: boolean) {
  await mutate(() => {
    mocks.hostVisible = visible;
    mocks.hostListeners.forEach(changed => changed(visible));
  });
}

it('stops preview capture while minimized and resumes without changing the active interval', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('Image', class { src = ''; decode = async () => {}; });
  let frame = 0;
  mocks.invoke.mockImplementation(async command => command === 'browser_webview_capture_preview'
    ? { status: 'ready', dataUrl: `data:image/jpeg;base64,${frame++}` } : undefined);
  const captures = () => mocks.invoke.mock.calls.filter(call => call[0] === 'browser_webview_capture_preview').length;
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(captures()).toBe(1);
  await hostVisibility(false);
  expect(hideCount()).toBe(1);
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(captures()).toBe(1);
  await hostVisibility(true);
  expect(showCount()).toBe(2);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(captures()).toBe(2);
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(captures()).toBe(3);
});

it('restores only active, unoccluded views and does not steal focus on window restoration', async () => {
  await render();
  await hostVisibility(false);
  await render(false);
  await hostVisibility(true);
  expect(showCount()).toBe(1);
  const panel = overlay();
  await mutate(() => document.body.append(panel));
  await render(true);
  await hostVisibility(false);
  await hostVisibility(true);
  expect(showCount()).toBe(1);
  await mutate(() => panel.remove());
  expect(showCount()).toBe(2);
  expect(focusCount()).toBe(0);
});

it('keeps a newly created view hidden when the host is already minimized', async () => {
  mocks.hostVisible = false;
  await render();
  expect(showCount()).toBe(0);
  expect(focusCount()).toBe(0);
  await hostVisibility(true);
  expect(showCount()).toBe(1);
  expect(focusCount()).toBe(0);
});

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

it('keeps the loading state until the native page load settles, not until the command resolves', async () => {
  await render();
  expect(mocks.pageLoadListeners.size).toBe(1);

  // Mounting starts the first navigation; let that page settle.
  await mutate(() => emitPageLoad('finished'));
  expect(browser.isLoading).toBe(false);

  await act(async () => browser.loadUrl('https://example.com/slow'));
  // Creating or navigating the native view resolves before the document loads.
  expect(browser.isLoading).toBe(true);

  await mutate(() => emitPageLoad('finished'));
  expect(browser.isLoading).toBe(false);

  await mutate(() => emitPageLoad('started', 'some-other-view'));
  expect(browser.isLoading).toBe(false);

  await mutate(() => emitPageLoad('started'));
  expect(browser.isLoading).toBe(true);
  await mutate(() => emitPageLoad('finished'));
  expect(browser.isLoading).toBe(false);
});

it('observes a fast page finishing before native creation returns', async () => {
  mocks.invoke.mockImplementation(async (command, args) => {
    if (command === 'browser_webview_create') {
      const { request: { label } } = args as { request: { label: string } };
      emitPageLoad('started', label);
      emitPageLoad('finished', label);
    }
  });
  await render();
  expect(browser.hasWebview()).toBe(true);
  expect(browser.isLoading).toBe(false);
});

it('clears the loading state and listener when native creation fails', async () => {
  mocks.invoke.mockImplementation(async command => {
    if (command === 'browser_webview_create') throw new Error('Browser creation unavailable');
  });
  await render();
  expect(browser.isLoading).toBe(false);
  expect(browser.error).toBe('Browser creation unavailable');
  expect(mocks.pageLoadListeners.size).toBe(0);
});

it('settles a native navigation failure without reloading and clears it on manual navigation', async () => {
  await render();
  await mutate(() => emitPageLoad('started'));
  await mutate(() => {
    for (const listener of mocks.pageLoadListeners) {
      listener({ payload: { label: browser.webviewLabel, event: 'failed', url: '', error: 'Could not connect' } });
    }
  });
  expect(browser.isLoading).toBe(false);
  expect(browser.error).toBe('Could not connect');
  await mutate(() => emitDocumentReady());
  expect(browser.error).toBe('Could not connect');
  expect(mocks.invoke.mock.calls.some(([command]) => command === 'browser_webview_reload')).toBe(false);
  await act(async () => browser.loadUrl('https://example.com/slow'));
  await mutate(() => emitPageLoad('started'));
  await mutate(() => emitPageLoad('finished'));
  expect(browser.error).toBeNull();
  expect(browser.isLoading).toBe(false);
});

it('keeps reload pending until the native page finishes and settles failed reloads', async () => {
  await render();
  await mutate(() => emitPageLoad('finished'));
  await mutate(() => browser.reload());
  expect(browser.isLoading).toBe(true);
  expect(mocks.invoke).toHaveBeenCalledWith('browser_webview_reload', {
    request: { label: browser.webviewLabel },
  });
  await mutate(() => emitPageLoad('finished'));
  expect(browser.isLoading).toBe(false);
  mocks.invoke.mockImplementation(async command => {
    if (command === 'browser_webview_reload') throw new Error('Reload failed');
  });
  await mutate(() => browser.reload());
  expect(browser.isLoading).toBe(false);
});

it.each(['goBack', 'goForward'] as const)('settles %s from document readiness when native Finished is missing', async action => {
  await render();
  await mutate(() => emitPageLoad('finished'));
  await mutate(() => browser[action]());
  await mutate(() => emitPageLoad('started'));
  expect(browser.isLoading).toBe(true);
  expect(createBrowserPageLifecycleScript).toHaveBeenLastCalledWith(browser.webviewLabel, expect.any(Number));
  await mutate(() => emitDocumentReady());
  expect(browser.isLoading).toBe(false);
  // A delayed duplicate native commit must reconcile the same ready URL again.
  await mutate(() => emitPageLoad('started'));
  await mutate(() => emitDocumentReady());
  expect(browser.isLoading).toBe(false);
});

it('rejects readiness from an older navigation or a different browser view', async () => {
  await render();
  await mutate(() => emitPageLoad('started'));
  const previousSequence = vi.mocked(createBrowserPageLifecycleScript).mock.lastCall![1];
  await act(async () => browser.loadUrl('https://example.com/new'));
  await mutate(() => emitDocumentReady({ sequence: previousSequence, url: 'https://example.com/old' }));
  expect(browser.isLoading).toBe(true);
  expect(browser.currentUrl).toBe('https://example.com/new');
  await mutate(() => emitPageLoad('started'));
  await mutate(() => emitDocumentReady({ label: 'another-view' }));
  expect(browser.isLoading).toBe(true);
  await mutate(() => emitDocumentReady());
  expect(browser.isLoading).toBe(false);
});

it('does not probe the previous document while navigation is still waiting to commit', async () => {
  vi.useFakeTimers();
  await render();
  await mutate(() => emitPageLoad('finished'));
  vi.mocked(createBrowserPageLifecycleScript).mockClear();
  await act(async () => browser.loadUrl('https://example.com/new'));
  await act(async () => vi.advanceTimersByTimeAsync(2500));
  expect(browser.isLoading).toBe(true);
  expect(createBrowserPageLifecycleScript).not.toHaveBeenCalled();
});

it('updates the address for completed same-document history changes and releases both listeners', async () => {
  await render();
  await mutate(() => emitPageLoad('finished'));
  await mutate(() => emitDocumentReady({ url: 'https://example.com/previous#section' }));
  expect(browser.currentUrl).toBe('https://example.com/previous#section');
  expect(browser.inputValue).toBe(browser.currentUrl);
  await act(async () => root.render(null));
  expect(mocks.pageLoadListeners.size).toBe(0);
  expect(mocks.documentReadyListeners.size).toBe(0);
});

it('drops the loading state when no native page load event ever arrives', async () => {
  vi.useFakeTimers();
  await render();
  await act(async () => browser.loadUrl('https://example.com/stuck'));
  expect(browser.isLoading).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(browser.isLoading).toBe(false);
});

it('stops an in-flight page load through the page loader and ends the loading state', async () => {
  await render();
  const label = browser.webviewLabel;
  await mutate(() => emitPageLoad('finished'));

  await act(async () => browser.loadUrl('https://example.com/slow'));
  expect(browser.isLoading).toBe(true);

  mocks.invoke.mockClear();
  await act(async () => { browser.stopLoading(); });
  expect(browser.isLoading).toBe(false);
  expect(mocks.invoke).toHaveBeenCalledWith('browser_webview_eval', {
    request: { label, script: 'window.stop()' },
  });
});

it('keeps the stop action available and surfaces a failed stop request', async () => {
  await render();
  mocks.invoke.mockImplementation(async (command, args) => {
    if (command === 'browser_webview_eval'
      && (args as { request: { script: string } }).request.script === 'window.stop()') {
      throw new Error('Stop unavailable');
    }
  });
  await mutate(() => browser.stopLoading());
  expect(browser.isLoading).toBe(true);
  expect(browser.error).toBe('Stop unavailable');
  expect(log.warn).toHaveBeenCalledWith('Stop browser page load failed', expect.any(Error));
});

it.each(['resolve', 'reject'] as const)('ignores a stale stop %s after a new navigation starts', async outcome => {
  await render();
  let finishStop!: () => void;
  mocks.invoke.mockImplementation(async (command, args) => {
    if (command === 'browser_webview_eval'
      && (args as { request: { script: string } }).request.script === 'window.stop()') {
      await new Promise<void>((resolve, reject) => {
        finishStop = outcome === 'resolve' ? resolve : () => reject(new Error('Stale stop failure'));
      });
    }
  });
  await mutate(() => browser.stopLoading());
  await act(async () => browser.loadUrl('https://example.com/new'));
  await mutate(finishStop);
  expect(browser.isLoading).toBe(true);
  expect(browser.error).toBeNull();
  await mutate(() => emitPageLoad('finished'));
  expect(browser.isLoading).toBe(false);
});

it('does not invoke native APIs in the web surface', async () => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  await render();
  await act(async () => browser.loadUrl('https://example.com/next'));
  await mutate(() => document.body.append(overlay()));
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it('adopts and displays the automation page without recreating or navigating its filled form', async () => {
  const label = 'embedded-browser-panel-view-agent-existing';
  const options = { webviewLabel: label, adoptExisting: true };
  await act(async () => root.render(<Harness active options={options} />));
  expect(browser.webviewLabel).toBe(label);
  expect(invokeCount('browser_webview_create')).toBe(0);
  expect(invokeCount('browser_webview_navigate')).toBe(0);
  expect(mocks.invoke).toHaveBeenCalledWith('browser_webview_set_bounds', {
    request: expect.objectContaining({ label, width: 200, height: 200 }),
  });
  expect(showCount(label)).toBe(1);

  await act(async () => root.render(<Harness active={false} options={options} />));
  expect(hideCount(label)).toBe(1);
  await act(async () => root.render(<Harness active options={options} />));
  expect(invokeCount('browser_webview_create')).toBe(0);
  expect(invokeCount('browser_webview_navigate')).toBe(0);
  await act(async () => browser.loadUrl('https://example.com/next'));
  expect(mocks.invoke).toHaveBeenCalledWith('browser_webview_navigate', {
    request: expect.objectContaining({ label, url: 'https://example.com/next' }),
  });
});

it('adopts an ArkUI automation page without consulting the desktop WebView inventory', async () => {
  await act(async () => root.render(<Harness active options={{
    webviewLabel: 'embedded-browser-panel-view-agent-arkui', adoptExisting: true,
  }} />));
  expect(browser.error).toBeNull();
  expect(invokeCount('browser_webview_show')).toBe(1);
  expect(invokeCount('browser_webview_create')).toBe(0);
  expect(invokeCount('browser_webview_navigate')).toBe(0);
});

it('keeps the exact adopted ArkWeb label when the session canvas supplies its own target id', async () => {
  const label = 'embedded-browser-panel-view-agent-exact';
  await act(async () => root.render(<Harness active targetId="embedded-browser-panel-view-generated-tab"
    options={{ webviewLabel: label, adoptExisting: true }} />));
  expect(browser.error).toBeNull();
  expect(browser.webviewLabel).toBe(label);
  expect(mocks.invoke).toHaveBeenCalledWith('browser_webview_set_bounds', {
    request: expect.objectContaining({ label }),
  });
  expect(invokeCount('browser_webview_create')).toBe(0);
  expect(invokeCount('browser_webview_navigate')).toBe(0);
});

it('reports a stale automation page instead of displaying a fresh empty replacement', async () => {
  mocks.invoke.mockImplementation(async command => {
    if (command === 'browser_get_url') throw webviewNotFound('embedded-browser-panel-view-agent-closed');
  });
  await act(async () => root.render(<Harness active options={{ webviewLabel: 'embedded-browser-panel-view-agent-closed', adoptExisting: true }} />));
  expect(browser.error).toContain('Webview not found');
  expect(invokeCount('browser_webview_create')).toBe(0);
  expect(showCount()).toBe(0);
});

it('rejects adoption without an exact native page identity', async () => {
  await act(async () => root.render(<Harness active options={{ adoptExisting: true }} />));
  expect(browser.error).toBe('Browser adoption requires an exact native WebView label');
  expect(invokeCount('browser_webview_create')).toBe(0);
  expect(showCount()).toBe(0);
});

it.each(['https://www.bitfun.work/docs.html', 'https://www.bitfun.work/Changelog.html'])(
  'opens a help page in a manual session tab through its native command adapter: %s', async url => {
    const label = 'embedded-browser-panel-view-manual-help';
    let created = false;
    mocks.invoke.mockImplementation(async command => {
      if (command === 'browser_get_url') {
        if (!created) throw webviewNotFound(label);
        return url;
      }
      if (command === 'browser_webview_create') created = true;
    });
    await act(async () => root.render(<Harness active manual targetId={label} options={{ initialUrl: url }} />));
    expect(browser.error).toBeNull();
    expect(browser.currentUrl).toBe(url);
    expect(showCount(label)).toBe(1);
    expect(invokeCount('browser_webview_create')).toBe(1);
    await act(async () => root.render(null));
    await act(async () => root.render(<Harness active manual targetId={label} options={{ initialUrl: url }} />));
    expect(browser.error).toBeNull();
    expect(showCount(label)).toBe(2);
    expect(invokeCount('browser_webview_create')).toBe(1);
    expect(invokeCount('browser_webview_navigate')).toBe(0);
    expect(closeCount()).toBe(0);
  },
);

it('adopts a blank automation page before its first navigation without creating another page', async () => {
  const label = 'embedded-browser-panel-view-agent-blank';
  await act(async () => root.render(<Harness active options={{
    initialUrl: 'about:blank', webviewLabel: label, adoptExisting: true,
  }} />));
  expect(browser.error).toBeNull();
  expect(browser.webviewLabel).toBe(label);
  expect(invokeCount('browser_webview_create')).toBe(0);
  expect(invokeCount('browser_webview_navigate')).toBe(0);
  expect(showCount(label)).toBe(1);
  await act(async () => browser.loadUrl('https://httpbin.org/forms/post'));
  expect(mocks.invoke).toHaveBeenCalledWith('browser_webview_navigate', {
    request: expect.objectContaining({ label, url: 'https://httpbin.org/forms/post' }),
  });
  await act(async () => browser.loadUrl('about:blank'));
  expect(browser.error).toContain('Unsupported protocol');
});

it('preserves the adopted native page across project unmount/remount and reads its current URL', async () => {
  const label = 'embedded-browser-panel-view-agent-project-switch';
  const options = { initialUrl: 'about:blank', webviewLabel: label, adoptExisting: true };
  mocks.invoke.mockImplementation(async command => command === 'browser_get_url'
    ? 'https://httpbin.org/forms/post' : undefined);
  await act(async () => root.render(<Harness active options={options} />));
  expect(browser.currentUrl).toBe('https://httpbin.org/forms/post');
  await act(async () => root.render(null));
  expect(hideCount(label)).toBe(1);
  expect(closeCount()).toBe(0);
  mocks.invoke.mockClear();
  await act(async () => root.render(<Harness active options={options} />));
  expect(browser.error).toBeNull();
  expect(browser.webviewLabel).toBe(label);
  expect(browser.currentUrl).toBe('https://httpbin.org/forms/post');
  expect(invokeCount('browser_webview_create')).toBe(0);
  expect(invokeCount('browser_webview_navigate')).toBe(0);
  expect(showCount(label)).toBe(1);
});

it.each(['pending', 'rejected'])('shows the first page even when script injection is %s', async (outcome) => {
  mocks.invoke.mockImplementation(async (command, args) => {
    if (command === 'browser_webview_create') {
      const { request } = args as { request: { label: string; url: string } };
      // A cached page can finish loading before the creation command returns.
      for (const listener of mocks.pageLoadListeners) {
        listener({ payload: { ...request, event: 'finished' } });
      }
    }
    if (command === 'browser_webview_eval') {
      if (outcome === 'pending') return new Promise(() => {});
      throw new Error('Script execution failed');
    }
  });

  await render();
  // Each finished document re-applies the page scripts and probes readiness.
  expect(invokeCount('browser_webview_eval')).toBe(2);
  expect(invokeCount('browser_webview_show')).toBe(1);
  expect(browser.hasWebview()).toBe(true);
  expect(browser.error).toBeNull();
});

it('injects scripts on each finished document, including initial load, reload and redirect', async () => {
  const emit = (event: 'started' | 'finished', url: string) => {
    for (const listener of mocks.pageLoadListeners) {
      listener({ payload: { label: browser.webviewLabel, event, url } });
    }
  };

  await render();
  expect(mocks.pageLoadListeners.size).toBeGreaterThan(0);
  expect(invokeCount('browser_webview_eval')).toBe(0);

  // Every native transition probes document readiness; a finished document also
  // re-applies the page scripts. The first load and a reload keep the same URL,
  // so neither can be deduplicated by URL.
  for (const reload of [false, true]) {
    await act(async () => {
      if (reload) browser.reload();
      emit('started', 'https://example.com');
      emit('finished', 'https://example.com');
    });
    expect(invokeCount('browser_webview_eval')).toBe(reload ? 6 : 3);
  }

  await act(async () => browser.loadUrl('https://example.com/next'));
  await act(async () => {
    emit('started', 'https://example.com/next');
    emit('started', 'https://example.com/login');
  });
  expect(invokeCount('browser_webview_eval')).toBe(8);
  await act(async () => {
    emit('finished', 'https://example.com/login');
  });

  expect(invokeCount('browser_webview_eval')).toBe(10);
  expect(browser.currentUrl).toBe('https://example.com/login');
  expect(browser.isLoading).toBe(false);
  expect(browser.pageLoadRevision).toBe(4);
});

it('does no layout scans for unrelated DOM animation or inactive browser tabs', async () => {
  const animated = document.createElement('div');
  document.body.append(animated);
  await render();
  const query = vi.spyOn(document, 'querySelectorAll');
  const bounds = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
  bounds.mockClear();
  for (let frame = 0; frame < 120; frame++) {
    await mutate(() => { animated.style.transform = `translateX(${frame}px)`; });
  }
  expect(query).not.toHaveBeenCalled();
  expect(bounds).not.toHaveBeenCalled();
  await render(false);
  query.mockClear();
  bounds.mockClear();
  await mutate(() => document.body.append(overlay()));
  expect(query).not.toHaveBeenCalled();
  expect(bounds).not.toHaveBeenCalled();
});

it('still clears toolbar suspension when an inactive tab misses the finishing transition', async () => {
  await render();
  await mutate(() => window.dispatchEvent(new Event('toolbar-mode-activating')));
  await render(false);
  await mutate(() => window.dispatchEvent(new Event('toolbar-mode-activation-finished')));
  await render(true);
  expect(showCount()).toBe(2);
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
