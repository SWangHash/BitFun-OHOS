// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { shortcutManager } from '@/infrastructure/services/ShortcutManager';
import { APP_SHORTCUTS } from '@/shared/constants/shortcuts';
import { useGlobalSceneShortcuts } from './useGlobalSceneShortcuts';

const { openScene } = vi.hoisted(() => ({ openScene: vi.fn() }));
vi.mock('@/app/stores/sceneStore', () => ({
  useSceneStore: {
    getState: () => ({ openScene, openTabs: [], activateScene: vi.fn() }),
  },
}));

function ShortcutHost(): null {
  useGlobalSceneShortcuts();
  return null;
}

function pressKey(key: string, modifiers: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key, ctrlKey: true, bubbles: true, cancelable: true, ...modifiers,
  });
  act(() => document.body.dispatchEvent(event));
  return event;
}

function pressTerminalShortcut(): void {
  // Windows/Chromium reports `key: "~"` for Shift+Backquote; the shortcut names
  // the base character "`".
  document.body.dispatchEvent(new KeyboardEvent('keydown', {
    key: '~',
    code: 'Backquote',
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  }));
}

describe('useGlobalSceneShortcuts', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Win32');
    shortcutManager.clear();
    shortcutManager.loadUserOverrides({});
    shortcutManager.setEnabled(true);
    openScene.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    shortcutManager.clear();
    shortcutManager.loadUserOverrides({});
    vi.restoreAllMocks();
  });

  it('does not open Git from default or saved shortcut bindings while other scene shortcuts stay active', () => {
    shortcutManager.loadUserOverrides({
      'scene.openGit': { key: 'G', ctrl: true, alt: true },
    });

    act(() => root.render(<ShortcutHost />));

    expect(APP_SHORTCUTS.some(({ id }) => id === 'scene.openGit')).toBe(false);
    expect(pressKey('G', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(pressKey('G', { altKey: true }).defaultPrevented).toBe(false);
    expect(openScene).not.toHaveBeenCalled();
    expect(pressKey(',').defaultPrevented).toBe(true);
    expect(openScene).toHaveBeenCalledWith('settings');
  });

  it('requests a terminal instead of opening the empty terminal scene', async () => {
    const requested = vi.fn();
    window.addEventListener('terminal-create-requested', requested);
    try {
      await act(async () => root.render(<ShortcutHost />));

      await act(async () => { pressTerminalShortcut(); });

      expect(requested).toHaveBeenCalledTimes(1);
      expect(openScene).not.toHaveBeenCalledWith('terminal');
    } finally {
      window.removeEventListener('terminal-create-requested', requested);
    }
  });
});
