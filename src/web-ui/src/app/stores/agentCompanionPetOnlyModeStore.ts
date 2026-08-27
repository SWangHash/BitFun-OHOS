/**
 * agentCompanionPetOnlyModeStore — reactive flag for the HarmonyOS interim
 * "minimize-to-pet" surface.
 *
 * When the user minimizes the main window on HarmonyOS with the desktop pet
 * enabled, the in-app pet overlay would hide with the window. Instead the
 * window is morphed into a small always-on-top pet-only surface (see
 * `agentCompanionPetOnlyMode`). This store lets `useWindowControls` (enter)
 * and `AgentCompanionInAppPet` (exit / layout) stay in sync without prop
 * threading.
 */

import { create } from 'zustand';

interface PetOnlyModeState {
  isPetOnlyMode: boolean;
  setPetOnlyMode: (value: boolean) => void;
}

export const useAgentCompanionPetOnlyModeStore = create<PetOnlyModeState>((set) => ({
  isPetOnlyMode: false,
  setPetOnlyMode: (value) => set({ isPetOnlyMode: value }),
}));
