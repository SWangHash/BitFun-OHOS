import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const sessionNavigationAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'session-navigation',
  parts: [{ id: 'viewToggle', propertyProfile: 'control', visualRole: 'control' }],
  facets: [
    { id: 'action', attribute: 'data-bitfun-action', values: ['toggle-session-view'] },
  ],
  states: [
    { id: 'grouped', selector: { kind: 'self', suffix: '[data-bitfun-state~="grouped"]' } },
    { id: 'all', selector: { kind: 'self', suffix: '[data-bitfun-state~="all"]' } },
  ],
};
