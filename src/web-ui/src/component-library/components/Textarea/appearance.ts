import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance/types';
export const textareaAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'textarea', parts: [{ id: 'root' }, { id: 'label' }, { id: 'required' }, { id: 'wrapper' }, { id: 'field' }, { id: 'footer' }, { id: 'message' }, { id: 'count' }],
  facets: [{ id: 'variant', attribute: 'data-openbitfun-variant', values: ['default', 'filled', 'outlined'] }],
  states: [{ id: 'hover', selector: { kind: 'self', suffix: ':hover' } }, { id: 'focusWithin', selector: { kind: 'self', suffix: ':focus-within' } }, { id: 'disabled', selector: { kind: 'self', suffix: '[data-openbitfun-state~="disabled"]' } }, { id: 'error', selector: { kind: 'self', suffix: '[data-openbitfun-state~="error"]' } }, { id: 'autoResize', selector: { kind: 'self', suffix: '[data-openbitfun-state~="autoResize"]' } }],
};
