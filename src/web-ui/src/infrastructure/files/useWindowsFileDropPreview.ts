import { useEffect, useRef, type RefObject } from 'react';
import { isWindowsDesktopRuntime } from '@/infrastructure/runtime';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import { createLogger } from '@/shared/utils/logger';
import type { FileDropPosition, FileDropPreview } from '@/shared/types/fileDropPreview';

const log = createLogger('WindowsFileDropPreview');
interface PreviewEvent extends FileDropPreview, FileDropPosition {
  targetId: string;
  generation: number;
  kind: 'enter' | 'over' | 'thumbnails' | 'leave' | 'drop' | 'unavailable';
  paths?: string[];
}

interface Options {
  targetRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onDragOver: (over: boolean) => void;
  onPreview: (preview: FileDropPreview | null) => void;
  onPosition: (position: FileDropPosition | null) => void;
  onDropPaths: (paths: string[]) => void | Promise<void>;
}

/** Controller-local OLE capture, armed only for external file drags over this target. */
export function useWindowsFileDropPreview(options: Options): void {
  const callbacks = useRef(options);
  callbacks.current = options;
  const { targetRef, enabled } = options;

  useEffect(() => {
    if (!enabled || !isWindowsDesktopRuntime()) return;
    const target = targetRef.current;
    if (!target) return;
    const targetId = crypto.randomUUID();
    let disposed = false;
    let arming = false;
    let requested = false;
    let unavailable = false;
    let attempt = 0;
    let generation: number | null = null;
    let unlisten: (() => void) | undefined;

    const clear = () => {
      generation = null;
      callbacks.current.onDragOver(false);
      callbacks.current.onPreview(null);
      callbacks.current.onPosition(null);
    };
    const release = () => {
      attempt += 1;
      arming = false;
      unavailable = false;
      clear();
      if (!requested) return;
      requested = false;
      void api.invoke('set_file_drop_preview_target', { request: { targetId, bounds: null } })
        .catch(error => log.warn('Failed to release native file preview target', error));
    };
    const showUnavailable = (error?: unknown) => {
      unavailable = true;
      if (error) log.warn('Native file preview is unavailable; browser file intake remains active', error);
      callbacks.current.onPreview({ count: 0, files: [], unavailable: true });
    };
    const enter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files') || !callbacks.current.enabled) return;
      if (unavailable) { showUnavailable(); return; }
      if (arming || requested || generation !== null) return;
      const rect = target.getBoundingClientRect();
      const currentAttempt = ++attempt;
      arming = true;
      requested = true;
      void api.invoke('set_file_drop_preview_target', { request: {
        targetId,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: window.devicePixelRatio },
      } }).catch(error => {
        if (disposed || currentAttempt !== attempt) return;
        requested = false;
        showUnavailable(error);
      }).finally(() => { if (currentAttempt === attempt) arming = false; });
    };
    const leave = (event: DragEvent) => {
      if (!requested && !unavailable && generation === null && !arming) return;
      // Native capture also causes a DOM dragleave. Only end this visit when
      // browser dragover proves the pointer left, or a failed visit leaves.
      if (event.type === 'dragleave' && !unavailable) return;
      const rect = target.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX >= rect.right
        || event.clientY < rect.top || event.clientY >= rect.bottom) release();
    };

    const setup = async () => {
      try {
        // Use the native window event channel, never the peer runtime's transport.
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<PreviewEvent>('bitfun://file-drop-preview', ({ payload }) => {
          if (disposed || payload.targetId !== targetId) return;
          if (payload.kind === 'unavailable') {
            if (!requested && generation === null) return;
            requested = false;
            clear();
            showUnavailable();
          } else if (payload.kind === 'enter') {
            generation = payload.generation;
            callbacks.current.onPosition({ x: payload.x, y: payload.y });
            callbacks.current.onPreview({ count: payload.count, files: payload.files });
            callbacks.current.onDragOver(true);
          } else if (generation === payload.generation) {
            if (payload.kind === 'over') {
              callbacks.current.onPosition({ x: payload.x, y: payload.y });
            } else if (payload.kind === 'thumbnails') {
              callbacks.current.onPreview({ count: payload.count, files: payload.files });
            } else {
              requested = false;
              unavailable = false;
              clear();
              if (payload.kind === 'drop' && payload.paths?.length && callbacks.current.enabled) {
                void Promise.resolve(callbacks.current.onDropPaths(payload.paths))
                  .catch(error => log.error('Failed to accept native file drop', error));
              }
            }
          }
        });
        if (disposed) { unlisten(); return; }
        target.addEventListener('dragenter', enter, true);
        target.addEventListener('dragleave', leave);
        window.addEventListener('dragover', leave);
        window.addEventListener('drop', release, true);
        window.addEventListener('dragend', release);
        window.addEventListener('blur', release);
      } catch (error) {
        if (!disposed) showUnavailable(error);
      }
    };
    void setup();
    return () => {
      disposed = true;
      target.removeEventListener('dragenter', enter, true);
      target.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', leave);
      window.removeEventListener('drop', release, true);
      window.removeEventListener('dragend', release);
      window.removeEventListener('blur', release);
      unlisten?.();
      release();
    };
  }, [targetRef, enabled]);
}
