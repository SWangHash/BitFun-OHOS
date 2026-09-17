import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { buildCanvasRuntimeInstallerScript } from './canvasRuntimeInstaller';

describe('Canvas runtime installer', () => {
  it('loads generated typography tokens while keeping iframe-local shape and spacing fallbacks', () => {
    const runtimeCss = readFileSync(new URL('./styles/canvas-runtime.scss', import.meta.url), 'utf8');
    const runtimeEntry = readFileSync(new URL('./entry.tsx', import.meta.url), 'utf8');
    const iframeFallbackVars = [
      '--bitfun-radius-sm',
      '--bitfun-radius-base',
      '--bitfun-radius-md',
      '--bitfun-radius-lg',
      '--bitfun-radius-xl',
      '--bitfun-radius-2xl',
      '--bitfun-radius-pill',
      '--bitfun-space-1',
      '--bitfun-space-2',
      '--bitfun-space-3',
      '--bitfun-space-4',
      '--bitfun-space-5',
      '--bitfun-space-6',
      '--bitfun-space-8',
      '--bitfun-space-10',
      '--bitfun-space-12',
      '--bitfun-space-16',
    ];

    for (const name of iframeFallbackVars) {
      expect(runtimeCss).toContain(`${name}:`);
    }
    expect(runtimeEntry).toContain("import '@bitfun/design-tokens/tokens.css';");
    expect(runtimeCss).not.toMatch(/^\s*--bitfun-(?:font|letter-spacing|line-height|type)-/m);
  });

  it('merges bundled SDK adapters before user module startup', () => {
    const script = buildCanvasRuntimeInstallerScript('rev_test');

    expect(script).toContain('function installSdkAdapters()');
    expect(script).toContain('...runtimeWindow.BitFunCanvasSDKAdapters');
    expect(script).toContain('runtimeWindow.BitFunCanvasRuntimeHooks');
    expect(script.indexOf('installSdkAdapters();')).toBeLessThan(
      script.indexOf('bitfun-canvas-module-started'),
    );
  });

  it('keeps fallback SDK scoped to runtime hooks while bundled adapters own components', () => {
    const script = buildCanvasRuntimeInstallerScript('rev_test');

    expect(script).toContain('runtimeWindow.BitFunCanvasSDK = {');
    expect(script).toContain('...runtimeWindow.BitFunCanvasRuntimeHooks');
    expect(script).not.toContain('function Stack');
    expect(script).not.toContain('function BarChart');
    expect(script).not.toContain('function DependencyGraph');
  });

  it('syncs browser color scheme when the host appearance changes', () => {
    const script = buildCanvasRuntimeInstallerScript('rev_test');

    expect(script).toContain('nextAppearance.type === "dark" || nextAppearance.type === "light"');
    expect(script).toContain('document.documentElement.style.colorScheme = nextAppearance.type');
  });

  it('projects code-change colors into the renderer without changing status colors', () => {
    const runtimeCss = readFileSync(new URL('./styles/canvas-runtime.scss', import.meta.url), 'utf8');
    const script = buildCanvasRuntimeInstallerScript('rev_test');

    expect(runtimeCss).toContain('--bitfun-color-code-change-added: var(--bitfun-canvas-success)');
    expect(runtimeCss).toContain('--bitfun-color-code-change-removed: var(--bitfun-canvas-danger)');
    expect(script).toContain('appearanceVars["--bitfun-color-code-change-added"]');
    expect(script).toContain('appearanceVars["--bitfun-color-code-change-removed"]');
    expect(script).toContain('stripAdded: codeChangeAdded');
    expect(script).toContain('stripRemoved: codeChangeRemoved');
  });

  it('installs design-mode element selection handlers', () => {
    const script = buildCanvasRuntimeInstallerScript('rev_test');

    expect(script).toContain('bitfun-canvas-design-mode');
    expect(script).toContain('data-bitfun-canvas-design-mode');
    expect(script).toContain('bitfun-canvas-element-selected');
    expect(script).toContain('document.addEventListener("pointermove"');
    expect(script).toContain('document.addEventListener("click"');
  });
});
