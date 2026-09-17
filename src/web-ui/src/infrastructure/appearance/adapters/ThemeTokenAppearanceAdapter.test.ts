// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { builtinAppearancePackages } from '../builtins/catalog';
import { themeTokenAppearanceAdapter } from './ThemeTokenAppearanceAdapter';

const context = { revision: 1, appearanceId: 'test', mode: 'light' as const, globals: {}, assets: {} };

afterEach(async () => {
  document.documentElement.removeAttribute('data-bitfun-native-material');
  await themeTokenAppearanceAdapter.apply(undefined, undefined, context);
});

describe('theme root background', () => {
  it('keeps the native backdrop exposed across theme switches and resets', async () => {
    document.documentElement.setAttribute('data-bitfun-native-material', 'sidebar');
    for (const pkg of builtinAppearancePackages) {
      await themeTokenAppearanceAdapter.apply(pkg.renderers?.['theme-tokens']?.settings, undefined, context);
      expect(document.documentElement.style.backgroundColor).toBe('transparent');
      expect(document.body.style.backgroundColor).toBe('transparent');
    }
    await themeTokenAppearanceAdapter.apply(undefined, undefined, context);
    expect(document.documentElement.style.backgroundColor).toBe('');
    expect(document.documentElement.getAttribute('data-bitfun-native-material')).toBe('sidebar');
  });

  it('preserves the opaque theme background in browsers and older desktop hosts', async () => {
    const settings = builtinAppearancePackages[0].renderers?.['theme-tokens']?.settings;
    await themeTokenAppearanceAdapter.apply(settings, undefined, context);
    expect(document.documentElement.style.backgroundColor).toBe('var(--bitfun-color-surface-chrome)');
    expect(document.body.style.backgroundColor).toBe('var(--bitfun-color-surface-chrome)');
  });
});
