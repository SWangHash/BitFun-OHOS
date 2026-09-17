import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';
export const canvasTabOverflowAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'canvas-tab-overflow',
  componentAttribute: 'data-bitfun-product-component',
  parts: [
    { id: 'root' }, { id: 'trigger' }, { id: 'badge' }, { id: 'itemTitle' },
  ],
  states: [
    { id: 'open', selector: { kind: 'self', suffix: '[data-bitfun-state~="open"]' } },
    { id: 'active', selector: { kind: 'self', suffix: '[data-bitfun-state~="active"]' } },
    { id: 'dirty', selector: { kind: 'self', suffix: '[data-bitfun-state~="dirty"]' } },
    { id: 'deleted', selector: { kind: 'self', suffix: '[data-bitfun-state~="deleted"]' } },
  ],
};
