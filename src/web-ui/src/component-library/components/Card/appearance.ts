import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance/types';

export const cardAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'card',
  parts: [
    { id: 'root' },
    { id: 'header' },
    { id: 'headerContent' },
    { id: 'title' },
    { id: 'subtitle' },
    { id: 'extra' },
    { id: 'body' },
    { id: 'footer' },
  ],
  facets: [
    {
      id: 'variant',
      attribute: 'data-openbitfun-variant',
      values: ['default', 'elevated', 'subtle', 'accent', 'purple'],
    },
    {
      id: 'padding',
      attribute: 'data-openbitfun-padding',
      values: ['none', 'small', 'medium', 'large'],
    },
    {
      id: 'radius',
      attribute: 'data-openbitfun-radius',
      values: ['small', 'medium', 'large'],
    },
    {
      id: 'align',
      attribute: 'data-openbitfun-align',
      values: ['left', 'center', 'right', 'between'],
    },
  ],
  states: [
    { id: 'hover', selector: { kind: 'self', suffix: ':hover' } },
    { id: 'active', selector: { kind: 'self', suffix: ':active' } },
    { id: 'interactive', selector: { kind: 'self', suffix: '[data-openbitfun-state~="interactive"]' } },
    { id: 'fullWidth', selector: { kind: 'self', suffix: '[data-openbitfun-state~="fullWidth"]' } },
  ],
};
