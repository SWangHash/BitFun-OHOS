import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppManager } from './AppManager';
import { loadPanelWidth, savePanelWidth, STORAGE_KEYS } from '../layout/panelConfig';
import { storage } from '@/shared/utils/storageAdapter';

describe('AppManager layout updates', () => {
  afterEach(() => {
    storage.removeItem(STORAGE_KEYS.RIGHT_PANEL_LAST_WIDTH);
  });

  it('does not emit layout changes when the requested layout is already current', () => {
    const manager = new AppManager();
    const listener = vi.fn();
    manager.addEventListener(listener);
    const current = manager.getState().layout;

    manager.updateLayout({
      leftPanelActiveTab: current.leftPanelActiveTab,
      leftPanelCollapsed: current.leftPanelCollapsed,
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('emits layout changes when a layout value changes', () => {
    const manager = new AppManager();
    const listener = vi.fn();
    manager.addEventListener(listener);
    const current = manager.getState().layout;

    manager.updateLayout({
      leftPanelCollapsed: !current.leftPanelCollapsed,
    });

    expect(listener).toHaveBeenCalledWith({
      type: 'layout:changed',
      payload: {
        leftPanelCollapsed: !current.leftPanelCollapsed,
      },
    });
  });

  it('does not persist responsive right-panel width adjustments as user preference', () => {
    savePanelWidth(STORAGE_KEYS.RIGHT_PANEL_LAST_WIDTH, 720);
    const manager = new AppManager();

    manager.updateLayout({ rightPanelWidth: 480 });

    expect(manager.getState().layout.rightPanelWidth).toBe(480);
    expect(loadPanelWidth(STORAGE_KEYS.RIGHT_PANEL_LAST_WIDTH, 0)).toBe(720);
  });
});
