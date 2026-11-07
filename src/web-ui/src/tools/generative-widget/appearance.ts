import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const generativeWidgetAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'generative-widget',
  parts: [
    { id: 'application' },
    { id: 'app' },
    { id: 'empty' },
    { id: 'toolbar' },
    { id: 'repair' },
  ],
  states: [
    { id: 'empty', selector: { kind: 'self', suffix: '[data-bitfun-state~="empty"]' } },
    { id: 'streaming', selector: { kind: 'self', suffix: '[data-bitfun-state~="streaming"]' } },
    { id: 'failed', selector: { kind: 'self', suffix: '[data-bitfun-state~="failed"]' } },
    { id: 'cancelled', selector: { kind: 'self', suffix: '[data-bitfun-state~="cancelled"]' } },
    { id: 'rejected', selector: { kind: 'self', suffix: '[data-bitfun-state~="rejected"]' } },
    { id: 'ready', selector: { kind: 'self', suffix: '[data-bitfun-state~="ready"]' } },
    { id: 'repairRequired', selector: { kind: 'self', suffix: '[data-bitfun-state~="repairRequired"]' } },
  ],
};
