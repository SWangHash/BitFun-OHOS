import { useEffect, useRef, useState, type RefObject, type MutableRefObject } from 'react';
import type { VirtualItem } from '../../store/modernFlowChatStore';
import { VirtualItemRenderer } from '../modern/VirtualItemRenderer';
import { useFlowChatVirtualizer } from '../modern/useFlowChatVirtualizer';
import type { FlowChatViewportOwnerApi } from '../modern/useFlowChatViewportOwner';
import { getVirtualItemStableKey } from '../modern/virtualItemIdentity';
import { estimateVirtualMessageItemHeightWithContext } from '../modern/virtualMessageListLayout';
import type { BtwPanelViewState } from './btwPanelViewState';
import { useBtwPanelViewport } from './useBtwPanelViewport';
import { globalEventBus } from '@/infrastructure/event-bus';
import { getActiveSurfaceScope } from '@/infrastructure/peer-device/deviceSurface';
import { FLOWCHAT_FOCUS_ITEM_EVENT, type FlowChatFocusItemRequest } from '../../events/flowchatNavigation';
import { findExcerptTextRoot, highlightLocatedExcerpt } from '../../selection/locateConversationExcerpt';
import { resolveExcerptRange } from '../../selection/flowChatSelection';
import { resolveFlowChatFocusTarget } from '../modern/flowChatFocusTarget';

interface BtwVirtualSessionListProps {
  items: VirtualItem[];
  scrollerRef: RefObject<HTMLDivElement | null>;
  headerRef: RefObject<HTMLDivElement | null>;
  followRef: MutableRefObject<boolean>;
  viewportOwner: FlowChatViewportOwnerApi;
  exploreGroupStates: Map<string, boolean>;
  isHistorical: boolean;
  viewState?: BtwPanelViewState;
  onExpandGroup?: (id: string) => void;
}

/** The embedded transcript shares row placement, not the primary session shell. */
export function BtwVirtualSessionList({
  items, scrollerRef, headerRef, followRef, viewportOwner,
  exploreGroupStates, isHistorical, viewState, onExpandGroup,
}: BtwVirtualSessionListProps) {
  const windowRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const updateWidth = () => setWidth(scroller.clientWidth);
    const observer = new ResizeObserver(updateWidth);
    observer.observe(scroller);
    updateWidth();
    return () => observer.disconnect();
  }, [scrollerRef]);
  const virtualizer = useFlowChatVirtualizer({
    items,
    scrollerRef,
    headerRef,
    getItemKey: getVirtualItemStableKey,
    estimateItemHeightPx: estimateVirtualMessageItemHeightWithContext,
    estimateContext: {
      availableWidthPx: width || undefined,
      exploreGroupStates,
      isHistorical,
    },
    estimateContextRevision: `${width}|${isHistorical}|${[...exploreGroupStates]
      .map(([id, expanded]) => `${id}:${expanded}`).join(',')}`,
    scrollPaddingStartPx: 0,
    writeViewport: viewportOwner.write,
    shiftViewport: viewportOwner.shift,
  });
  useBtwPanelViewport(viewState, items, scrollerRef, windowRef, virtualizer, viewportOwner);
  const navigationRef = useRef({ items, virtualizer, onExpandGroup });
  navigationRef.current = { items, virtualizer, onExpandGroup };
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let generation = 0;
    let frame = 0;
    const cancel = () => { generation++; cancelAnimationFrame(frame); navigationRef.current.virtualizer.cancelAim(); };
    const unsubscribe = globalEventBus.on<FlowChatFocusItemRequest>(FLOWCHAT_FOCUS_ITEM_EVENT, request => {
      if (!request.embedded || !request.excerpt || request.sessionId !== scroller.dataset.flowchatSelectionRoot) return;
      cancel();
      const ownGeneration = generation;
      const scope = getActiveSurfaceScope();
      if (request.surfaceEpoch !== scope.epoch) return;
      const excerpt = request.excerpt;
      const fragment = excerpt.fragments[0];
      const startedAt = performance.now();
      let materialized = false;
      followRef.current = false;
      if (viewState) viewState.followTail = false;
      const aim = () => {
        if (generation !== ownGeneration || !scope.isCurrent()) return;
        const current = navigationRef.current;
        const source = findExcerptTextRoot(excerpt);
        const range = source && resolveExcerptRange(source, fragment);
        if (range) {
          const bounds = scroller.getBoundingClientRect();
          const rect = range.getBoundingClientRect();
          current.virtualizer.cancelAim();
          if (rect.top < bounds.top || rect.bottom > bounds.bottom) {
            current.virtualizer.scrollToOffset(scroller.scrollTop + rect.top - bounds.top - bounds.height / 3,
              { owner: 'one-shot-navigation', holdForMs: 0 });
          }
          highlightLocatedExcerpt(excerpt);
          return;
        }
        if (!materialized) {
          const target = resolveFlowChatFocusTarget(request, current.items);
          const index = fragment.flowItemId ? target.resolvedVirtualIndex
            : current.items.findIndex(item => item.type === 'user-message' && item.turnId === fragment.turnId);
          if (index === undefined || index < 0) { request.onUnavailable?.(); return; }
          if (target.expandExploreGroupId) current.onExpandGroup?.(target.expandExploreGroupId);
          current.virtualizer.scrollItemIntoView(index, { align: 'center', owner: 'one-shot-navigation' });
          materialized = true;
        }
        if (performance.now() - startedAt >= 2000) { request.onUnavailable?.(); return; }
        frame = requestAnimationFrame(aim);
      };
      aim();
    });
    scroller.addEventListener('wheel', cancel, { passive: true });
    scroller.addEventListener('touchmove', cancel, { passive: true });
    scroller.addEventListener('pointerdown', cancel);
    scroller.addEventListener('keydown', cancel);
    return () => {
      cancel(); unsubscribe(); scroller.removeEventListener('wheel', cancel); scroller.removeEventListener('touchmove', cancel);
      scroller.removeEventListener('pointerdown', cancel); scroller.removeEventListener('keydown', cancel);
    };
  }, [scrollerRef, followRef, viewState]);

  // Estimated offscreen rows change the scroll range as they mount. Follow
  // those measurements as well as streamed data, but recheck user intent in
  // the frame itself so a queued update cannot undo an upward gesture.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const window = windowRef.current;
    if (!scroller || !window) return;
    let frame: number | undefined;
    const follow = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (!followRef.current || scroller.clientHeight === 0) return;
        viewportOwner.write({ owner: 'follow-output', topPx: scroller.scrollHeight, holdForMs: 0 });
      });
    };
    const observer = new ResizeObserver(follow);
    observer.observe(window);
    observer.observe(scroller);
    follow();
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [items, virtualizer.rows, scrollerRef, followRef, viewportOwner]);

  return (
    <div
      ref={windowRef}
      style={{ paddingTop: virtualizer.paddingTopPx, paddingBottom: virtualizer.paddingBottomPx }}
    >
      {virtualizer.rows.map(row => (
        <VirtualItemRenderer
          key={row.key}
          item={items[row.index]}
          index={row.index}
          measureRef={virtualizer.measureRowElement}
        />
      ))}
    </div>
  );
}
