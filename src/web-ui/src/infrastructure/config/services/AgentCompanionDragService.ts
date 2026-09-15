import { cursorPosition, getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window';

/** Windows app-owned dragging keeps pointer capture and release visible to the UI. */
export function startAgentCompanionDrag(
  onDirection: (direction: 'left' | 'right') => void,
  onError: (error: unknown) => void,
): () => void {
  const petWindow = getCurrentWindow();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { stopped = true; clearTimeout(timer); };
  void Promise.all([petWindow.outerPosition(), cursorPosition()]).then(([origin, grab]) => {
    let previousX = grab.x;
    let previousY = grab.y;
    const tick = async () => {
      if (stopped) return;
      try {
        const pointer = await cursorPosition();
        if (stopped) return;
        if (pointer.x !== previousX) onDirection(pointer.x > previousX ? 'right' : 'left');
        if (pointer.x !== previousX || pointer.y !== previousY) {
          previousX = pointer.x;
          previousY = pointer.y;
          await petWindow.setPosition(new PhysicalPosition(origin.x + pointer.x - grab.x, origin.y + pointer.y - grab.y));
        }
        if (!stopped) timer = setTimeout(() => { void tick(); }, 16);
      } catch (error) {
        if (!stopped) { stop(); onError(error); }
      }
    };
    void tick();
  }).catch(error => { if (!stopped) { stop(); onError(error); } });
  return stop;
}
