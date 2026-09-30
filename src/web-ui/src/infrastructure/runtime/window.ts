import { isOpenHarmonyRuntime, supportsNativeWindowDragging } from './environment';
import { workspaceAPI } from '@/infrastructure/api';

/** Window chrome always belongs to the controller, including Peer Device Mode. */
export async function startNativeWindowDragging(): Promise<void> {
  if (isOpenHarmonyRuntime()) {
    await workspaceAPI.startWindowDraggingOhos();
    return;
  }
  if (!supportsNativeWindowDragging()) return;

  const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const currentWindow = getCurrentWindow();
    if (typeof currentWindow.startDragging !== 'function') return;
    // Read native state at the gesture boundary; React's resize sync is debounced.
    const [isMaximized, isFullscreen] = await Promise.all([
      currentWindow.isMaximized(),
      currentWindow.isFullscreen(),
    ]);
    if (isMaximized || isFullscreen) return;

    await currentWindow.startDragging();
}
