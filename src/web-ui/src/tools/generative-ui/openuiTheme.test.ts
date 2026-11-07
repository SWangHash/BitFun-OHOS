import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const theme = readFileSync(new URL('./components/openui/theme.css', import.meta.url), 'utf8');
const components = readFileSync(new URL('./components/openui/components.css', import.meta.url), 'utf8');
const map = readFileSync(new URL('./components/openui/map/map.css', import.meta.url), 'utf8');
const scheme = readFileSync(new URL('./components/openui/scheme.ts', import.meta.url), 'utf8');
const bitfunMap = readFileSync(new URL('./components/map/MapView.tsx', import.meta.url), 'utf8');

describe('BitFun GenUI theme integration', () => {
  it('uses host Appearance tokens for OpenUI text, canvas, borders and status colors', () => {
    expect(theme).toContain('--iui-canvas: var(--bitfun-color-surface-canvas');
    expect(theme).toContain('--iui-ink: var(--bitfun-color-content-primary');
    expect(theme).toContain('--iui-muted: var(--bitfun-color-content-secondary');
    expect(theme).toContain('--iui-border: var(--bitfun-color-border-default');
    expect(theme).toContain('--iui-success: var(--bitfun-color-status-success-content');
    expect(theme).toContain(':root[data-bitfun-appearance-mode="dark"]');
    expect(theme).not.toContain('[data-theme="dark"]');
  });

  it('updates OpenUI dark selectors and scheme-aware components from Appearance mode', () => {
    expect(components).toContain('[data-bitfun-appearance-mode="dark"]');
    expect(map).toContain('[data-bitfun-appearance-mode="dark"]');
    expect(scheme).toContain('data-bitfun-appearance-mode');
    expect(bitfunMap).toContain('useColorScheme(containerRef)');
    expect(bitfunMap).not.toContain('prefers-color-scheme: dark');
  });
});
