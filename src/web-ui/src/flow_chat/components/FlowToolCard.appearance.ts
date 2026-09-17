import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const flowToolCardAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'flow-tool-card',
  parts: [
    { id: 'root' },
    { id: 'note' },
  ],
  facets: [
    {
      id: 'attention',
      attribute: 'data-bitfun-attention',
      values: ['ambient', 'prominent'],
    },
    {
      id: 'presentation',
      attribute: 'data-bitfun-presentation',
      values: ['standard', 'dedicated'],
    },
  ],
  states: [
    {
      id: 'permissionPending',
      selector: { kind: 'self', suffix: '[data-bitfun-state~="permission-pending"]' },
    },
  ],
};
