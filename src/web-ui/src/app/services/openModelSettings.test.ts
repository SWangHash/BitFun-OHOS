// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openModelSettings } from './openModelSettings';

const openTab = vi.fn();
const preloadSettingsTabContent = vi.fn(() => Promise.resolve());

vi.mock('@/app/scenes/settings/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ openTab }),
  },
}));

vi.mock('@/app/scenes/settings/settingsContentRegistry', () => ({
  preloadSettingsTabContent,
}));

describe('openModelSettings', () => {
  beforeEach(() => {
    openTab.mockClear();
    preloadSettingsTabContent.mockClear();
  });

  it('sets model-create focus and preloads the settings tab before opening', async () => {
    const sceneOpen = vi.fn();
    window.addEventListener('scene:open', sceneOpen);

    await openModelSettings();

    expect(openTab).toHaveBeenCalledWith('models', 'model-create');
    expect(preloadSettingsTabContent).toHaveBeenCalledWith('models');
    expect(sceneOpen).toHaveBeenCalledOnce();
    expect(sceneOpen.mock.calls[0][0]).toMatchObject({
      type: 'scene:open',
      detail: { sceneId: 'settings' },
    });
    window.removeEventListener('scene:open', sceneOpen);
  });

  it('opens the settings scene when preloading fails', async () => {
    preloadSettingsTabContent.mockRejectedValueOnce(new Error('chunk unavailable'));
    const sceneOpen = vi.fn();
    window.addEventListener('scene:open', sceneOpen);

    await openModelSettings();

    expect(sceneOpen).toHaveBeenCalledOnce();
    window.removeEventListener('scene:open', sceneOpen);
  });
});
