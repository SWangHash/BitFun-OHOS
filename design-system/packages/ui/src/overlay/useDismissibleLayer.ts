import {
  useEffect,
  useRef,
  type RefObject,
} from "react";
import { getOverlayLayerStack, useOverlayLayerStack } from "./LayerStack";
import type {
  OverlayDismissReason,
  OverlayLayerScope,
} from "./types";

export interface UseDismissibleLayerOptions {
  branchRefs?: readonly RefObject<HTMLElement | null>[];
  containsTarget?: (target: Node) => boolean;
  dismissOnEscape?: boolean;
  dismissOnPointerOutside?: boolean;
  enabled: boolean;
  layerRef: RefObject<HTMLElement | null>;
  onDismiss: (reason: OverlayDismissReason) => void;
  ownerDocument?: Document | null;
  scope?: OverlayLayerScope;
}

export function useDismissibleLayer({
  branchRefs = [],
  containsTarget,
  dismissOnEscape = true,
  dismissOnPointerOutside = true,
  enabled,
  layerRef,
  onDismiss,
  ownerDocument,
  scope,
}: UseDismissibleLayerOptions): symbol {
  const inheritedStack = useOverlayLayerStack();
  const identityRef = useRef(Symbol("bitfun-overlay-layer"));
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  // Guards that are not identity-stable stay behind a ref so a content update
  // does not reissue the registration ticket.
  const guardsRef = useRef({ branchRefs, containsTarget });
  guardsRef.current = { branchRefs, containsTarget };

  useEffect(() => {
    if (!enabled) return;
    // The stack that owns the surface document resolves both ranking and
    // dismissal, so the dismissible must register where its layer is ranked.
    const documentOwner = ownerDocument
      ?? layerRef.current?.ownerDocument
      ?? (typeof document === "undefined" ? null : document);
    const stack = documentOwner ? getOverlayLayerStack(documentOwner) : inheritedStack;
    return stack.register({
      id: identityRef.current,
      onDismiss: (reason) => onDismissRef.current(reason),
      scope,
      // The coordinator ranks the dismissible against the painted layers, so the
      // owned surface and its guards are part of the registration.
      element: () => layerRef.current,
      containsTarget: (target) => {
        const guards = guardsRef.current;
        return guards.branchRefs.some((branchRef) => branchRef.current?.contains(target))
          || Boolean(guards.containsTarget?.(target));
      },
      dismissOnEscape,
      dismissOnPointerOutside,
    });
  }, [dismissOnEscape, dismissOnPointerOutside, enabled, inheritedStack, layerRef, ownerDocument, scope]);

  return identityRef.current;
}
