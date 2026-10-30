import { describe, expect, it, vi } from 'vitest';

import { AppManager } from './AppManager';
import { STORAGE_KEYS } from '../layout/panelConfig';
import { storage } from '@/shared/utils/storageAdapter';

describe('AppManager layout updates', () => {
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

  it('persists a width the user chose', () => {
    const manager = new AppManager();

    manager.updateLayout({ rightPanelWidth: 640 });

    expect(storage.getItem(STORAGE_KEYS.RIGHT_PANEL_LAST_WIDTH)).toBe('640');
  });

  it('keeps the remembered width when a fitted width is applied', () => {
    const manager = new AppManager();
    storage.setItem(STORAGE_KEYS.RIGHT_PANEL_LAST_WIDTH, '640');

    manager.updateLayout({ rightPanelWidth: 420 }, { persistPanelSizes: false });

    expect(manager.getState().layout.rightPanelWidth).toBe(420);
    expect(storage.getItem(STORAGE_KEYS.RIGHT_PANEL_LAST_WIDTH)).toBe('640');
  });
});
