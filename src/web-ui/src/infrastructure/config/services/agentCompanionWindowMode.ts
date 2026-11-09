/**
 * Which surface renders the Agent companion pet on this host.
 *
 * Desktop and HarmonyOS both render `AgentCompanionDesktopPet` in a dedicated
 * window (`?bitfunWindow=agent-companion`); the HarmonyOS window is an ArkUI
 * window owned by the `AgentCompanionAbility`, so the pet keeps its own screen
 * position instead of being clipped to the main window.
 *
 * The in-app overlay (`AgentCompanionInAppPet`) and the "minimize to pet"
 * morph stay in the tree as a device-test fallback: setting
 * `bitfun.agentCompanionInAppFallback=1` in localStorage restores the previous
 * HarmonyOS behavior without a rebuild.
 */

import { isOpenHarmonyRuntime } from '@/infrastructure/runtime';

const IN_APP_FALLBACK_STORAGE_KEY = 'bitfun.agentCompanionInAppFallback';

function isInAppFallbackSelected(): boolean {
  try {
    return window.localStorage.getItem(IN_APP_FALLBACK_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** True when HarmonyOS should host the pet in its own window. */
export function usesHarmonyOsAgentCompanionWindow(): boolean {
  return isOpenHarmonyRuntime() && !isInAppFallbackSelected();
}

/** True when the pet must render as an overlay inside the main window. */
export function usesInAppAgentCompanionOverlay(): boolean {
  return !usesHarmonyOsAgentCompanionWindow();
}
