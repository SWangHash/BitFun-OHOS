import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance/types';
export const tagAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'tag', parts: [{ id: 'root' }, { id: 'content' }, { id: 'close' }],
  facets: [{ id: 'variant', attribute: 'data-openbitfun-variant', values: ['blue', 'green', 'red', 'yellow', 'purple', 'gray'] }, { id: 'size', attribute: 'data-openbitfun-size', values: ['small', 'medium', 'large'] }],
  states: [{ id: 'rounded', selector: { kind: 'self', suffix: '[data-openbitfun-state~="rounded"]' } }, { id: 'hover', selector: { kind: 'self', suffix: ':hover' } }, { id: 'focusVisible', selector: { kind: 'self', suffix: ':focus-visible' } }],
};
