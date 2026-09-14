import { getCurrentWindow, LogicalPosition } from '@tauri-apps/api/window';

export interface CompanionPointerPosition { x: number; y: number }
export interface CompanionPointerDrag {
  move: (position: CompanionPointerPosition) => void;
  finish: () => void;
  cancel: () => void;
}

/**
 * WebKit screen coordinates and macOS window positions share logical screen
 * space. Capture the window origin at pointer-down, then coalesce pointer moves
 * while an IPC is in flight. No global cursor polling or native drag handoff.
 */
export function prepareAgentCompanionPointerDrag(
  grab: CompanionPointerPosition,
  onDirection: (direction: 'left' | 'right') => void,
  onError: (error: unknown) => void,
): CompanionPointerDrag {
  const petWindow = getCurrentWindow();
  let origin: CompanionPointerPosition | null = null;
  let latest: CompanionPointerPosition | null = null;
  let previous = grab;
  let cancelled = false;
  let finished = false;
  let moving = false;

  const cancel = () => { cancelled = true; latest = null; };
  const fail = (error: unknown) => {
    if (cancelled) return;
    cancel();
    onError(error);
  };
  const flush = async () => {
    if (cancelled || moving || !origin || !latest) return;
    moving = true;
    try {
      while (!cancelled && latest) {
        const pointer = latest;
        latest = null;
        await petWindow.setPosition(new LogicalPosition(
          origin.x + pointer.x - grab.x,
          origin.y + pointer.y - grab.y,
        ));
      }
    } catch (error) {
      fail(error);
    } finally {
      moving = false;
    }
  };

  void Promise.all([petWindow.outerPosition(), petWindow.scaleFactor()])
    .then(([position, scale]) => {
      if (cancelled) return;
      if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid companion window scale factor');
      origin = { x: position.x / scale, y: position.y / scale };
      void flush();
    }).catch(fail);

  return {
    move: pointer => {
      if (cancelled || finished) return;
      if (pointer.x === previous.x && pointer.y === previous.y) return;
      if (pointer.x !== previous.x) onDirection(pointer.x > previous.x ? 'right' : 'left');
      previous = pointer;
      latest = pointer;
      void flush();
    },
    // A quick release may precede origin acquisition or the last IPC. Keep the
    // final requested position, but accept no further pointer events.
    finish: () => { finished = true; void flush(); },
    cancel,
  };
}
