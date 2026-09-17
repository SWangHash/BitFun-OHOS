import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';
export const canvasEditorGroupAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'canvas-editor-group',
  parts: [{ id: 'root' }, { id: 'content' }, { id: 'tabContent' }, { id: 'empty' }, { id: 'emptyContent' }],
  facets: [{ id: 'group', attribute: 'data-bitfun-group', values: ['primary', 'secondary', 'tertiary'] }],
  states: [{ id: 'active', selector: { kind: 'self', suffix: '[data-bitfun-state~="active"]' } }],
};
