// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openPage: vi.fn(),
}));

vi.mock('@/app/scenes/settings/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ openPage: mocks.openPage }),
  },
}));

import { openModelSettings } from './openModelSettings';

describe('openModelSettings', () => {
  beforeEach(() => {
    mocks.openPage.mockReset();
  });

  it('opens the canonical ai.models page before mounting the settings scene', async () => {
    const sceneOpen = vi.fn();
    window.addEventListener('scene:open', sceneOpen);

    await openModelSettings();

    expect(mocks.openPage).toHaveBeenCalledWith('ai.models');
    expect(sceneOpen).toHaveBeenCalledOnce();
    expect(sceneOpen.mock.calls[0][0]).toMatchObject({
      type: 'scene:open',
      detail: { sceneId: 'settings' },
    });
    window.removeEventListener('scene:open', sceneOpen);
  });

  it('still opens the settings scene when the settings navigation fails', async () => {
    mocks.openPage.mockImplementationOnce(() => {
      throw new Error('settings store unavailable');
    });
    const sceneOpen = vi.fn();
    window.addEventListener('scene:open', sceneOpen);

    await openModelSettings();

    expect(mocks.openPage).toHaveBeenCalledOnce();
    expect(sceneOpen).toHaveBeenCalledOnce();
    window.removeEventListener('scene:open', sceneOpen);
  });
});
