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

  it('hides external AI and ACP settings from the navigation', () => {
    const visibleTabs = SETTINGS_CATEGORIES.flatMap((category) => category.tabs).map((tab) => tab.id);

    expect(visibleTabs).not.toContain('external-sources');
    expect(visibleTabs).not.toContain('acp-agents');
  });

  it('keeps ordinary settings targets free of content focus', () => {
    expect(normalizeSettingsTarget('models')).toEqual({
      tab: 'models',
    });
  });

  it('routes model creation targets into the model settings flow', () => {
    expect(normalizeSettingsTarget('models:create')).toEqual({
      tab: 'models',
      focus: 'model-create',
    });
  });

  it('keeps legacy Hooks deep links working without exposing a navigation item', () => {
    expect(normalizeSettingsTarget('hooks')).toEqual({
      tab: 'external-sources',
      focus: 'hooks',
    });
  });
});
