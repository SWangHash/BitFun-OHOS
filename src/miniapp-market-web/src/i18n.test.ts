// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { initialLocale, resolveMarketLocale } from './i18n';
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
it('uses the caller language ahead of a previously saved auth preference', () => {
  vi.stubGlobal('localStorage', { getItem: () => 'zh-CN' });
  window.history.replaceState(null, '', '/?locale=en-US');
  expect(initialLocale()).toBe('en-US');
});
it('uses browser English even when storage is unavailable', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); } });
  vi.stubGlobal('navigator', { language: 'en-GB' });
  expect(initialLocale()).toBe('en-US');
});
it.each([['zh-Hant-HK', 'zh-TW'], ['zh-Hans', 'zh-CN'], ['en', 'en-US'], ['fr', undefined]])('resolves %s from the shared locale contract', (input, expected) => {
  expect(resolveMarketLocale(input)).toBe(expected);
});
