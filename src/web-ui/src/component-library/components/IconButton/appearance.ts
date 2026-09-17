import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance/types';
export const iconButtonAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'icon-button', parts: [{ id: 'root' }],
  facets: [
    { id: 'variant', attribute: 'data-bitfun-variant', values: ['default', 'primary', 'ghost', 'danger', 'success', 'warning', 'ai'] },
    { id: 'size', attribute: 'data-bitfun-size', values: ['xs', 'small', 'medium', 'large'] },
    { id: 'shape', attribute: 'data-bitfun-shape', values: ['square', 'circle'] },
  ],
  states: [{ id: 'hover', selector: { kind: 'self', suffix: ':hover:not(:disabled)' } }, { id: 'active', selector: { kind: 'self', suffix: ':active:not(:disabled)' } }, { id: 'focusVisible', selector: { kind: 'self', suffix: ':focus-visible' } }, { id: 'disabled', selector: { kind: 'self', suffix: ':disabled' } }, { id: 'loading', selector: { kind: 'self', suffix: '[data-bitfun-state~="loading"]' } }],
};
