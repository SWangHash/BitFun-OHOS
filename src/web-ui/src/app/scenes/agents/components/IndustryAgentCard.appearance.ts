import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const industryAgentCardAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'industry-agent-card',
  componentAttribute: 'data-bitfun-product-component',
  parts: [
    { id: 'root' },
    { id: 'header' },
    { id: 'headerInfo' },
    { id: 'titleRow' },
    { id: 'name' },
    { id: 'badges' },
    { id: 'iconArea' },
    { id: 'icon' },
    { id: 'body' },
    { id: 'description' },
    { id: 'footer' },
    { id: 'meta' },
  ],
};
