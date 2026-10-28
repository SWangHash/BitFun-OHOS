/**
 * Active-session presentation projection.
 * FlowChatStore owns selection; ModernFlowChatStore only projects that selection.
 * Maintains original concept: Session → DialogTurn → ModelRound → FlowItem
 */

import { flowChatStore } from '../store/FlowChatStore';
import { useModernFlowChatStore } from '../store/modernFlowChatStore';
import type { Session } from '../types/flow-chat';

type SyncStatus = 'synced' | 'reference-only' | 'rebuild';

/**
 * Determine whether the modern store needs a full virtualItems rebuild or
 * just a reference refresh.
 *
 * - 'synced': the active session reference is identical — nothing to do.
 * - 'reference-only': the session object changed (e.g. a background
 *   turnCatalog update produced a new reference) but every field that
 *   affects virtualItems output is still the same. Only the activeSession
 *   pointer is refreshed; virtualItems are left untouched to avoid a
 *   visible flicker.
 * - 'rebuild': a render-relevant field changed (or the session switched,
 *   or virtualItems were erroneously cleared) — setActiveSession must
 *   recompute virtualItems.
 */
function checkSessionSync(
  sessionId: string,
  session: Session,
  modernStore: ReturnType<typeof useModernFlowChatStore.getState>
): SyncStatus {
  const cached = modernStore.activeSession;

  if (cached?.sessionId !== sessionId) {
    return 'rebuild';
  }

  if (cached === session) {
    if (session.historyState === 'ready' && hasRenderableContent(session) && modernStore.virtualItems.length === 0) {
      return 'rebuild';
    }
    return 'synced';
  }

  // Reference changed — check whether render-relevant fields are the same.
  // turnCatalog is excluded: it is index/metadata for history paging
  // navigation, not a render-relevant field for virtualItems output
  // (virtualItems are derived from dialogTurns). A turnCatalog-only update
  // (e.g. background completeSessionHistoryLoad updating turnCatalog while
  // deferring dialogTurns) must not trigger a virtualItems rebuild.
  const renderFieldsEqual =
    cached.dialogTurns === session.dialogTurns &&
    cached.isPartial === session.isPartial &&
    cached.totalTurnCount === session.totalTurnCount;

  if (renderFieldsEqual) {
    return 'reference-only';
  }

  return 'rebuild';
}

function hasRenderableContent(session: Session): boolean {
  return session.dialogTurns.some(turn =>
    Boolean(turn.userMessage) ||
    (turn.status === 'image_analyzing' && turn.modelRounds.length === 0) ||
    turn.modelRounds.some(round => round.items.length > 0)
  );
}

/**
 * Sync session data to new Store
 */
export function syncSessionToModernStore(sessionId: string): void {
  // An async opener may finish after selection changed or the session was
  // removed. Presentation sync must never become another selection writer.
  if (flowChatStore.getState().activeSessionId !== sessionId) return;
  syncActiveSessionToModernStore();
}

function syncActiveSessionToModernStore(): void {
  const state = flowChatStore.getState();
  const session = state.activeSessionId ? state.sessions.get(state.activeSessionId) : undefined;
  const modernStore = useModernFlowChatStore.getState();
  if (!session) {
    // Empty is an authoritative projection too, including the first sync after
    // remount and a dangling selection. Do not depend on subscriber-local history.
    if (modernStore.activeSession || modernStore.virtualItems.length || modernStore.visibleTurnInfo) {
      modernStore.clear();
    }
    return;
  }

  const syncStatus = checkSessionSync(session.sessionId, session, modernStore);
  if (syncStatus === 'synced') {
    return;
  }
  if (syncStatus === 'reference-only') {
    modernStore.updateActiveSessionReference(session);
    return;
  }
  modernStore.setActiveSession(session);
}

const syncConsumers = new Set<symbol>();
let unsubscribeSource: (() => void) | undefined;

/** Share one source subscription across the shell and standalone chat hosts. */
export function startAutoSync(): () => void {
  const consumer = Symbol();
  syncConsumers.add(consumer);
  unsubscribeSource ??= flowChatStore.subscribe(syncActiveSessionToModernStore);
  syncActiveSessionToModernStore();

  return () => {
    syncConsumers.delete(consumer);
    if (syncConsumers.size === 0) {
      unsubscribeSource?.();
      unsubscribeSource = undefined;
    }
  };
}
