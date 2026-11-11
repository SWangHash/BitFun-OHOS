import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const visualSkinConfigAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'visual-skin-settings',
  componentAttribute: 'data-bitfun-product-component',
  parts: [{ id: 'section' }, { id: 'card', propertyProfile: 'paint' }],
  states: [
    { id: 'selected', selector: { kind: 'self', suffix: '[data-bitfun-state~="selected"]' } },
    { id: 'disabled', selector: { kind: 'self', suffix: '[data-bitfun-state~="disabled"]' } },
  ],
};
