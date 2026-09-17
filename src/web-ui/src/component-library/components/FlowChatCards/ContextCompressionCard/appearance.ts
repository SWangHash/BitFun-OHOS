import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const contextCompressionCardAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'context-compression-card',
  parts: [
    { id: 'compact' }, { id: 'status' }, { id: 'action' }, { id: 'tokens' },
    { id: 'result' }, { id: 'processing' }, { id: 'summaryRow' }, { id: 'statsRow' },
  ],
  facets: [
    { id: 'display', attribute: 'data-bitfun-display', values: ['compact'] },
    { id: 'status', attribute: 'data-bitfun-status', values: ['pending', 'preparing', 'running', 'streaming', 'completed', 'cancelled', 'error'] },
  ],
};
