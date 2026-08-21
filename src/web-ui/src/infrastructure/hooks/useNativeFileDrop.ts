import { useEffect, useRef, type RefObject } from 'react';
import { createLogger } from '@/shared/utils/logger';
import { isOpenHarmonyRuntime } from '@/infrastructure/runtime';

const log = createLogger('NativeFileDrop');

declare global {
  interface Window {
    __bitFunNativeFileDrop?: (payload: unknown) => void;
  }
}

export interface OhosNativeDropPayload {
  type: string;
  paths?: string[];
}

export function parseOhosNativeDropPayload(
  payload: unknown,
): OhosNativeDropPayload | null {
  try {
    const parsed: unknown = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (typeof parsed !== 'object' || parsed === null) return null;

    const candidate = parsed as Partial<OhosNativeDropPayload>;
    if (typeof candidate.type !== 'string') return null;
    return {
      type: candidate.type,
      paths: Array.isArray(candidate.paths)
        ? candidate.paths.filter((path): path is string => typeof path === 'string')
        : undefined,
    };
  } catch {
    return null;
  }
}

interface NativeFileDropOptions {
  targetRef: RefObject<HTMLElement>;
  enabled?: boolean;
  onDragOver: (overTarget: boolean) => void;
  onDrop: (paths: string[]) => void | Promise<void>;
}

export function isNativeDragPositionOverElement(
  position: { x: number; y: number },
  scaleFactor: number,
  element: HTMLElement | null,
): boolean {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const candidates = [
    position,
    { x: position.x / scaleFactor, y: position.y / scaleFactor },
  ];
  return candidates.some(({ x, y }) => (
    Number.isFinite(x)
    && Number.isFinite(y)
    && x >= rect.left
    && x <= rect.right
    && y >= rect.top
    && y <= rect.bottom
  ));
}

/** Bridges Tauri's native path-based file drop events into a DOM target. */
export function useNativeFileDrop({
  targetRef,
  enabled = true,
  onDragOver,
  onDrop,
}: NativeFileDropOptions): void {
  const onDragOverRef = useRef(onDragOver);
  const onDropRef = useRef(onDrop);

  useEffect(() => {
    onDragOverRef.current = onDragOver;
    onDropRef.current = onDrop;
  }, [onDragOver, onDrop]);

  useEffect(() => {
    if (!enabled) return;

    // ArkWeb does not surface external file drags as HTML5 `drop` events, and
    // Wry's OHOS adapter does not forward them through Tauri's drag-drop API.
    // The ArkTS shell calls this global hook with filesystem paths, which we
    // forward to the same onDrop path.
    if (isOpenHarmonyRuntime()) {
      const handle = (payload: unknown) => {
        const data = parseOhosNativeDropPayload(payload);
        if (!data) {
          log.warn('Failed to parse OHOS native drop payload');
          return;
        }
        if (data.type === 'drop') {
          onDragOverRef.current(false);
          const paths = Array.isArray(data.paths)
            ? data.paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
            : [];
          log.debug('OHOS native file drop received', { pathCount: paths.length });
          void onDropRef.current(paths);
        } else if (data.type === 'enter' || data.type === 'over') {
          onDragOverRef.current(true);
        } else if (data.type === 'leave') {
          onDragOverRef.current(false);
        }
      };
      window.__bitFunNativeFileDrop = handle;
      log.debug('OHOS native file drop listener registered');
      return () => {
        if (window.__bitFunNativeFileDrop === handle) {
          delete window.__bitFunNativeFileDrop;
        }
      };
    }

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let enteredPaths: string[] = [];
    let wasOverTarget = false;

    const setup = async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        const webview = getCurrentWebview();
        const stop = await webview.onDragDropEvent(async (event) => {
          if (cancelled) return;
          const payload = event.payload;

          if (payload.type === 'leave') {
            enteredPaths = [];
            wasOverTarget = false;
            onDragOverRef.current(false);
            return;
          }

          if (payload.type === 'enter') {
            enteredPaths = [...payload.paths];
          }

          const factor = await webview.window.scaleFactor();
          const overTarget = isNativeDragPositionOverElement(
            payload.position,
            factor,
            targetRef.current,
          );

          if (payload.type === 'enter') {
            wasOverTarget = overTarget;
            onDragOverRef.current(overTarget && enteredPaths.length > 0);
            return;
          }

          if (payload.type === 'over') {
            wasOverTarget = overTarget;
            onDragOverRef.current(overTarget);
            return;
          }

          const paths = payload.paths.length > 0 ? payload.paths : enteredPaths;
          const shouldHandleDrop = overTarget || wasOverTarget;
          enteredPaths = [];
          wasOverTarget = false;
          onDragOverRef.current(false);
          log.debug('Native file drop received', {
            pathCount: paths.length,
            overTarget,
            shouldHandleDrop,
            hasTarget: Boolean(targetRef.current),
          });
          if (shouldHandleDrop && paths.length > 0) {
            await onDropRef.current(paths);
          }
        });
        if (cancelled) {
          stop();
        } else {
          unlisten = stop;
          log.debug('Native file drag-drop listener registered');
        }
      } catch (error) {
        log.debug('Native file drag-drop listener unavailable', error);
      }
    };

    void setup();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled, targetRef]);
}
