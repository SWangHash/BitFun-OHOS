import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

function readIndexHtml(): string {
  return readFileSync(fileURLToPath(new URL('../../../index.html', import.meta.url)), 'utf8');
}

function readWindowControlsSource(): string {
  return readFileSync(
    fileURLToPath(new URL('../components/WindowControls/WindowControls.tsx', import.meta.url)),
    'utf8',
  );
}

function readLoadingMessage(locale: string): string {
  const common = JSON.parse(readFileSync(
    fileURLToPath(new URL(`../../locales/${locale}/common.json`, import.meta.url)),
    'utf8',
  ));
  return common.loading.app;
}

describe('startup preload shell', () => {
  it.each([
    ['zh-CN', 'en-US', 'zh-CN'],
    ['en-US', 'zh-CN', 'en-US'],
    ['zh-TW', 'en-US', 'zh-TW'],
    ['  ZH-hant-TW  ', 'en-US', 'zh-TW'],
    ['zh-HK', 'en-US', 'zh-TW'],
    ['en-GB', 'zh-CN', 'en-US'],
    [undefined, 'zh-Hant', 'zh-TW'],
    ['fr-FR', 'en-US', 'zh-CN'],
  ])('localizes first-paint text for saved locale %s and system language %s', (saved, system, expected) => {
    const dom = new JSDOM(readIndexHtml(), {
      url: 'http://localhost:1422/',
      runScripts: 'dangerously',
      beforeParse(window) {
        Object.defineProperty(window.navigator, 'language', { value: system });
        Object.assign(window, {
          __BITFUN_BOOTSTRAP_LOCALE__: saved,
          // Older hosts may still inject their own copy; the surface owns it now.
          __BITFUN_BOOTSTRAP_MESSAGES__: { loadingApp: 'Legacy startup copy' },
        });
      },
    });

    expect(dom.window.document.documentElement.lang).toBe(expected);
    expect(dom.window.document.querySelector('.splash-screen__message')?.textContent)
      .toBe(readLoadingMessage(expected!));
    dom.window.close();
  });

  it('uses injected startup locale text and mirrors native window-control state', async () => {
    let isMaximized = true;
    const invoke = vi.fn().mockImplementation((_command, payload) => {
      const action = (payload as { request: { action: string } }).request.action;
      if (action === 'toggle_maximize') isMaximized = !isMaximized;
      return Promise.resolve({ isMaximized });
    });
    const dom = new JSDOM(readIndexHtml(), {
      url: 'http://localhost:1422/',
      runScripts: 'dangerously',
      beforeParse(window) {
        Object.defineProperty(window.navigator, 'platform', { value: 'Win32' });
        Object.assign(window, {
          __BITFUN_BOOTSTRAP_LOCALE__: 'zh-CN',
          __BITFUN_SHOW_STARTUP_WINDOW_CONTROLS__: true,
          __TAURI_INTERNALS__: { invoke },
        });
      },
    });

    const hint = dom.window.document.querySelector('.splash-screen__message');
    expect(dom.window.document.documentElement.lang).toBe('zh-CN');
    expect(dom.window.document.getElementById('root')?.childElementCount).toBe(0);
    expect(dom.window.document.getElementById('bitfun-startup-overlay')).not.toBeNull();
    expect(hint?.textContent).toBe('正在启动 BitFun...');

    const controls = dom.window.document.querySelector<HTMLElement>('[data-startup-window-controls]');
    expect(controls?.hidden).toBe(false);
    expect(controls?.classList.contains('window-controls')).toBe(true);
    expect(controls?.classList.contains('window-controls--windows')).toBe(true);
    expect(controls?.getAttribute('data-bitfun-component')).toBe('window-controls');
    expect(dom.window.document.querySelector('.splash-screen')?.hasAttribute('aria-hidden')).toBe(false);
    await Promise.resolve();

    const minimizeButton = dom.window.document.querySelector<HTMLButtonElement>('[data-startup-window-action="minimize"]');
    expect(minimizeButton?.className).toBe('window-controls__btn window-controls__btn--minimize');
    expect(minimizeButton?.querySelector('.lucide-minus')).not.toBeNull();
    expect(minimizeButton?.querySelectorAll('svg')).toHaveLength(1);

    const maximizeButton = dom.window.document.querySelector<HTMLButtonElement>('[data-startup-window-action="toggle_maximize"]');
    const visibleMaximizeGlyph = () => Array.from(maximizeButton?.querySelectorAll('svg') ?? [])
      .find(glyph => glyph.style.display !== 'none')
      ?.getAttribute('class');
    expect(controls?.getAttribute('data-bitfun-state')).toBe('maximized');
    expect(maximizeButton?.getAttribute('aria-label')).toBe('还原');
    expect(visibleMaximizeGlyph()).toContain('lucide-copy');

    dom.window.document.documentElement.lang = 'zh-TW';
    await Promise.resolve();
    expect(hint?.textContent).toBe(readLoadingMessage('zh-TW'));
    expect(maximizeButton?.getAttribute('aria-label')).toBe('還原');
    dom.window.document.documentElement.lang = 'zh-CN';
    await Promise.resolve();

    maximizeButton?.click();
    await Promise.resolve();
    expect(controls?.hasAttribute('data-bitfun-state')).toBe(false);
    expect(maximizeButton?.getAttribute('aria-label')).toBe('最大化');
    expect(visibleMaximizeGlyph()).toContain('lucide-square');

    const closeButton = dom.window.document.querySelector<HTMLButtonElement>('[data-startup-window-action="close"]');
    expect(closeButton?.getAttribute('aria-label')).toBe('关闭');
    closeButton?.click();

    expect(invoke).toHaveBeenCalledWith('startup_window_control', {
      request: { action: 'close' },
    });
    expect(invoke).toHaveBeenCalledWith('startup_window_control', {
      request: { action: 'get_state' },
    });

    const html = readIndexHtml();
    expect(html).toContain('href="/src/app/components/WindowControls/WindowControls.scss"');
    expect(html).toContain('.window-controls.bitfun-startup-window-controls');
    expect(html).not.toContain('bitfun-startup-window-controls__btn');
    expect(readWindowControlsSource()).not.toContain("import './WindowControls.scss'");
    dom.window.close();
  });

  it('updates a system-language hint when the app resolves its saved language', async () => {
    const dom = new JSDOM(readIndexHtml(), {
      url: 'http://localhost:1422/',
      runScripts: 'dangerously',
      beforeParse(window) {
        Object.defineProperty(window.navigator, 'language', { value: 'en-US' });
      },
    });
    const hint = dom.window.document.querySelector('.splash-screen__message');
    expect(hint?.textContent).toBe(readLoadingMessage('en-US'));

    dom.window.document.documentElement.lang = 'zh-CN';
    await Promise.resolve();
    expect(hint?.textContent).toBe(readLoadingMessage('zh-CN'));

    dom.window.dispatchEvent(new dom.window.Event('bitfun:startup-overlay-hidden'));
    dom.window.document.documentElement.lang = 'en-US';
    await Promise.resolve();
    expect(hint?.textContent).toBe(readLoadingMessage('zh-CN'));
    dom.window.close();
  });

  it('mirrors the OpenHarmony native start window on the webview host', () => {
    const html = readIndexHtml();
    // start_window_background is pinned to a neutral #6A6A6A in the OHOS
    // resources (base and dark) and the launch mark is a single light
    // silhouette, so the overlay is a constant neutral canvas that must not
    // depend on prefers-color-scheme.
    expect(html).toMatch(/\.splash-screen--ohos-brand \{\s*background: #6a6a6a;/);
    expect(html).toContain("ohosSplash.classList.add('splash-screen--ohos-brand')");
    expect(html).toContain('--bitfun-ohos-start-icon-size');
    // The overlay announces its own presentation so the OHOS shell releases the
    // native splash mirror exactly on the takeover frame (no gap between them).
    expect(html).toContain('bitfun-startup-overlay-presented');

    const dom = new JSDOM(html, {
      url: 'http://localhost:1422/',
      runScripts: 'dangerously',
      beforeParse(window) {
        Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (OpenHarmony)' });
      },
    });

    expect(
      dom.window.document.querySelector('.splash-screen')?.classList.contains('splash-screen--ohos-brand'),
    ).toBe(true);
    // The native start window draws the 240px mark without density scaling, so
    // the overlay converts it to CSS px (jsdom dpr is 1, viewport is 1024x768).
    expect(
      dom.window.document.documentElement.style.getPropertyValue('--bitfun-ohos-start-icon-size'),
    ).toBe('240px');
    // No themed desktop loading hint on the OHOS brand splash.
    expect(dom.window.document.querySelector('.splash-screen__message')?.textContent).toBe('');
    dom.window.close();
  });

  it('shows the independent pet preload for the companion window', () => {
    const html = readIndexHtml();
    const dom = new JSDOM(html, {
      url: 'http://localhost:1422/?bitfunWindow=agent-companion',
      runScripts: 'dangerously',
      beforeParse(window) {
        Object.assign(window, {
          __BITFUN_BOOTSTRAP_LOCALE__: 'en-US',
        });
      },
    });

    expect(dom.window.document.body.classList.contains('bitfun-pet-preload-body')).toBe(true);
    expect(dom.window.document.getElementById('bitfun-startup-overlay')).toBeNull();
    expect(dom.window.document.querySelector('.bitfun-pet-preload__sprite')).not.toBeNull();
    expect(dom.window.document.querySelector('.splash-screen__logo')).toBeNull();
    expect(dom.window.document.querySelector('.bitfun-sr-only')?.textContent).toBe('Loading companion...');
    const spriteCss = html.match(/\.bitfun-pet-preload__sprite \{(?<css>[\s\S]*?)\n      \}/)?.groups?.css;
    expect(spriteCss).toBeDefined();
    expect(spriteCss).not.toContain('background:');
    expect(spriteCss).not.toContain('border:');
    expect(spriteCss).not.toContain('box-shadow:');
    dom.window.close();
  });
});
