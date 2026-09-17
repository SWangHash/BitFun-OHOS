import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const terminalToolCardAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'terminal-tool-card',
  parts: [
    { id: 'root' }, { id: 'status' }, { id: 'actions' },
    { id: 'output' }, { id: 'waiting' }, { id: 'result' },
    { id: 'footer' }, { id: 'error' },
  ],
  facets: [{
    id: 'status',
    attribute: 'data-bitfun-status',
    values: [
      'pending', 'queued', 'waiting', 'preparing', 'streaming', 'receiving',
      'running', 'completed', 'error', 'cancelled', 'rejected',
      'pending_confirmation', 'confirmed',
    ],
  }],
  states: [
    { id: 'running', selector: { kind: 'self', suffix: '[data-bitfun-state~="running"]' } },
    { id: 'completed', selector: { kind: 'self', suffix: '[data-bitfun-state~="completed"]' } },
    { id: 'error', selector: { kind: 'self', suffix: '[data-bitfun-state~="error"]' } },
    { id: 'cancelled', selector: { kind: 'self', suffix: '[data-bitfun-state~="cancelled"]' } },
    { id: 'expanded', selector: { kind: 'self', suffix: '[data-bitfun-state~="expanded"]' } },
  ],
};
