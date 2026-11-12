/**
 * useWindowChromeDrag — custom-title-bar window drag gesture.
 *
 * A native drag start restores (unmaximizes) a maximized window immediately,
 * even for a plain click: on Windows the posted `WM_NCLBUTTONDOWN`/`HTCAPTION`
 * pair restores the window straight away, and the OpenHarmony host's
 * `startMoving()` does the same. Starting the drag on mousedown therefore made
 * any plain click on toolbar chrome shrink the window back to its normal size.
 *
 * To keep plain clicks inert while preserving drag-to-move on a maximized
 * window, we defer `startDragging()` until the pointer actually moves past a
 * small threshold. Non-maximized windows keep the classic behavior: drag
 * starts on mousedown, double-click maximizes.
 *
 * A maximized window keeps using the host move loop: ArkUI's `startMoving()`
 * restores the window and then tracks the pointer itself. Restoring the window
 * from the shell first (`recover()`) would end the original press and the move
 * loop could no longer attach, which is why this hook never restores it.
 *
 * Touch input cannot use the mouse path: the browser only synthesizes
 * `mousedown` after the finger lifts (and suppresses it entirely once a pan
 * starts), so a touch drag never reached the move loop. Touch and pen therefore
 * enter through `onPointerDown`, which fires while the finger is still down.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { supportsNativeWindowDragging } from '@/infrastructure/runtime';
import { workspaceAPI } from '@/infrastructure/api';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('useWindowChromeDrag');

/** Movement (px) a pointer must exceed before a maximized window starts dragging. */
const MAXIMIZED_DRAG_START_THRESHOLD_PX = 6;

/** Minimum mousedown interval for a deliberate double-click; plain re-entry ignored. */
const DOUBLE_CLICK_GUARD_MS = 500;
/** Ignore re-entry within this window (the first click of the pair). */
const DOUBLE_CLICK_REENTRY_MS = 50;

/** Pending maximized-gesture listeners, torn down together. */
interface PendingGesture {
  onMove: (event: PointerEvent) => void;
  onUp: () => void;
}

export interface WindowChromeDragOptions {
  /** Whether the window is currently maximized. */
  isMaximized?: boolean;
}

export interface WindowChromeDragHandlers {
  /** Attach to the chrome container's onMouseDown (mouse drag path). */
  onMouseDown: (event: React.MouseEvent) => void;
  /** Attach to the same container's onPointerDown (touch and pen drag path). */
  onPointerDown: (event: React.PointerEvent) => void;
}

/**
 * Set up the chrome drag gesture. Both returned handlers must be attached to
 * the same element that receives the double-click maximize gesture so they
 * share the same interactive-target filtering.
 */
export const useWindowChromeDrag = (
  options: WindowChromeDragOptions = {},
): WindowChromeDragHandlers => {
  const { isMaximized = false } = options;
  const canDragWindow = useMemo(() => supportsNativeWindowDragging(), []);
  const lastMouseDownTimeRef = useRef(0);
  // Pending maximized-gesture listeners registered on window; removed on
  // pointerup/threshold crossing, on a newer mousedown, and on unmount so a
  // mid-gesture teardown never leaks listeners.
  const pendingGestureRef = useRef<PendingGesture | null>(null);

  const teardownGesture = useCallback(() => {
    const gesture = pendingGestureRef.current;
    if (!gesture) return;
    window.removeEventListener('pointermove', gesture.onMove, true);
    window.removeEventListener('pointerup', gesture.onUp, true);
    window.removeEventListener('pointercancel', gesture.onUp, true);
    window.removeEventListener('blur', gesture.onUp, true);
    pendingGestureRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      teardownGesture();
    };
  }, [teardownGesture]);

  const startChromeDragging = useCallback(() => {
    void workspaceAPI.startWindowDragging().catch((error) => {
      log.debug('startDragging failed', error);
    });
  }, []);

  const beginGesture = useCallback(
    (originX: number, originY: number) => {
      // Dispose a stale pending gesture (e.g. the window state changed between
      // renders) before starting a fresh one.
      teardownGesture();

      const now = Date.now();
      const timeSinceLastMouseDown = now - lastMouseDownTimeRef.current;
      lastMouseDownTimeRef.current = now;
      if (
        timeSinceLastMouseDown < DOUBLE_CLICK_GUARD_MS &&
        timeSinceLastMouseDown > DOUBLE_CLICK_REENTRY_MS
      ) {
        return;
      }

      const startOrDeferChromeDragging = async () => {
        let maximized = isMaximized;
        if (!maximized) {
          try {
            maximized = await workspaceAPI.window_is_maximized();
          } catch {
            // Keep the rendered state as the fallback when the native query is
            // unavailable during startup or a window transition.
          }
        }

        if (!maximized) {
          startChromeDragging();
          return;
        }

        // Native maximize can precede the asynchronous React state update.
        // Require movement regardless of that state so a plain click never
        // starts a native drag (which can restore the window immediately).
        // The OpenHarmony ArkUI host has the same policy: `startMoving()`
        // restores a maximized window on press and then owns the move, so the
        // request must wait for real pointer movement.
        const onPointerMove = (moveEvent: PointerEvent) => {
          const dx = moveEvent.clientX - originX;
          const dy = moveEvent.clientY - originY;
          if (
            dx * dx + dy * dy <
            MAXIMIZED_DRAG_START_THRESHOLD_PX * MAXIMIZED_DRAG_START_THRESHOLD_PX
          ) {
            return;
          }
          teardownGesture();
          startChromeDragging();
        };
        const onPointerUp = () => teardownGesture();
        pendingGestureRef.current = { onMove: onPointerMove, onUp: onPointerUp };
        window.addEventListener('pointermove', onPointerMove, true);
        window.addEventListener('pointerup', onPointerUp, true);
        window.addEventListener('pointercancel', onPointerUp, true);
        window.addEventListener('blur', onPointerUp, true);
      };

      void startOrDeferChromeDragging();
    },
    [isMaximized, startChromeDragging, teardownGesture],
  );

  const onMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (!canDragWindow || event.button !== 0 || event.detail > 1) return;
      // Callers filter interactive targets (buttons, inputs, tabs...) before
      // calling; this hook only handles the raw chrome gesture.
      if (event.defaultPrevented) return;
      beginGesture(event.clientX, event.clientY);
    },
    [beginGesture, canDragWindow],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Mouse pointers keep the mouse path above; React fires pointer events
      // before the compatibility mousedown, so acting here too would start two
      // drags for one press.
      if (event.pointerType === 'mouse') return;
      if (!canDragWindow || event.button !== 0) return;
      if (event.defaultPrevented) return;
      // Keep the WebView from turning the press into text selection or a
      // compatibility mouse gesture; the window move loop owns it from here.
      event.preventDefault();
      beginGesture(event.clientX, event.clientY);
    },
    [beginGesture, canDragWindow],
  );

  return { onMouseDown, onPointerDown };
};
