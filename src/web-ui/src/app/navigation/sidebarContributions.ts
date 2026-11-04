import type { ProductActionId } from '@/app/global-search/productActionCatalog';
import type { SceneTabId } from '@/app/components/SceneBar/types';
import { createSidebarRegistry, type SidebarContribution } from './sidebarRegistry';
import { Users, Network, ChartNoAxesCombined } from 'lucide-react';

function productPage(
  id: string, labelKey: SidebarContribution['labelKey'], icon: SidebarContribution['icon'],
  sceneId: SceneTabId, actionId: ProductActionId,
): SidebarContribution {
  return {
    id, labelKey, icon,
    isActive: context => context.activeSceneId === sceneId,
    open: async scope => {
      const { activateProductAction } = await import('@/app/global-search/productActionActivator');
      if (scope.isCurrent()) await activateProductAction(actionId);
    },
  };
}

export const sidebarRegistry = createSidebarRegistry([
  productPage('builtin.todos', 'common:nav.items.todos', 'clock', 'todos', 'surface.todos.open'),
  productPage('builtin.agents', 'common:nav.items.agents', Users, 'agents', 'surface.agents.open'),
  productPage('builtin.skills', 'common:nav.items.skills', 'extension', 'skills', 'surface.skills.open'),
  productPage('builtin.ecosystem-compatibility', 'common:nav.items.ecosystemCompatibility', Network, 'ecosystem-compatibility', 'surface.ecosystemCompatibility.open'),
  productPage('builtin.insights', 'common:scenes.insights', ChartNoAxesCombined, 'insights', 'surface.insights.open'),
]);
