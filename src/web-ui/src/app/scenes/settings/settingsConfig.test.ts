import { describe, expect, it } from 'vitest';
import { normalizeSettingsTarget, SETTINGS_CATEGORIES } from './settingsConfig';

function hasVoiceInputTab(): boolean {
  return SETTINGS_CATEGORIES.some(category =>
    category.tabs.some(tab => tab.id === 'voice-input')
  );
}

describe('settings deep-link targets', () => {
  it('keeps voice input visible on non-OpenHarmony runtimes', () => {
    expect(hasVoiceInputTab()).toBe(true);
  });

  it('routes the legacy Hooks target into External AI applications with focus intent', () => {
    expect(normalizeSettingsTarget('hooks')).toEqual({
      tab: 'external-sources',
      focus: 'hooks',
    });
  });

  it('keeps ordinary settings targets free of content focus', () => {
    expect(normalizeSettingsTarget('external-sources')).toEqual({
      tab: 'external-sources',
    });
  });

  it('routes model creation targets into the model settings flow', () => {
    expect(normalizeSettingsTarget('models:create')).toEqual({
      tab: 'models',
      focus: 'model-create',
    });
  });

  it('keeps the external AI applications entry hidden from settings nav and search', () => {
    const externalSources = SETTINGS_CATEGORIES
      .flatMap((category) => category.tabs)
      .find((tab) => tab.id === 'external-sources');

    expect(externalSources?.hidden).toBe(true);
  });
});
