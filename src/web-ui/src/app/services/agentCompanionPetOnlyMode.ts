/**
 * agentCompanionPetOnlyMode — HarmonyOS "minimize-to-pet" morph.
 *
 * Problem: HarmonyOS hides a subwindow with its parent, so minimizing the main
 * window would take the pet's own window with it. The pet window is a subwindow
 * (not a second UIAbility) on purpose: an extra ability adds a second Dock/task
 * entry, which users see immediately in the Dock preview.
 *
 * Fix: when the user clicks the app's own minimize button while the pet is
 * enabled, do not minimize. Instead morph the main window into a small
 * always-on-top, decoration-free surface that shows only the pet (the app
 * content under `#root` is hidden, while the pet portal in the appearance
 * overlay host stays visible), and hide the separate pet window so only one pet
 * is on screen. Clicking the pet restores the saved window geometry and brings
 * the pet window back.
 *
 * Caveat: this only intercepts the in-app minimize button. System-level
 * minimize (Dock right-click / keyboard shortcut) bypasses the web UI, and
 * HarmonyOS then hides the pet window too.
 */

import { workspaceAPI } from '@/infrastructure/api';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import { useAgentCompanionPetOnlyModeStore } from '../stores/agentCompanionPetOnlyModeStore';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('AgentCompanionPetOnlyMode');

/** Pet-only surface size in CSS px (fits the 96px pet sprite with margin). */
const PET_ONLY_CSS_WIDTH = 120;
const PET_ONLY_CSS_HEIGHT = 120;
const PET_ONLY_EDGE_GAP = 12;

interface SavedGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

let savedGeometry: SavedGeometry | null = null;
let chain: Promise<void> = Promise.resolve();

const setRootHidden = (hidden: boolean): void => {
  const root = document.getElementById('root');
  if (root) {
    root.style.display = hidden ? 'none' : '';
  }
};

export function isPetOnlyModeActive(): boolean {
  return useAgentCompanionPetOnlyModeStore.getState().isPetOnlyMode;
}

/**
 * Morph the main window into a small always-on-top pet-only surface. Safe to
 * call repeatedly; no-ops if already active. Serialized so rapid toggles cannot
 * interleave window mutations.
 */
export async function enterPetOnlyMode(): Promise<void> {
  if (isPetOnlyModeActive()) return;

  const run = async (): Promise<void> => {
    try {
      const [position, size, isMaximized] = await Promise.all([
        workspaceAPI.outerPositionOhos(),
        workspaceAPI.innerSizeOhos(),
        workspaceAPI.window_is_maximized(),
      ]);
      savedGeometry = {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        isMaximized,
      };

      if (isMaximized) {
        await workspaceAPI.unmaximizeOhos();
      }

      const monitor = await workspaceAPI.currentMonitorOhos();
      const scale = monitor.scaleFactor > 0 ? monitor.scaleFactor : 1;
      const physW = Math.max(1, Math.round(PET_ONLY_CSS_WIDTH * scale));
      const physH = Math.max(1, Math.round(PET_ONLY_CSS_HEIGHT * scale));
      const avoid = monitor.avoidArea;
      const workW = Math.max(0, monitor.width - (avoid?.left ?? 0) - (avoid?.right ?? 0));
      const workH = Math.max(0, monitor.height - (avoid?.top ?? 0) - (avoid?.bottom ?? 0));
      const originX = avoid?.left ?? 0;
      const originY = avoid?.top ?? 0;
      const gapPhys = Math.round(PET_ONLY_EDGE_GAP * scale);
      const x = originX + Math.max(0, workW - physW - gapPhys);
      const y = originY + Math.max(0, workH - physH - gapPhys);

      // Hide app content first so the morph never flashes the clipped UI; the
      // pet rendered inside this window lives in the appearance overlay host (a
      // sibling of #root), so it stays visible.
      setRootHidden(true);
      useAgentCompanionPetOnlyModeStore.getState().setPetOnlyMode(true);
      // The pet also has its own window; two pets would be on screen at once, so
      // close that one while this window plays the pet.
      void api.invoke('hide_agent_companion_desktop_pet').catch(error => {
        log.warn('Failed to hide the pet window while entering pet-only mode', error);
      });

      await workspaceAPI.setAlwaysOnTopOhos(true);
      await workspaceAPI.setDecorationsOhos(false);
      await Promise.all([
        workspaceAPI.setWindowSizeOhos(physW, physH),
        workspaceAPI.setWindowPositionOhos(x, y),
      ]);
    } catch (error) {
      log.error('Failed to enter Agent companion pet-only mode', error);
      // Roll back any partial state so the app is never left hidden.
      setRootHidden(false);
      useAgentCompanionPetOnlyModeStore.getState().setPetOnlyMode(false);
      savedGeometry = null;
    }
  };

  chain = chain.then(run, run);
  await chain;
}

/**
 * Restore the saved main window geometry and reveal the app content. No-op if
 * not in pet-only mode. Decorations are re-applied last because HarmonyOS
 * maximize()/geometry changes can reset the window to immersive chrome.
 */
export async function exitPetOnlyMode(
  options?: { restorePetWindow?: boolean },
): Promise<void> {
  if (!isPetOnlyModeActive()) return;
  // Restoring the pet's own window is right when the user is bringing the app
  // back, and wrong when this mode is ending because the pet was disabled.
  const restorePetWindow = options?.restorePetWindow !== false;

  const run = async (): Promise<void> => {
    try {
      useAgentCompanionPetOnlyModeStore.getState().setPetOnlyMode(false);
      setRootHidden(false);

      const saved = savedGeometry;
      savedGeometry = null;
      if (!saved) {
        return;
      }

      await workspaceAPI.setAlwaysOnTopOhos(false);
      if (saved.width > 0 && saved.height > 0) {
        await workspaceAPI.setWindowSizeOhos(saved.width, saved.height);
      }
      await workspaceAPI.setWindowPositionOhos(saved.x, saved.y);
      if (saved.isMaximized) {
        await workspaceAPI.maximizeOhos();
      }
      // Re-apply decorations last; maximize() can reset HarmonyOS chrome.
      await workspaceAPI.setDecorationsOhos(true);
    } catch (error) {
      log.error('Failed to exit Agent companion pet-only mode', error);
    } finally {
      // Bring the pet's own window back so the pet keeps living outside the main
      // window once the app is restored.
      if (restorePetWindow) {
        void api.invoke('show_agent_companion_desktop_pet').catch(error => {
          log.warn('Failed to restore the pet window after pet-only mode', error);
        });
      }
    }
  };

  chain = chain.then(run, run);
  await chain;
}
