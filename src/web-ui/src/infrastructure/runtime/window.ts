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
  await currentWindow.startDragging();
}
