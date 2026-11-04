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
 * window, we defer the drag until the pointer actually moves past a small
 * threshold. Non-maximized windows keep the classic behavior: drag starts on
 * mousedown, double-click maximizes.
 *
 * The OpenHarmony host cannot restart its move loop after a restore ends the
 * original press, so there the shell restores the window itself and applies the
 * pointer delta (see `startOhosMaximizedChromeMove`).
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { isOpenHarmonyRuntime, supportsNativeWindowDragging } from '@/infrastructure/runtime';
import { workspaceAPI } from '@/infrastructure/api';
import type { OhosWindowDragGeometry } from '@/infrastructure/api/service-api/WorkspaceAPI';
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

/** A shell-driven window move that keeps tracking the pointer until release. */
interface PendingMove {
  stop: () => void;
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
  // Shell-driven OpenHarmony move, plus a generation counter so a move that is
  // still restoring the window cannot attach after a newer gesture or teardown.
  const pendingMoveRef = useRef<PendingMove | null>(null);
  const moveGenerationRef = useRef(0);

  const teardownGesture = useCallback(() => {
    const gesture = pendingGestureRef.current;
    if (!gesture) return;
    window.removeEventListener('pointermove', gesture.onMove, true);
    window.removeEventListener('pointerup', gesture.onUp, true);
    window.removeEventListener('pointercancel', gesture.onUp, true);
    window.removeEventListener('blur', gesture.onUp, true);
    pendingGestureRef.current = null;
  }, []);

  const stopPendingMove = useCallback(() => {
    moveGenerationRef.current += 1;
    pendingMoveRef.current?.stop();
    pendingMoveRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      teardownGesture();
      stopPendingMove();
    };
  }, [stopPendingMove, teardownGesture]);

  const startChromeDragging = useCallback(() => {
    void workspaceAPI.startWindowDragging().catch((error) => {
      log.debug('startDragging failed', error);
    });
  }, []);

  /**
   * Restore a maximized OpenHarmony window next to the grab point and move it
   * with the pointer.
   *
   * The ArkUI host only enters its move loop from the original press, and
   * restoring the window ends that press: asking it to start moving afterwards
   * leaves the window at its restored geometry without following the pointer.
   * So the host is asked to restore and re-place the window, and the pointer
   * delta is applied here with `moveWindowTo`.
   *
   * Deltas come from screen coordinates, not client coordinates: the window
   * moves underneath the pointer, which would otherwise cancel out the delta.
   */
  const startOhosMaximizedChromeMove = useCallback(
    async (origin: { screenX: number; screenY: number; offsetX: number; offsetY: number }) => {
      const scale =
        typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0
          ? window.devicePixelRatio
          : 1;
      const generation = moveGenerationRef.current;
      let geometry: OhosWindowDragGeometry;
      try {
        geometry = await workspaceAPI.beginWindowDragOhos({
          offsetX: Math.round(origin.offsetX * scale),
          offsetY: Math.round(origin.offsetY * scale),
        });
      } catch (error) {
        log.debug('failed to begin the host window drag', error);
        // Without the prepared geometry there is nothing to track. Restore the
        // window so the next drag lands on the native normal-window path.
        void workspaceAPI.handle_restore_window().catch(() => {});
        return;
      }
      if (generation !== moveGenerationRef.current) return;

      let latestX = origin.screenX;
      let latestY = origin.screenY;
      let frame: number | null = null;
      let stopped = false;

      const flush = () => {
        frame = null;
        if (stopped) return;
        void workspaceAPI
          .setWindowPositionOhos(
            Math.round(geometry.left + (latestX - origin.screenX) * scale),
            Math.round(geometry.top + (latestY - origin.screenY) * scale),
          )
          .catch((error) => {
            log.debug('window move failed', error);
          });
      };

      const onPointerMove = (moveEvent: PointerEvent) => {
        latestX = moveEvent.screenX;
        latestY = moveEvent.screenY;
        if (frame === null) frame = window.requestAnimationFrame(flush);
      };

      const stop = () => {
        if (stopped) return;
        stopped = true;
        if (frame !== null) window.cancelAnimationFrame(frame);
        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', stop, true);
        window.removeEventListener('pointercancel', stop, true);
        window.removeEventListener('blur', stop, true);
        if (pendingMoveRef.current?.stop === stop) pendingMoveRef.current = null;
      };

      pendingMoveRef.current = { stop };
      window.addEventListener('pointermove', onPointerMove, true);
      window.addEventListener('pointerup', stop, true);
      window.addEventListener('pointercancel', stop, true);
      window.addEventListener('blur', stop, true);
    },
    [],
  );

  const onMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (!canDragWindow || event.button !== 0 || event.detail > 1) return;
      // Callers filter interactive targets (buttons, inputs, tabs...) before
      // calling; this hook only handles the raw chrome gesture.
      if (event.defaultPrevented) return;
      // Dispose a stale pending gesture (e.g. the window state changed between
      // renders) before starting a fresh one.
      teardownGesture();
      stopPendingMove();

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
          if (isOpenHarmonyRuntime()) {
            // The host cannot take over the move after restoring the window,
            // so the shell restores it and tracks the pointer itself.
            void startOhosMaximizedChromeMove({
              screenX: moveEvent.screenX,
              screenY: moveEvent.screenY,
              offsetX: moveEvent.clientX,
              offsetY: moveEvent.clientY,
            });
            return;
          }
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
    [canDragWindow, isMaximized, startChromeDragging, startOhosMaximizedChromeMove, stopPendingMove, teardownGesture],
  );

  return { onMouseDown };
};
