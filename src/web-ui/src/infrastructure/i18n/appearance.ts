import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const languageSelectorAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'language-selector',
  parts: [
    { id: 'root' },
    { id: 'trigger' },
    { id: 'icon' },
    { id: 'code' },
    { id: 'menu' },
    { id: 'option' },
    { id: 'optionLabel' },
    { id: 'check' },
    { id: 'loading' },
  ],
  facets: [
    { id: 'mode', attribute: 'data-bitfun-mode', values: ['dropdown', 'inline', 'icon-only'] },
  ],
  states: [
    { id: 'active', selector: { kind: 'self', suffix: '[data-bitfun-state~="active"]' } },
    { id: 'changing', selector: { kind: 'self', suffix: '[data-bitfun-state~="changing"]' } },
  ],
};
