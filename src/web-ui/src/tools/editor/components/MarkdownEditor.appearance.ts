import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const markdownEditorAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'markdown-editor',
  componentAttribute: 'data-bitfun-product-component',
  parts: [
    { id: 'root' }, { id: 'loading' }, { id: 'error' },
    { id: 'toolbar' }, { id: 'actions' }, { id: 'body' },
  ],
  facets: [{ id: 'view', attribute: 'data-bitfun-view', values: ['preview', 'markdown', 'source'] }],
  states: [
    { id: 'loading', selector: { kind: 'self', suffix: '[data-bitfun-state~="loading"]' } },
    { id: 'error', selector: { kind: 'self', suffix: '[data-bitfun-state~="error"]' } },
  ],
};
