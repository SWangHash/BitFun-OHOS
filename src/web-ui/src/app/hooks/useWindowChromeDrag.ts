/**
 * useWindowChromeDrag — custom-title-bar window drag gesture.
 *
 * On Windows, starting a native drag on a maximized window immediately
 * restores (unmaximizes) the window before any pointer movement, even for a
 * plain click. That made any plain click on toolbar chrome shrink the window
 * back to its normal size. To keep plain clicks inert while preserving
 * drag-to-move on a maximized window, we defer startDragging() until the
 * pointer actually moves past a small threshold. Non-maximized windows keep
 * the classic behavior: drag starts on mousedown, double-click maximizes.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { supportsNativeWindowDragging, isOpenHarmonyRuntime } from '@/infrastructure/runtime';
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
  /** Attach to the chrome container's onMouseDown. */
  onMouseDown: (event: React.MouseEvent) => void;
}

/**
 * Set up the chrome drag gesture. The returned onMouseDown handler must be
 * attached to the same element that receives the double-click maximize gesture
 * so both share the same interactive-target filtering.
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

  const onMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (!canDragWindow || event.button !== 0 || event.detail > 1) return;
      // Callers filter interactive targets (buttons, inputs, tabs...) before
      // calling; this hook only handles the raw chrome gesture.
      if (event.defaultPrevented) return;
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

      if (!isMaximized) {
        startChromeDragging();
        return;
      }

      if (isOpenHarmonyRuntime()) {
        // ArkUI's startMoving() restores a maximized window immediately. Keep
        // a click inert on the custom chrome; double-click is handled by the
        // parent bar and calls the native maximize/recover command directly.
        return;
      }

      // Maximized: defer until the pointer moves past the threshold so plain
      // clicks stay inert and the window is not restored by a bare click.
      const onPointerMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - event.clientX;
        const dy = moveEvent.clientY - event.clientY;
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
    },
    [canDragWindow, isMaximized, startChromeDragging, teardownGesture],
  );

  return { onMouseDown };
};
