/**
 * Session-scoped memory for the session scene right pane (AuxPane).
 *
 * The layout itself stays global (`appManager.layout.rightPanelCollapsed`); this
 * module is the only place that maps the active session to the state it was
 * left with, so switching sessions restores the target session instead of
 * inheriting the state of the session that was active before.
 */

import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { appManager } from '../../services/AppManager';
import { collapseSessionAuxPane, expandSessionAuxPane } from './sessionPanelLayout';

/** Sessions that were never left before fall back to the collapsed default. */
const UNSEEN_SESSION_COLLAPSED = true;

/** In-memory only: a fresh start uses the app default for every session. */
const collapsedBySession = new Map<string, boolean>();

export function clearSessionAuxPaneMemory(): void {
  collapsedBySession.clear();
}

/**
 * Remembers the pane state of the session being left and applies the state of
 * the session being entered. Returns the unsubscribe function for the shell.
 */
export function startSessionAuxPaneMemory(): () => void {
  let previousSessionId = flowChatStore.getState().activeSessionId;

  return flowChatStore.subscribe(state => {
    const nextSessionId = state.activeSessionId;
    if (nextSessionId === previousSessionId) return;

    const leftSessionId = previousSessionId;
    previousSessionId = nextSessionId;

    if (leftSessionId) {
      collapsedBySession.set(
        leftSessionId,
        appManager.getState().layout.rightPanelCollapsed,
      );
    }
    if (!nextSessionId) return;

    // Both writers are idempotent and keep editor mode, where this pane is the
    // main content surface, untouched.
    if (collapsedBySession.get(nextSessionId) ?? UNSEEN_SESSION_COLLAPSED) {
      collapseSessionAuxPane();
    } else {
      expandSessionAuxPane();
    }
  });
}
