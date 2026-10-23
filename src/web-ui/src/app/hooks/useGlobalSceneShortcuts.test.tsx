// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { shortcutManager } from '@/infrastructure/services/ShortcutManager';
import { APP_SHORTCUTS } from '@/shared/constants/shortcuts';
import { useGlobalSceneShortcuts } from './useGlobalSceneShortcuts';

const { openScene } = vi.hoisted(() => ({ openScene: vi.fn() }));
vi.mock('@/app/stores/sceneStore', () => ({
  useSceneStore: { getState: () => ({ openScene }) },
}));

function ShortcutHost() {
  useGlobalSceneShortcuts();
  return null;
}

it('does not open Git from default or saved shortcut bindings while other scene shortcuts stay active', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Win32');
  shortcutManager.clear();
  shortcutManager.setEnabled(true);
  shortcutManager.loadUserOverrides({
    'scene.openGit': { key: 'G', ctrl: true, alt: true },
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const press = (key: string, modifiers: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', {
      key, ctrlKey: true, bubbles: true, cancelable: true, ...modifiers,
    });
    act(() => document.body.dispatchEvent(event));
    return event;
  };

  try {
    act(() => root.render(<ShortcutHost />));
    expect(APP_SHORTCUTS.some(({ id }) => id === 'scene.openGit')).toBe(false);
    expect(press('G', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(press('G', { altKey: true }).defaultPrevented).toBe(false);
    expect(openScene).not.toHaveBeenCalled();
    expect(press(',').defaultPrevented).toBe(true);
    expect(openScene).toHaveBeenCalledWith('settings');
  } finally {
    act(() => root.unmount());
    container.remove();
    shortcutManager.clear();
    shortcutManager.loadUserOverrides({});
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
