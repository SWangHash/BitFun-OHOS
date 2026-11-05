// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openModelSettings } from './aiErrorActions';

const openPage = vi.fn();

vi.mock('@/app/scenes/settings/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ openPage }),
  },
}));

describe('openModelSettings', () => {
  beforeEach(() => {
    openPage.mockClear();
  });

  it('selects the model settings page and opens the settings scene', async () => {
    const sceneOpen = vi.fn();
    window.addEventListener('scene:open', sceneOpen);

    openModelSettings();
    await vi.waitFor(() => expect(openPage).toHaveBeenCalledWith('ai.models'));
    await vi.waitFor(() => expect(sceneOpen).toHaveBeenCalledOnce());

    expect(sceneOpen.mock.calls[0][0]).toMatchObject({
      type: 'scene:open',
      detail: { sceneId: 'settings' },
    });
    window.removeEventListener('scene:open', sceneOpen);
  });

  it('still opens the settings scene when page selection fails', async () => {
    openPage.mockImplementationOnce(() => {
      throw new Error('settings store unavailable');
    });
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
