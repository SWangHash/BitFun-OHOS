/**
 * useKeyboardShortcuts Hook
 *
 * Registers canvas-level keyboard shortcuts via ShortcutManager.
 * All shortcuts use scope 'canvas' so they only fire when focus is inside
 * the editor canvas area (data-shortcut-scope="canvas").
 */

import { useCallback } from 'react';
import { useShortcut } from '@/infrastructure/hooks/useShortcut';
import { activeEditTargetService } from '@/tools/editor/services/ActiveEditTargetService';
import { useCanvasStore } from '../stores';
import type { EditorGroupId } from '../types';

interface UseKeyboardShortcutsOptions {
  enabled?: boolean;
  missionControlEnabled?: boolean;
  handleCloseWithDirtyCheck?: (tabId: string, groupId: EditorGroupId) => Promise<boolean>;
  onReveal?: () => void;
}

// Terminals consume Ctrl+2..8 as control characters (Esc via Ctrl+3, NUL via
// Ctrl+2, ...); tab switching must decline there so the shell keeps them.
function isTerminalFocused(event: KeyboardEvent): boolean {
  const target = event.target;
  return target instanceof Element && target.closest('[data-shortcut-scope="terminal"]') !== null;
}

export const useKeyboardShortcuts = (options: UseKeyboardShortcutsOptions = {}) => {
  const {
    enabled = true,
    missionControlEnabled = true,
    handleCloseWithDirtyCheck,
    onReveal,
  } = options;

  const {
    primaryGroup,
    secondaryGroup,
    activeGroupId,
    layout,
    closeTab,
    switchToTab,
    reopenClosedTab,
    closedTabs,
    setSplitMode,
    setAnchorPosition,
    toggleMaximize,
    toggleMissionControl,
  } = useCanvasStore();

  const getActiveGroup = useCallback(() => {
    return activeGroupId === 'primary' ? primaryGroup : secondaryGroup;
  }, [activeGroupId, primaryGroup, secondaryGroup]);

  // Find in file (Monaco) — only when `data-shortcut-scope="editor"` is innermost
  useShortcut(
    'editor.findInFile',
    { key: 'f', ctrl: true, scope: 'editor', allowInInput: true },
    () => {
      activeEditTargetService.openMonacoFind();
    },
    { enabled, priority: 20, description: 'keyboard.shortcuts.editor.findInFile' }
  );

  // Replace in file (Monaco find widget with replace visible)
  useShortcut(
    'editor.replaceInFile',
    { key: 'h', ctrl: true, scope: 'editor', allowInInput: true },
    () => {
      activeEditTargetService.openMonacoReplace();
    },
    { enabled, priority: 20, description: 'keyboard.shortcuts.editor.replaceInFile' }
  );

  // Canvas-scope fallback for find/replace (issue #432): files opened from the
  // home scene render their editor inside a 'canvas' scope and the editor
  // never receives DOM focus until clicked, so the 'editor'-scope bindings
  // above never fired. Gated to an editor-type active tab.
  const activeGroup = getActiveGroup();
  const activeCanvasTab = activeGroup.tabs.find((t) => t.id === activeGroup.activeTabId);
  const isEditorCanvasTabActive = Boolean(activeCanvasTab && (
    activeCanvasTab.content.type === 'code-editor'
    || activeCanvasTab.content.type === 'markdown-editor'
  ));

  useShortcut(
    'editor.findInFileCanvasFallback',
    { key: 'f', ctrl: true, scope: 'canvas', allowInInput: true },
    () => {
      activeEditTargetService.openMonacoFind();
    },
    { enabled: enabled && isEditorCanvasTabActive, priority: 5, description: 'keyboard.shortcuts.editor.findInFile' }
  );

  useShortcut(
    'editor.replaceInFileCanvasFallback',
    { key: 'h', ctrl: true, scope: 'canvas', allowInInput: true },
    () => {
      activeEditTargetService.openMonacoReplace();
    },
    { enabled: enabled && isEditorCanvasTabActive, priority: 5, description: 'keyboard.shortcuts.editor.replaceInFile' }
  );

  // Mission control
  useShortcut(
    'canvas.missionControl',
    { key: 'Tab', ctrl: true, scope: 'canvas', allowInInput: true },
    () => toggleMissionControl(),
    {
      enabled: enabled && missionControlEnabled,
      priority: 10,
      description: 'keyboard.shortcuts.canvas.missionControl',
    }
  );

  // Horizontal split: mod+\
  useShortcut(
    'canvas.splitHorizontal',
    { key: '\\', ctrl: true, scope: 'canvas' },
    () => setSplitMode(layout.splitMode === 'horizontal' ? 'none' : 'horizontal'),
    { enabled, description: 'keyboard.shortcuts.canvas.splitHorizontal' }
  );

  // Vertical split: mod+Shift+| (pressing Shift on the backslash key yields "|")
  useShortcut(
    'canvas.splitVertical',
    { key: '|', ctrl: true, shift: true, scope: 'canvas' },
    () => setSplitMode(layout.splitMode === 'vertical' ? 'none' : 'vertical'),
    { enabled, description: 'keyboard.shortcuts.canvas.splitVertical' }
  );

  // Anchor zone: mod+`
  useShortcut(
    'canvas.anchorZone',
    { key: '`', ctrl: true, scope: 'canvas' },
    () => setAnchorPosition(layout.anchorPosition === 'hidden' ? 'bottom' : 'hidden'),
    { enabled, description: 'keyboard.shortcuts.canvas.anchorZone' }
  );

  // Maximize: mod+Shift+E (mod+Shift+M conflicts with IME shortcuts)
  useShortcut(
    'canvas.maximize',
    { key: 'E', ctrl: true, shift: true, scope: 'canvas' },
    () => toggleMaximize(),
    { enabled, description: 'keyboard.shortcuts.canvas.maximize' }
  );

  // Close current tab: mod+W
  useShortcut(
    'tab.close',
    { key: 'W', ctrl: true, scope: 'canvas', allowInInput: true },
    () => {
      const activeGroup = getActiveGroup();
      if (!activeGroup.activeTabId) return;
      if (handleCloseWithDirtyCheck) {
        handleCloseWithDirtyCheck(activeGroup.activeTabId, activeGroupId);
      } else {
        closeTab(activeGroup.activeTabId, activeGroupId);
      }
    },
    { enabled, priority: 10, description: 'keyboard.shortcuts.tab.close' }
  );

  // Reopen closed tab: mod+Shift+T
  useShortcut(
    'tab.reopenClosed',
    { key: 'T', ctrl: true, shift: true, scope: 'canvas', allowInInput: true },
    () => {
      if (closedTabs.length === 0) return;
      reopenClosedTab();
      onReveal?.();
    },
    { enabled, priority: 10, description: 'keyboard.shortcuts.tab.reopenClosed' }
  );

  // Switch to tab by number: mod+1~9. App scope so the keys fire regardless
  // of where focus sits (chat input, file tree, git panel, <body>) — the
  // previous canvas scope silently disabled them outside the canvas. The
  // registration stays inside this hook because the canvas store resolves
  // per scene through React context, which the app-shell hooks cannot see.
  const switchToTabByIndex = useCallback(
    (index: number) => {
      const tabs = getActiveGroup().tabs.filter((tab) => !tab.isHidden);
      const target = index === -1 ? tabs[tabs.length - 1] : tabs[index];
      if (target) switchToTab(target.id, activeGroupId);
    },
    [getActiveGroup, switchToTab, activeGroupId]
  );

  const tabSwitchHandler = useCallback(
    (index: number) => (event: KeyboardEvent): boolean | void => {
      if (isTerminalFocused(event)) return false;
      switchToTabByIndex(index);
    },
    [switchToTabByIndex]
  );

  useShortcut('tab.switch1',    { key: '1', ctrl: true, scope: 'app', allowInInput: true }, tabSwitchHandler(0),  { enabled, description: 'keyboard.shortcuts.tab.switchMerged' });
  useShortcut('tab.switch2',    { key: '2', ctrl: true, scope: 'app', allowInInput: true }, tabSwitchHandler(1),  { enabled, description: 'keyboard.shortcuts.tab.switchMerged' });
  useShortcut('tab.switch3',    { key: '3', ctrl: true, scope: 'app', allowInInput: true }, tabSwitchHandler(2),  { enabled, description: 'keyboard.shortcuts.tab.switchMerged' });
  useShortcut('tab.switch4',    { key: '4', ctrl: true, scope: 'app', allowInInput: true }, tabSwitchHandler(3),  { enabled, description: 'keyboard.shortcuts.tab.switchMerged' });
  useShortcut('tab.switch5',    { key: '5', ctrl: true, scope: 'app', allowInInput: true }, tabSwitchHandler(4),  { enabled, description: 'keyboard.shortcuts.tab.switchMerged' });
  useShortcut('tab.switch6',    { key: '6', ctrl: true, scope: 'app', allowInInput: true }, tabSwitchHandler(5),  { enabled, description: 'keyboard.shortcuts.tab.switchMerged' });
  useShortcut('tab.switch7',    { key: '7', ctrl: true, scope: 'app', allowInInput: true }, tabSwitchHandler(6),  { enabled, description: 'keyboard.shortcuts.tab.switchMerged' });
  useShortcut('tab.switch8',    { key: '8', ctrl: true, scope: 'app', allowInInput: true }, tabSwitchHandler(7),  { enabled, description: 'keyboard.shortcuts.tab.switchMerged' });
  useShortcut('tab.switchLast', { key: '9', ctrl: true, scope: 'app', allowInInput: true }, tabSwitchHandler(-1), { enabled, description: 'keyboard.shortcuts.tab.switchMerged' });
};

export default useKeyboardShortcuts;
