import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const compactToolCardAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'compact-tool-card',
  parts: [
    { id: 'root' }, { id: 'surface' }, { id: 'expanded' },
    { id: 'action' }, { id: 'content' }, { id: 'extra' },
  ],
  facets: [{
    id: 'status',
    attribute: 'data-bitfun-status',
    values: [
      'pending', 'queued', 'waiting', 'preparing', 'streaming', 'receiving',
      'running', 'completed', 'error', 'cancelled', 'rejected', 'analyzing',
      'pending_confirmation', 'confirmed',
    ],
  }],
  states: [
    { id: 'loading', selector: { kind: 'self', suffix: '[data-bitfun-state~="loading"]' } },
    { id: 'clickable', selector: { kind: 'self', suffix: '[data-bitfun-state~="clickable"]' } },
    { id: 'expanded', selector: { kind: 'self', suffix: '[data-bitfun-state~="expanded"]' } },
  ],
};
