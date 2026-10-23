import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openDestination: vi.fn(),
  openScene: vi.fn(),
  activateProductAction: vi.fn(),
}));

vi.mock('@/app/scenes/settings/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ openDestination: mocks.openDestination }),
  },
}));

vi.mock('@/app/stores/sceneStore', () => ({
  useSceneStore: {
    getState: () => ({ openScene: mocks.openScene }),
  },
}));

vi.mock('./productActionActivator', () => ({
  activateProductAction: mocks.activateProductAction,
}));

import { activateInteractiveCapability } from './interactiveCapabilityActivator';
import { getInteractiveCapability, isInteractiveCapabilityOpenable } from './interactiveCapabilityCatalog';

describe('activateInteractiveCapability', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not register a Git panel entry', async () => {
    const capability = getInteractiveCapability('feature.git')!;
    expect(isInteractiveCapabilityOpenable(capability)).toBe(false);
    expect(capability.destination).toBeUndefined();
    expect(capability.items.every(({ control }) => control.kind === 'delegate')).toBe(true);
    for (const itemId of [undefined, 'status-diff', 'branches']) {
      await expect(activateInteractiveCapability('feature.git', { itemId }))
        .rejects.toThrow('Unknown BitFun capability entry: feature.git');
    }
    await expect(activateInteractiveCapability('feature.git', { itemId: 'trust-worktrees' }))
      .rejects.toThrow('Unknown documented item');
    expect(mocks.openScene).not.toHaveBeenCalled();
    expect(mocks.openDestination).not.toHaveBeenCalled();
    expect(mocks.activateProductAction).not.toHaveBeenCalled();
  });

  it('opens the exact settings subview declared by a documented item', async () => {
    await activateInteractiveCapability('setting.application.shortcuts', {
      itemId: 'shortcut-browser',
    });

    expect(mocks.openDestination).toHaveBeenCalledWith({
      kind: 'settings',
      pageId: 'application.shortcuts',
    });
    expect(mocks.openScene).toHaveBeenCalledWith('settings');
  });

  it('routes terminal and editor items to their independent settings pages', async () => {
    await activateInteractiveCapability('setting.application.terminal', {
      itemId: 'default-shell',
    });
    expect(mocks.openDestination).toHaveBeenLastCalledWith({
      kind: 'settings',
      pageId: 'application.terminal',
    });

    await activateInteractiveCapability('setting.application.development', {
      itemId: 'editor-appearance',
    });
    expect(mocks.openDestination).toHaveBeenLastCalledWith({
      kind: 'settings',
      pageId: 'application.editor',
    });
  });

  it('rejects stale item IDs instead of silently opening the wrong place', async () => {
    await expect(activateInteractiveCapability('setting.application.shortcuts', {
      itemId: 'missing-item',
    })).rejects.toThrow('Unknown documented item');
    expect(mocks.openDestination).not.toHaveBeenCalled();
  });
});
