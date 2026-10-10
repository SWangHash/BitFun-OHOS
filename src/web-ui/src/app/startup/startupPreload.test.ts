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

  it('keeps the launch canvas black and light-toned regardless of the resolved scheme', () => {
    const html = readIndexHtml();
    const splashRule = html.match(/\.splash-screen \{(?<css>[\s\S]*?)\n      \}/)?.groups?.css;

    expect(splashRule).toBeDefined();
    expect(splashRule).toContain('background: #000000;');
    expect(splashRule).not.toContain('var(--bitfun-color-surface-chrome)');
    // The mark and the loading hint sit on the black canvas, so both resolve to
    // the on-dark tone instead of a scheme-dependent surface token.
    expect(html).toContain('background-color: var(--bitfun-color-content-on-dark);');
    expect(html).toMatch(/\.splash-screen__message \{[\s\S]*?color: color-mix\(in srgb, var\(--bitfun-color-content-on-dark\) 72%, transparent\);/);
    expect(html).not.toContain('background-color: var(--bitfun-color-content-on-light)');
    expect(html).not.toContain('color: var(--bitfun-color-content-secondary)');
    expect(html).not.toMatch(/\[data-color-scheme="dark"\][\s\S]{0,80}splash-screen__/);
  });

  it('leaves the window chrome to the app shell instead of the pre-React splash', async () => {
    const dom = new JSDOM(readIndexHtml(), {
      url: 'http://localhost:1422/',
      runScripts: 'dangerously',
      beforeParse(window) {
        Object.defineProperty(window.navigator, 'platform', { value: 'Win32' });
        Object.assign(window, {
          __BITFUN_BOOTSTRAP_LOCALE__: 'zh-CN',
          __TAURI_INTERNALS__: { invoke: vi.fn() },
        });
      },
    });

    const hint = dom.window.document.querySelector('.splash-screen__message');
    expect(dom.window.document.documentElement.lang).toBe('zh-CN');
    expect(dom.window.document.getElementById('root')?.childElementCount).toBe(0);
    expect(dom.window.document.getElementById('bitfun-startup-overlay')).not.toBeNull();
    expect(hint?.textContent).toBe('正在启动 BitFun...');

    // Minimize/maximize/close stay off the launch canvas: the shell renders them
    // together with the interface.
    expect(dom.window.document.querySelector('[data-startup-window-controls]')).toBeNull();
    expect(dom.window.document.querySelectorAll('.window-controls')).toHaveLength(0);
    expect(dom.window.document.querySelector('[data-startup-window-action]')).toBeNull();
    expect(dom.window.document.querySelector('.splash-screen__logo-wrap')).not.toBeNull();
    await Promise.resolve();

    dom.window.document.documentElement.lang = 'zh-TW';
    await Promise.resolve();
    expect(hint?.textContent).toBe(readLoadingMessage('zh-TW'));

    const html = readIndexHtml();
    expect(html).not.toContain('data-startup-window-controls');
    expect(html).not.toContain('__BITFUN_SHOW_STARTUP_WINDOW_CONTROLS__');
    expect(html).not.toContain('startup_window_control');
    // The app shell still owns those styles through this stylesheet.
    expect(html).toContain('href="/src/app/components/WindowControls/WindowControls.scss"');
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
    // start_window_background is pinned to black in the OHOS resources (base and
    // dark) and the launch mark is a single light silhouette, so the brand class
    // only pins the mark size to the native start window: it must never override
    // the shared launch canvas with a scheme-dependent tone.
    expect(html).toContain("ohosSplash.classList.add('splash-screen--ohos-brand')");
    expect(html).not.toMatch(/\.splash-screen--ohos-brand \{\s*background:/);
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
