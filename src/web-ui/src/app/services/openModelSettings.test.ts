// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openModelSettings } from './openModelSettings';

const openPage = vi.fn();
const preloadSettingsPage = vi.fn(() => Promise.resolve());

vi.mock('@/app/scenes/settings/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ openPage }),
  },
}));

vi.mock('@/app/scenes/settings/settingsRegistry', () => ({
  preloadSettingsPage,
}));

describe('openModelSettings', () => {
  beforeEach(() => {
    openPage.mockClear();
    preloadSettingsPage.mockClear();
  });

  it('opens the models page and preloads it before opening the scene', async () => {
    const sceneOpen = vi.fn();
    window.addEventListener('scene:open', sceneOpen);

    await openModelSettings();

    expect(openPage).toHaveBeenCalledWith('ai.models');
    expect(preloadSettingsPage).toHaveBeenCalledWith('ai.models');
    expect(sceneOpen).toHaveBeenCalledOnce();
    expect(sceneOpen.mock.calls[0][0]).toMatchObject({
      type: 'scene:open',
      detail: { sceneId: 'settings' },
    });
    window.removeEventListener('scene:open', sceneOpen);
  });

  it('opens the settings scene when preloading fails', async () => {
    preloadSettingsPage.mockRejectedValueOnce(new Error('chunk unavailable'));
    const sceneOpen = vi.fn();
    window.addEventListener('scene:open', sceneOpen);

    await openModelSettings();

    expect(sceneOpen).toHaveBeenCalledOnce();
    window.removeEventListener('scene:open', sceneOpen);
  });
});
