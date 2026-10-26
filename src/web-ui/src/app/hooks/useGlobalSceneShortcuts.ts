/**
 * Global shortcuts for the top SceneBar and scene quick-open actions.
 *
 * Scene navigation (allowInInput: true — fires from anywhere):
 *   Alt+1 / Alt+2 / Alt+3  — activate the 1st–3rd open scene left-to-right.
 *
 * Scene quick-open (allowInInput: true — fires from anywhere):
 *   Mod+Shift+A — open Agent/Session scene
 *   Mod+,       — open Settings scene
 *   Mod+Shift+` — open a terminal (terminal-create-requested)
 */

import { useCallback } from 'react';
import { useShortcut } from '@/infrastructure/hooks/useShortcut';
import { useSceneStore } from '@/app/stores/sceneStore';
import type { SceneTabId } from '@/app/components/SceneBar/types';

function activateSceneByStripIndex(index: number): void {
  const { openTabs, activateScene } = useSceneStore.getState();
  if (index < 0 || index >= openTabs.length) return;
  activateScene(openTabs[index].id);
}

function openSceneById(id: SceneTabId): void {
  useSceneStore.getState().openScene(id);
}

export function useGlobalSceneShortcuts(): void {
  const byIndex = useCallback((i: number) => () => activateSceneByStripIndex(i), []);

  // ── Scene-bar position shortcuts (Alt+1–3) ────────────────────────────
  useShortcut('scene.focus1', { key: '1', alt: true, scope: 'app', allowInInput: true }, byIndex(0), {
    priority: 12,
    description: 'keyboard.shortcuts.scene.focusMerged',
  });
  useShortcut('scene.focus2', { key: '2', alt: true, scope: 'app', allowInInput: true }, byIndex(1), {
    priority: 12,
    description: 'keyboard.shortcuts.scene.focusMerged',
  });
  useShortcut('scene.focus3', { key: '3', alt: true, scope: 'app', allowInInput: true }, byIndex(2), {
    priority: 12,
    description: 'keyboard.shortcuts.scene.focusMerged',
  });

  // ── Scene quick-open ──────────────────────────────────────────────────
  useShortcut(
    'scene.openSession',
    { key: 'A', ctrl: true, shift: true, scope: 'app', allowInInput: true },
    () => openSceneById('session'),
    { priority: 10, description: 'keyboard.shortcuts.scene.openSession' }
  );

  useShortcut(
    'scene.openSettings',
    { key: ',', ctrl: true, scope: 'app', allowInInput: true },
    () => openSceneById('settings'),
    { priority: 10, description: 'keyboard.shortcuts.scene.openSettings' }
  );

  useShortcut(
    'scene.openTerminal',
    { key: '`', ctrl: true, shift: true, scope: 'app', allowInInput: true },
    // The standalone terminal scene only mirrors a session another surface already
    // owns (terminalSceneStore.activeSessionId), so opening it directly lands on
    // its empty state with no shell. Go through the product's terminal create
    // action instead, the same one the quick action and nav panel use.
    () => {
      window.dispatchEvent(new CustomEvent('terminal-create-requested'));
    },
    { priority: 10, description: 'keyboard.shortcuts.scene.openTerminal' }
  );
}
