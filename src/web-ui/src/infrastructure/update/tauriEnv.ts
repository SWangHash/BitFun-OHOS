import { isOpenHarmonyRuntime } from '@/infrastructure/runtime';

/** True when running inside the Tauri desktop shell (not pure browser dev). */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

/** Manual update actions are available in every desktop build. */
export function canCheckForAppUpdates(): boolean {
  return isTauriRuntime();
}

/**
 * Temporary product constraint: in-app update entries are HarmonyOS-only.
 *
 * Windows and macOS keep the staged updater implementation (`checkForUpdates`,
 * `updateInstallStore`, and the download progress UI) so the desktop entry
 * points can be restored later, but they must not be reachable from the UI
 * until this gate is re-enabled. HarmonyOS keeps its AppGallery check button.
 *
 * Do not mount an update button, menu item, badge, notification, or automatic
 * discovery on Windows or macOS while this returns false. See
 * `src/apps/desktop/AGENTS.md`, "OpenHarmony (OHOS) preservation".
 */
export function canShowAppUpdateEntry(): boolean {
  return canCheckForAppUpdates() && isOpenHarmonyRuntime();
}

/** Development builds skip background discovery. */
export function canAutoCheckForAppUpdates(): boolean {
  return canShowAppUpdateEntry() && !import.meta.env.DEV;
}
