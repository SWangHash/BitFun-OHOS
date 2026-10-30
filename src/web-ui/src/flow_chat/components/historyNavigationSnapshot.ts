/**
 * Per-session snapshots for input-history navigation.
 *
 * When the user browses history with ArrowUp and then switches sessions, the
 * browsed history message has already been persisted as the session's draft
 * (dispatchInput writes to sessionComposerStore on every SET_VALUE), but
 * ChatInput's navigation state (historyIndex/savedDraft) is component-local
 * and was reset to "draft mode" on the switch. Switching back restored the
 * browsed message into the input while claiming it was a plain draft, so the
 * next ArrowUp restarted navigation from index 0 (re-showing the same
 * message) after one un-intercepted native caret jump.
 *
 * These helpers keep an in-memory snapshot per session and restore it when
 * the restored draft still matches the browsed history entry.
 */

export interface HistoryNavigationSnapshot {
  historyIndex: number;
  savedDraft: string;
}

export type HistoryNavigationSnapshotMap = Map<string, HistoryNavigationSnapshot>;

/**
 * Save a navigation snapshot for a session before switching away.
 * Only snapshots active browsing sessions (historyIndex !== -1); sessions
 * that were in draft mode keep no snapshot.
 */
export function saveHistoryNavigationSnapshot(
  snapshots: HistoryNavigationSnapshotMap,
  sessionId: string | null | undefined,
  historyIndex: number,
  savedDraft: string,
): void {
  if (!sessionId || historyIndex === -1) {
    return;
  }
  snapshots.set(sessionId, { historyIndex, savedDraft });
}

/**
 * Resolve the navigation state to restore for a session.
 *
 * Restores the snapshot only when the restored draft value still equals the
 * browsed history entry — if the draft was edited (or the history list
 * changed so the index is out of bounds), the snapshot is stale: drop it and
 * fall back to draft mode.
 */
export function resolveHistoryNavigationSnapshot(
  snapshots: HistoryNavigationSnapshotMap,
  sessionId: string | null | undefined,
  restoredDraftValue: string,
  inputHistory: readonly string[],
): HistoryNavigationSnapshot | null {
  if (!sessionId) {
    return null;
  }
  const snapshot = snapshots.get(sessionId);
  if (!snapshot) {
    return null;
  }
  const isValid =
    snapshot.historyIndex >= 0 &&
    snapshot.historyIndex < inputHistory.length &&
    inputHistory[snapshot.historyIndex] === restoredDraftValue;
  if (!isValid) {
    snapshots.delete(sessionId);
    return null;
  }
  return snapshot;
}

/** Drop a session's snapshot when navigation leaves browse mode. */
export function clearHistoryNavigationSnapshot(
  snapshots: HistoryNavigationSnapshotMap,
  sessionId: string | null | undefined,
): void {
  if (sessionId) {
    snapshots.delete(sessionId);
  }
}
