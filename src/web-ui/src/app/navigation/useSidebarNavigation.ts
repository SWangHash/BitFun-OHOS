import { useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { useSceneStore } from '@/app/stores/sceneStore';
import { getActiveSurfaceScope, isLocalSurface, onSurfaceActivated } from '@/infrastructure/peer-device/deviceSurface';
import { isTauriRuntime } from '@/infrastructure/runtime';
import { sidebarPreferences } from './sidebarPreferences';
import { sidebarRegistry } from './sidebarContributions';
import { selectedSidebarEntry, type SidebarContext } from './sidebarRegistry';

export function useSidebarNavigation() {
  const entries = useSyncExternalStore(sidebarRegistry.subscribe, sidebarRegistry.getSnapshot, sidebarRegistry.getSnapshot);
  const pinnedIds = useStore(sidebarPreferences, state => state.pinnedIds);
  const scope = useSyncExternalStore(onSurfaceActivated, getActiveSurfaceScope, getActiveSurfaceScope);
  const activeSceneId = useSceneStore(state => state.activeTabId);
  const context: SidebarContext = {
    activeSceneId, isDesktop: isTauriRuntime(),
    isPeer: !isLocalSurface(scope.surfaceId), surfaceId: scope.surfaceId,
  };
  return { entries, pinnedIds, context, scope, selectedId: selectedSidebarEntry(entries, pinnedIds, context) };
}
