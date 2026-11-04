import { createStore } from 'zustand/vanilla';

export type SessionPaneDisplayMode = 'split' | 'overlay';
export const SESSION_PANE_DISPLAY_MODE_KEY = 'bitfun:appearance:sessionPaneDisplayMode';

export function createSessionPaneLayoutStore(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  let displayMode: SessionPaneDisplayMode = 'split';
  try {
    storage ??= typeof window === 'undefined' ? undefined : window.localStorage;
    if (storage?.getItem(SESSION_PANE_DISPLAY_MODE_KEY) === 'overlay') displayMode = 'overlay';
  } catch { /* An unavailable preference must not prevent opening a session. */ }

  return createStore<{
    displayMode: SessionPaneDisplayMode;
    setDisplayMode: (mode: SessionPaneDisplayMode) => void;
  }>((set, get) => ({
    displayMode,
    setDisplayMode: mode => {
      if (mode === get().displayMode) return;
      try { storage?.setItem(SESSION_PANE_DISPLAY_MODE_KEY, mode); }
      catch { /* Keep the selected layout for the current window. */ }
      set({ displayMode: mode });
    },
  }));
}

export const sessionPaneLayoutStore = createSessionPaneLayoutStore();
