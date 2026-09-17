import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const coreAgentCardAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'core-agent-card',
  componentAttribute: 'data-bitfun-product-component',
  parts: [
    { id: 'root' },
    { id: 'header' },
    { id: 'icon' },
    { id: 'headerInfo' },
    { id: 'name' },
    { id: 'role' },
    { id: 'status' },
    { id: 'body' },
    { id: 'description' },
    { id: 'footer' },
    { id: 'meta' },
  ],
  states: [
    { id: 'connected', selector: { kind: 'self', suffix: '[data-bitfun-state~="connected"]' } },
    { id: 'disabled', selector: { kind: 'self', suffix: '[data-bitfun-state~="disabled"]' } },
  ],
};
