import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const scrollToLatestBarAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'scroll-to-latest-bar',
  componentAttribute: 'data-bitfun-product-component',
  parts: [{ id: 'root' }, { id: 'gradient' }, { id: 'content' }, { id: 'button' }],
  facets: [{ id: 'input', attribute: 'data-bitfun-input', values: ['active', 'expanded', 'collapsed'] }],
};
