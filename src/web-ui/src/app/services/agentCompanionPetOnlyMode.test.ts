// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workspaceAPI = vi.hoisted(() => ({
  outerPositionOhos: vi.fn(),
  innerSizeOhos: vi.fn(),
  window_is_maximized: vi.fn(),
  unmaximizeOhos: vi.fn(),
  setAlwaysOnTopOhos: vi.fn(),
  setDecorationsOhos: vi.fn(),
  setWindowSizeOhos: vi.fn(),
  setWindowPositionOhos: vi.fn(),
  currentMonitorOhos: vi.fn(),
  maximizeOhos: vi.fn(),
}));

vi.mock('@/infrastructure/api', () => ({ workspaceAPI }));

import { enterPetOnlyMode, exitPetOnlyMode, isPetOnlyModeActive } from './agentCompanionPetOnlyMode';
import { useAgentCompanionPetOnlyModeStore } from '../stores/agentCompanionPetOnlyModeStore';

function resetStore(): void {
  useAgentCompanionPetOnlyModeStore.getState().setPetOnlyMode(false);
}

describe('agentCompanionPetOnlyMode (HarmonyOS minimize-to-pet morph)', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    resetStore();
    root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);

    for (const key of Object.keys(workspaceAPI) as Array<keyof typeof workspaceAPI>) {
      workspaceAPI[key].mockReset();
    }
    workspaceAPI.outerPositionOhos.mockResolvedValue({ x: 100, y: 100 });
    workspaceAPI.innerSizeOhos.mockResolvedValue({ width: 1280, height: 800 });
    workspaceAPI.window_is_maximized.mockResolvedValue(false);
    workspaceAPI.currentMonitorOhos.mockResolvedValue({
      width: 1920,
      height: 1080,
      scaleFactor: 1,
      avoidArea: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    workspaceAPI.setAlwaysOnTopOhos.mockResolvedValue(undefined);
    workspaceAPI.setDecorationsOhos.mockResolvedValue(undefined);
    workspaceAPI.setWindowSizeOhos.mockResolvedValue(undefined);
    workspaceAPI.setWindowPositionOhos.mockResolvedValue(undefined);
  });

  afterEach(() => {
    root.remove();
    resetStore();
  });

  it('morphs the main window into a small always-on-top surface and hides app content', async () => {
    await enterPetOnlyMode();

    expect(isPetOnlyModeActive()).toBe(true);
    // App content under #root is hidden so only the pet portal stays visible.
    expect(root.style.display).toBe('none');
    // Always-on-top + no decorations applied before the resize.
    expect(workspaceAPI.setAlwaysOnTopOhos).toHaveBeenCalledWith(true);
    expect(workspaceAPI.setDecorationsOhos).toHaveBeenCalledWith(false);
    // Physical size derived from the CSS size and scale factor (scale=1 here).
    expect(workspaceAPI.setWindowSizeOhos).toHaveBeenCalledWith(120, 120);
    // Positioned in the bottom-right work area (1920-120-12 = 1788, 1080-120-12 = 948).
    expect(workspaceAPI.setWindowPositionOhos).toHaveBeenCalledWith(1788, 948);
  });

  it('scales the pet-only size by the monitor scale factor', async () => {
    workspaceAPI.currentMonitorOhos.mockResolvedValue({
      width: 1920,
      height: 1080,
      scaleFactor: 2,
      avoidArea: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    await enterPetOnlyMode();

    // 120 CSS px * scale 2 = 240 physical px.
    expect(workspaceAPI.setWindowSizeOhos).toHaveBeenCalledWith(240, 240);
  });

  it('unmaximizes before morphing and restores maximize + decorations on exit', async () => {
    workspaceAPI.window_is_maximized.mockResolvedValue(true);

    await enterPetOnlyMode();
    expect(workspaceAPI.unmaximizeOhos).toHaveBeenCalled();

    await exitPetOnlyMode();
    expect(isPetOnlyModeActive()).toBe(false);
    expect(root.style.display).toBe('');
    expect(workspaceAPI.setWindowSizeOhos).toHaveBeenLastCalledWith(1280, 800);
    expect(workspaceAPI.setWindowPositionOhos).toHaveBeenLastCalledWith(100, 100);
    expect(workspaceAPI.maximizeOhos).toHaveBeenCalled();
    // Decorations are re-applied last (after maximize) per HarmonyOS chrome quirk.
    expect(workspaceAPI.setDecorationsOhos).toHaveBeenLastCalledWith(true);
  });

  it('restores nothing when not in pet-only mode', async () => {
    await exitPetOnlyMode();
    expect(workspaceAPI.setWindowSizeOhos).not.toHaveBeenCalled();
  });
});
