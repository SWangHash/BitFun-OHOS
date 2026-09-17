import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const harnessProfileSelectorAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'harness-selector',
  parts: [
    { id: 'root' },
    { id: 'trigger' },
    { id: 'menu' },
    { id: 'profile' },
    { id: 'agent' },
  ],
  facets: [
    {
      id: 'presentation',
      attribute: 'data-bitfun-presentation',
      values: ['standalone', 'menu-item'],
    },
    {
      id: 'profile',
      attribute: 'data-bitfun-profile',
      values: ['Minimal', 'Standard', 'Ultimate', 'Creative', 'other'],
    },
  ],
  states: [
    { id: 'open', selector: { kind: 'self', suffix: '[data-bitfun-state~="open"]' } },
    { id: 'fixed', selector: { kind: 'self', suffix: '[data-bitfun-state~="fixed"]' } },
    { id: 'current', selector: { kind: 'self', suffix: '[data-bitfun-state~="current"]' } },
    { id: 'available', selector: { kind: 'self', suffix: '[data-bitfun-state~="available"]' } },
    { id: 'unavailable', selector: { kind: 'self', suffix: '[data-bitfun-state~="unavailable"]' } },
    { id: 'comingSoon', selector: { kind: 'self', suffix: '[data-bitfun-state~="coming-soon"]' } },
  ],
};
