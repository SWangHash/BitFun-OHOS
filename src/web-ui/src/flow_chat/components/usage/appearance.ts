import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const sessionUsagePanelAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'session-usage-panel',
  componentAttribute: 'data-bitfun-product-component',
  parts: [
    { id: 'root' },
    { id: 'header' },
    { id: 'tabs' },
    { id: 'tab' },
    { id: 'body' },
    { id: 'metaRow' },
    { id: 'section' },
    { id: 'metric' },
    { id: 'table' },
    { id: 'empty' },
  ],
  facets: [
    { id: 'tab', attribute: 'data-bitfun-tab', values: ['overview', 'models', 'tools', 'files', 'errors', 'slowest'] },
  ],
  states: [
    { id: 'active', selector: { kind: 'self', suffix: '[data-bitfun-state~="active"]' } },
    { id: 'fallback', selector: { kind: 'self', suffix: '[data-bitfun-state~="fallback"]' } },
  ],
};
