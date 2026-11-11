// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VisualSkinStorage } from './storage';
import type { StoredVisualSkin } from './types';
import { VisualSkinRuntime } from './runtime';

// Runtime fixtures inject storage; production always uses IndexedDB.
class MemoryVisualSkinStorage implements VisualSkinStorage {
  private readonly values = new Map<string, StoredVisualSkin>();
  private selection: string | null = null;

  async list() { return { skins: [...this.values.values()], invalidRecords: [] }; }
  async get(id: string) { return this.values.get(id) ?? null; }
  async put(value: StoredVisualSkin) { this.values.set(value.manifest.id, value); }
  async delete(id: string) { this.values.delete(id); if (this.selection === id) this.selection = null; }
  async getSelection() { return this.selection; }
  async setSelection(id: string | null) { this.selection = id; }
}

const packageSource = {
  manifest: {
    schema: 'openbitfun.visual-skin',
    schemaVersion: 1,
    id: 'runtime-skin',
    name: 'Runtime Skin',
    version: '1.0.0',
  },
  modes: {
    light: { tokens: { 'color.content.primary': '#101010' } },
    dark: { tokens: { 'color.content.primary': '#fefefe' } },
  },
};

const projectionPackageSource = {
  manifest: {
    schema: 'openbitfun.visual-skin',
    schemaVersion: 1,
    id: 'projection-skin',
    name: 'Projection Skin',
    version: '1.0.0',
  },
  modes: {
    light: {
      slots: {
        'shell-background': { 'background-color': '#010203', custom: '#fff' },
      },
    },
  },
  assets: {
    backdrop: {
      mimeType: 'image/svg+xml',
      source: { kind: 'data', data: 'data:image/svg+xml;base64,PHN2Zy8+' },
    },
  },
  components: [{
    component: 'app-layout',
    tokens: { 'color.content.primary': '#fefefe' },
    states: {
      selected: { tokens: { 'color.selection.surface': '#123456' } },
      active: { tokens: { 'color.accent.default': '#456789' } },
    },
  }],
  surfaces: [{
    surface: 'shell',
    baseToken: 'color.surface.canvas',
    backgroundAssetId: 'backdrop',
    backgroundOpacity: 0.8,
    scrimToken: 'color.surface.canvas',
    backgroundPosition: 'center top',
  }],
};

const runtimes: VisualSkinRuntime[] = [];
function runtimeWith(storage: VisualSkinStorage) { const runtime = new VisualSkinRuntime(storage); runtimes.push(runtime); return runtime; }

describe('VisualSkinRuntime', () => {
  afterEach(() => { runtimes.splice(0).forEach(runtime => runtime.dispose()); });
  beforeEach(() => {
    document.documentElement.removeAttribute('data-bitfun-skin-id');
    document.documentElement.removeAttribute('data-color-scheme');
    document.documentElement.removeAttribute('data-contrast');
    document.querySelectorAll('style[data-bitfun-skin-runtime]').forEach(node => node.remove());
  });

  it('imports and activates a skin without waiting on its own initializer', async () => {
    const runtime = runtimeWith(new MemoryVisualSkinStorage());
    const result = await runtime.importPackage(new TextEncoder().encode(JSON.stringify(packageSource)).buffer);
    expect(result.id).toBe('runtime-skin');
    expect(runtime.getSnapshot().activeSkinId).toBe('runtime-skin');
    expect(runtime.getSnapshot().catalog.map(entry => entry.id)).toContain('runtime-skin');
    expect(document.documentElement.getAttribute('data-bitfun-skin-id')).toBe('runtime-skin');
    expect(document.querySelector('style[data-bitfun-skin-runtime]')?.textContent).toContain('--bitfun-color-content-primary:#101010');
  });

  it('recompiles token values when the host switches color scheme', async () => {
    const runtime = runtimeWith(new MemoryVisualSkinStorage());
    await runtime.importPackage(new TextEncoder().encode(JSON.stringify(packageSource)).buffer);
    document.documentElement.setAttribute('data-color-scheme', 'dark');
    await new Promise<void>(resolve => queueMicrotask(resolve));
    expect(document.querySelector('style[data-bitfun-skin-runtime]')?.textContent).toContain('--bitfun-color-content-primary:#fefefe');
  });

  it('projects named slots, product components, and surfaces through fixed selectors', async () => {
    const runtime = runtimeWith(new MemoryVisualSkinStorage());
    const component = document.createElement('div');
    component.setAttribute('data-bitfun-component', 'app-layout');
    component.setAttribute('data-bitfun-state', 'active');
    const surface = document.createElement('div');
    surface.setAttribute('data-bitfun-surface', 'shell');
    document.body.appendChild(component);
    document.body.appendChild(surface);
    await runtime.importPackage(new TextEncoder().encode(JSON.stringify(projectionPackageSource)).buffer);
    const css = document.querySelector('style[data-bitfun-skin-runtime]')?.textContent ?? '';
    expect(css).toContain('[data-bitfun-skin-slot="shell-background"]');
    expect(css).toContain('--bitfun-skin-slot-shell-background-background-color');
    expect(css).toContain(':is([data-bitfun-component="app-layout"],[data-bitfun-product-component="app-layout"],[data-bitfun-scene="app-layout"])');
    expect(css).toContain('--bitfun-color-selection-surface:#123456 !important;');
    expect(css).toContain('[data-bitfun-state~="active"]');
    expect(css).toContain('[data-bitfun-surface="shell"]');
    expect(surface.getAttribute('data-bitfun-skin-surface')).toBe('shell');
    expect(css).toContain('background-color:var(--bitfun-color-surface-canvas) !important;');
    expect(css).toContain('--bitfun-skin-surface-background-opacity:0.8 !important;');
    expect(css).toContain('--bitfun-skin-surface-scrim-color:var(--bitfun-color-surface-canvas) !important;');
    expect(css).toContain('--bitfun-skin-surface-scrim-opacity:0 !important;');
    expect(css).toContain('--bitfun-skin-surface-background-position:center top !important;');
    expect(css).not.toMatch(/(?:^|;)opacity:0\.8 !important;/);
    expect(runtime.getSnapshot().projection?.projected).toBeGreaterThan(0);
    expect(runtime.getSnapshot().projection?.entries).toContainEqual(expect.objectContaining({
      path: 'modes.light.slots.shell-background.custom',
      status: 'unsupported',
    }));
    component.remove();
    surface.remove();
  });

  it('falls back to the opposite color scheme when a package supplies one mode', async () => {
    const runtime = runtimeWith(new MemoryVisualSkinStorage());
    document.documentElement.setAttribute('data-color-scheme', 'dark');
    const lightOnly = {
      ...packageSource,
      manifest: { ...packageSource.manifest, id: 'light-only-skin' },
      modes: { light: { tokens: { 'color.content.primary': '#abcdef' } } },
    };
    await runtime.importPackage(new TextEncoder().encode(JSON.stringify(lightOnly)).buffer);
    expect(document.querySelector('style[data-bitfun-skin-runtime]')?.textContent).toContain('--bitfun-color-content-primary:#abcdef');
  });

  it('uses an available high-contrast mode when the standard scheme is absent', async () => {
    const runtime = runtimeWith(new MemoryVisualSkinStorage());
    const highContrastOnly = {
      ...packageSource,
      manifest: { ...packageSource.manifest, id: 'high-contrast-only-skin' },
      modes: { highContrastDark: { tokens: { 'color.content.primary': '#fedcba' } } },
    };
    await runtime.importPackage(new TextEncoder().encode(JSON.stringify(highContrastOnly)).buffer);
    expect(document.querySelector('style[data-bitfun-skin-runtime]')?.textContent).toContain('--bitfun-color-content-primary:#fedcba');
  });

  it('uses a deterministic fallback when the package mode order is reversed', async () => {
    const runtime = runtimeWith(new MemoryVisualSkinStorage());
    document.documentElement.setAttribute('data-color-scheme', 'dark');
    const reversed = {
      ...packageSource,
      manifest: { ...packageSource.manifest, id: 'reversed-mode-skin' },
      modes: {
        highContrastLight: { tokens: { 'color.content.primary': '#aaaaaa' } },
        light: { tokens: { 'color.content.primary': '#abcdef' } },
      },
    };
    await runtime.importPackage(new TextEncoder().encode(JSON.stringify(reversed)).buffer);
    expect(document.querySelector('style[data-bitfun-skin-runtime]')?.textContent).toContain('--bitfun-color-content-primary:#abcdef');
  });

  it('previews a skin without changing the persisted active selection', async () => {
    const runtime = runtimeWith(new MemoryVisualSkinStorage());
    await runtime.importPackage(new TextEncoder().encode(JSON.stringify(packageSource)).buffer);
    await runtime.preview('runtime-skin');
    expect(runtime.getSnapshot().previewSkinId).toBe('runtime-skin');
    expect(runtime.getSnapshot().activeSkinId).toBe('runtime-skin');
    await runtime.cancelPreview();
    expect(runtime.getSnapshot().previewSkinId).toBeNull();
    expect(runtime.getSnapshot().status).toBe('ready');
  });

  it('restores the active skin when a previewed package is removed', async () => {
    const runtime = runtimeWith(new MemoryVisualSkinStorage());
    await runtime.importPackage(new TextEncoder().encode(JSON.stringify(packageSource)).buffer);
    const previewSource = {
      ...packageSource,
      manifest: { ...packageSource.manifest, id: 'preview-only-skin' },
      modes: { light: { tokens: { 'color.content.primary': '#abcdef' } } },
    };
    await runtime.importPackage(new TextEncoder().encode(JSON.stringify(previewSource)).buffer);
    await runtime.activate('runtime-skin');
    await runtime.preview('preview-only-skin');
    await runtime.remove('preview-only-skin');
    expect(runtime.getSnapshot().activeSkinId).toBe('runtime-skin');
    expect(runtime.getSnapshot().previewSkinId).toBeNull();
    expect(document.querySelector('style[data-bitfun-skin-runtime]')?.textContent).toContain('--bitfun-color-content-primary:#101010');
  });

  it('cancels a preview after the active package is removed without restoring a stale selection', async () => {
    const storage = new MemoryVisualSkinStorage();
    const runtime = runtimeWith(storage);
    await runtime.importPackage(new TextEncoder().encode(JSON.stringify(packageSource)).buffer);
    await runtime.importPackage(new TextEncoder().encode(JSON.stringify({
      ...packageSource, manifest: { ...packageSource.manifest, id: 'preview-skin' },
    })).buffer);
    await runtime.activate('runtime-skin');
    await runtime.preview('preview-skin');
    await runtime.remove('runtime-skin');
    expect(runtime.getSnapshot()).toMatchObject({
      activeSkinId: null, activeSkin: null, previewSkinId: 'preview-skin', status: 'previewing',
    });
    await runtime.cancelPreview();
    expect(runtime.getSnapshot()).toMatchObject({ activeSkinId: null, previewSkinId: null, status: 'ready' });
    expect(await storage.getSelection()).toBeNull();
    expect(document.documentElement.hasAttribute('data-bitfun-skin-id')).toBe(false);
    expect(document.querySelector('style[data-bitfun-skin-runtime]')).toBeNull();
    expect(await storage.get('preview-skin')).not.toBeNull();
  });
});
