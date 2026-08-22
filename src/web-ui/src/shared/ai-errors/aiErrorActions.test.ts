// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openModelSettings } from './aiErrorActions';

const setActiveTab = vi.fn();
const preloadSettingsTabContent = vi.fn(() => Promise.resolve());

vi.mock('@/app/scenes/settings/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ setActiveTab }),
  },
}));

vi.mock('@/app/scenes/settings/settingsContentRegistry', () => ({
  preloadSettingsTabContent,
}));

describe('openModelSettings', () => {
  beforeEach(() => {
    setActiveTab.mockClear();
    preloadSettingsTabContent.mockClear();
  });

  it('preloads the model tab before opening the settings scene', async () => {
    const sceneOpen = vi.fn();
    window.addEventListener('scene:open', sceneOpen);

    openModelSettings();
    await vi.waitFor(() => expect(sceneOpen).toHaveBeenCalledOnce());

    expect(setActiveTab).toHaveBeenCalledWith('models');
    expect(preloadSettingsTabContent).toHaveBeenCalledWith('models');
    expect(sceneOpen.mock.calls[0][0]).toMatchObject({
      type: 'scene:open',
      detail: { sceneId: 'settings' },
    });
    window.removeEventListener('scene:open', sceneOpen);
  });

  it('still opens the settings scene when preloading fails', async () => {
    preloadSettingsTabContent.mockRejectedValueOnce(new Error('chunk unavailable'));
    const sceneOpen = vi.fn();
    window.addEventListener('scene:open', sceneOpen);

    openModelSettings();
    await vi.waitFor(() => expect(sceneOpen).toHaveBeenCalledOnce());

    expect(sceneOpen.mock.calls[0][0]).toMatchObject({
      type: 'scene:open',
      detail: { sceneId: 'settings' },
    });
    window.removeEventListener('scene:open', sceneOpen);
  });
});
