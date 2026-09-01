import { describe, expect, it, vi } from 'vitest';
import {
  BROWSER_WEBVIEW_BLOCKING_OVERLAY_SELECTOR,
  createBrowserWebviewLabel,
  createCommandBasedBrowserWebviewHandle,
} from './useEmbeddedBrowserWebview';

describe('embedded browser WebView identity and visibility commands', () => {
  it('creates a distinct native label for every browser panel instance', () => {
    const first = createBrowserWebviewLabel('embedded-browser-panel-view');
    const second = createBrowserWebviewLabel('embedded-browser-panel-view');

    expect(first).not.toBe(second);
    expect(first).toMatch(/^embedded-browser-panel-view-[a-z0-9-]+$/);
    expect(second).toMatch(/^embedded-browser-panel-view-[a-z0-9-]+$/);
  });

  it('hides the native WebView while split drop targets are visible', () => {
    expect(BROWSER_WEBVIEW_BLOCKING_OVERLAY_SELECTOR).toContain('.canvas-drop-zone-overlay');
    expect(BROWSER_WEBVIEW_BLOCKING_OVERLAY_SELECTOR).not.toContain('.canvas-tab-overflow-menu');
  });

  it('serializes show and hide commands for the same native WebView', async () => {
    let releaseShow: (() => void) | undefined;
    const showBlocked = new Promise<void>((resolve) => {
      releaseShow = resolve;
    });
    const calls: string[] = [];
    const invoke = vi.fn(async (command: string) => {
      calls.push(command);
      if (command === 'browser_webview_show') await showBlocked;
    });
    const handle = createCommandBasedBrowserWebviewHandle('embedded-browser-panel-view-test', invoke);

    const show = handle.show();
    await Promise.resolve();
    await Promise.resolve();
    const hide = handle.hide();
    await Promise.resolve();
    expect(calls).toEqual(['browser_webview_show']);

    releaseShow?.();
    await Promise.all([show, hide]);
    expect(calls).toEqual(['browser_webview_show', 'browser_webview_hide']);
  });
});
