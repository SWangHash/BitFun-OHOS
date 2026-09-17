import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance/types';

export const inputAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'input',
  parts: [
    { id: 'root', propertyProfile: 'control', visualRole: 'control' },
    { id: 'label', propertyProfile: 'paint', visualRole: 'content' },
    { id: 'container', propertyProfile: 'control', visualRole: 'control' },
    { id: 'control', propertyProfile: 'control', visualRole: 'control' },
    { id: 'prefix', propertyProfile: 'paint', visualRole: 'decoration' },
    { id: 'suffix', propertyProfile: 'paint', visualRole: 'decoration' },
    { id: 'message', propertyProfile: 'paint', visualRole: 'content' },
  ],
  facets: [
    {
      id: 'variant',
      attribute: 'data-bitfun-variant',
      values: ['default', 'filled', 'outlined'],
    },
    {
      id: 'size',
      attribute: 'data-bitfun-size',
      values: ['small', 'medium', 'large'],
    },
  ],
  states: [
    { id: 'hover', selector: { kind: 'self', suffix: ':hover' } },
    { id: 'focusWithin', selector: { kind: 'self', suffix: ':focus-within' } },
    { id: 'focusVisible', selector: { kind: 'self', suffix: ':focus-visible' } },
    { id: 'disabled', selector: { kind: 'self', suffix: '[data-bitfun-state~="disabled"]' } },
    { id: 'error', selector: { kind: 'self', suffix: '[data-bitfun-state~="error"]' } },
  ],
};
