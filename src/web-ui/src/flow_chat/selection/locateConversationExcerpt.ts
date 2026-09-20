import { globalEventBus } from '@/infrastructure/event-bus';
import { getActiveSurfaceScope } from '@/infrastructure/peer-device/deviceSurface';
import type { ConversationExcerptContext } from '@/shared/types/context';
import { FLOWCHAT_FOCUS_ITEM_EVENT, type FlowChatFocusItemRequest } from '../events/flowchatNavigation';
import { flowChatStore } from '../store/FlowChatStore';
import { SELECTION_ROOT, findExcerptSource, resolveExcerptRange } from './flowChatSelection';

export function findExcerptTextRoot(excerpt: ConversationExcerptContext): HTMLElement | null {
  const root = Array.from(document.querySelectorAll<HTMLElement>(SELECTION_ROOT))
    .find(node => node.dataset.flowchatSelectionRoot === excerpt.source.sessionId && node.getClientRects().length > 0);
  if (!root) return null;
  return findExcerptSource(root, excerpt.fragments[0]);
}

let clearLastHighlight: (() => void) | undefined;
export function highlightExcerptRange(range: Range): () => void {
  clearLastHighlight?.();
  const css = globalThis.CSS as (typeof CSS & { highlights?: Map<string, unknown> }) | undefined;
  const HighlightType = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!css?.highlights || !HighlightType) return () => undefined;
  const highlight = new HighlightType(range);
  css.highlights.set('bitfun-flowchat-excerpt', highlight);
  const clear = () => {
    if (css.highlights?.get('bitfun-flowchat-excerpt') === highlight) css.highlights.delete('bitfun-flowchat-excerpt');
    if (clearLastHighlight === clear) clearLastHighlight = undefined;
  };
  clearLastHighlight = clear;
  return clear;
}

export function highlightLocatedExcerpt(excerpt: ConversationExcerptContext): boolean {
  const root = findExcerptTextRoot(excerpt);
  const range = root && resolveExcerptRange(root, excerpt.fragments[0]);
  if (!range) return false;
  const clear = highlightExcerptRange(range);
  window.setTimeout(clear, 1800);
  return true;
}

let locateRequest = 0;
export async function locateConversationExcerpt(excerpt: ConversationExcerptContext, onUnavailable: () => void): Promise<void> {
  const request = ++locateRequest;
  const scope = getActiveSurfaceScope();
  const isCurrent = () => scope.isCurrent() && request === locateRequest;
  const source = flowChatStore.getState().sessions.get(excerpt.source.sessionId);
  if (scope.surfaceId !== excerpt.source.surfaceId || !source) return onUnavailable();
  const mainSessionId = source.parentSessionId || source.sessionId;
  const isSourceActive = () => isCurrent() && flowChatStore.getState().activeSessionId === mainSessionId;
  try {
    const { openMainSession } = await import('../services/sessionActivation');
    if (!isCurrent()) return;
    await openMainSession(mainSessionId, { isCurrent });
    if (!isSourceActive()) return;
    if (source.parentSessionId) {
      const { openBtwSessionInAuxPane } = await import('../services/btwSessionPane');
      const { expandSessionAuxPane } = await import('@/app/scenes/session/sessionPanelLayout');
      if (!isSourceActive()) return;
      openBtwSessionInAuxPane({ childSessionId: source.sessionId, parentSessionId: source.parentSessionId,
        workspacePath: source.workspacePath, expand: false });
      expandSessionAuxPane();
    }
    const fragment = excerpt.fragments[0];
    // Wait for the real mounted viewport; an inactive AuxPane unmounts its listeners.
    const startedAt = performance.now();
    const dispatch = () => {
      if (!isSourceActive()) return;
      const mounted = Array.from(document.querySelectorAll<HTMLElement>(SELECTION_ROOT))
        .some(node => node.dataset.flowchatSelectionRoot === source.sessionId
          && node.dataset.flowchatExcerptReady === source.sessionId && node.getClientRects().length > 0);
      if (!mounted) {
        if (performance.now() - startedAt < 2000) requestAnimationFrame(dispatch);
        else onUnavailable();
        return;
      }
      globalEventBus.emit<FlowChatFocusItemRequest>(FLOWCHAT_FOCUS_ITEM_EVENT, {
        sessionId: source.sessionId, turnId: fragment.turnId, itemId: fragment.flowItemId,
        excerpt, embedded: !!source.parentSessionId, surfaceEpoch: scope.epoch, onUnavailable,
      });
    };
    requestAnimationFrame(dispatch);
  } catch {
    if (isCurrent()) onUnavailable();
  }
}
