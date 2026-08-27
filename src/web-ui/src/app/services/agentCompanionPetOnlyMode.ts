/**
 * agentCompanionPetOnlyMode — HarmonyOS interim "minimize-to-pet" morph.
 *
 * Problem: the in-app pet overlay (`AgentCompanionInAppPet`) is a child of the
 * main window DOM, so it hides when the main window minimizes — unlike the
 * desktop pet, which is a separate always-on-top OS window.
 *
 * Interim fix (web-ui only, no ArkTS/Rust change): when the user clicks the
 * app's own minimize button while the desktop pet is enabled, do not minimize.
 * Instead morph the main window into a small always-on-top, decoration-free
 * surface that shows only the pet (the app content under `#root` is hidden,
 * while the pet portal in the appearance overlay host stays visible). Clicking
 * the pet restores the saved window geometry.
 *
 * Caveat: this only intercepts the in-app minimize button. System-level
 * minimize (taskbar right-click / keyboard shortcut) bypasses the web UI and
 * still hides the pet. A true always-on-top separate window needs a dedicated
 * HarmonyOS UIAbility (see docs/architecture platform-portability-design.md,
 * HarmonyOS PC GUI is a deferred topic).
 */

import { workspaceAPI } from '@/infrastructure/api';
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
      // pet lives in the appearance overlay host (a sibling of #root), so it
      // stays visible.
      setRootHidden(true);
      useAgentCompanionPetOnlyModeStore.getState().setPetOnlyMode(true);

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
export async function exitPetOnlyMode(): Promise<void> {
  if (!isPetOnlyModeActive()) return;

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
    }
  };

  chain = chain.then(run, run);
  await chain;
}
