import { describe, expect, it, vi } from 'vitest';
import {
  BROWSER_WEBVIEW_BLOCKING_OVERLAY_SELECTOR,
  createBrowserWebviewLabel,
  createCommandBasedBrowserWebviewHandle,
  normalizeBrowserBackgroundColor,
} from './useEmbeddedBrowserWebview';

describe('browser webview background color normalization', () => {
  it('converts computed rgb() colors into the #rrggbb form required by the desktop command', () => {
    expect(normalizeBrowserBackgroundColor('rgb(18, 18, 20)')).toBe('#121214');
    expect(normalizeBrowserBackgroundColor('rgba(243, 243, 245, 1)')).toBe('#f3f3f5');
    expect(normalizeBrowserBackgroundColor('rgb(255,0,0)')).toBe('#ff0000');
  });

  it('passes through hex colors and normalizes their form', () => {
    expect(normalizeBrowserBackgroundColor('#121214')).toBe('#121214');
    expect(normalizeBrowserBackgroundColor('#FFFFFF')).toBe('#ffffff');
    expect(normalizeBrowserBackgroundColor('#abc')).toBe('#aabbcc');
    // Alpha is dropped: WebView2 forces non-zero alpha to opaque anyway.
    expect(normalizeBrowserBackgroundColor('#121214ff')).toBe('#121214');
  });

  it('rejects colors that would leak a non-theme surface color', () => {
    // A fully transparent root background resolves to the white webview
    // canvas; fall back to the theme color instead.
    expect(normalizeBrowserBackgroundColor('rgba(0, 0, 0, 0)')).toBeNull();
    expect(normalizeBrowserBackgroundColor('transparent')).toBeNull();
    expect(normalizeBrowserBackgroundColor('')).toBeNull();
  });
});

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
