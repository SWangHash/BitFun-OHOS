/**
 * Resident listener for native-initiated config changes.
 *
 * The HarmonyOS status-bar (system tray) icon changes a persisted setting on the
 * web UI's behalf — currently the Agent companion pet toggle. The backend emits
 * `tray://desktop-pet-changed` after writing the value, so the frontend config
 * cache and config-driven UI (the in-app pet overlay) refresh while running.
 * Mirrors the account-sync refresh in `settingsAppliedListener.ts`.
 */
import { api } from '@/infrastructure/api/service-api/ApiClient';
import { configManager } from './ConfigManager';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('ExternalConfigChange');

/**
 * Backend event emitted by `set_desktop_pet_enabled` in
 * `apps/desktop/src/api/system_api.rs`; keep both sides in step.
 */
export const TRAY_DESKTOP_PET_CHANGED_EVENT = 'tray://desktop-pet-changed';

let unlisten: (() => void) | null = null;

/** Register once at startup so tray-driven config changes refresh the UI. */
export function ensureExternalConfigChangeListener(): void {
  if (unlisten) {
    return;
  }
  try {
    unlisten = api.listen(TRAY_DESKTOP_PET_CHANGED_EVENT, () => {
      void configManager.applyExternalReload();
    });
  } catch (error) {
    log.warn('Failed to register the external config change listener', { error });
  }
}
