import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance/types';
export const searchAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'search', parts: [
    { id: 'root', propertyProfile: 'control', visualRole: 'control' },
    { id: 'wrapper', propertyProfile: 'control', visualRole: 'control' },
    { id: 'prefix', propertyProfile: 'paint', visualRole: 'decoration' },
    { id: 'input', propertyProfile: 'control', visualRole: 'control' },
    { id: 'clear', propertyProfile: 'control', visualRole: 'control' },
    { id: 'suffix', propertyProfile: 'paint', visualRole: 'decoration' },
    { id: 'button', propertyProfile: 'control', visualRole: 'control' },
    { id: 'message', propertyProfile: 'paint', visualRole: 'content' },
  ],
  facets: [{ id: 'size', attribute: 'data-bitfun-size', values: ['small', 'medium', 'large'] }],
  states: [{ id: 'hover', selector: { kind: 'self', suffix: '[data-bitfun-state~="hover"]' } }, { id: 'focusWithin', selector: { kind: 'self', suffix: '[data-bitfun-state~="focused"]' } }, { id: 'disabled', selector: { kind: 'self', suffix: '[data-bitfun-state~="disabled"]' } }, { id: 'error', selector: { kind: 'self', suffix: '[data-bitfun-state~="error"]' } }, { id: 'loading', selector: { kind: 'self', suffix: '[data-bitfun-state~="loading"]' } }, { id: 'expandable', selector: { kind: 'self', suffix: '[data-bitfun-state~="expandable"]' } }],
};
