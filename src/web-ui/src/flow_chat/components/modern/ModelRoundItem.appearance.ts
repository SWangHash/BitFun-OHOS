import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const modelRoundItemAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'model-round-item',
  // Persisted package names stay stable; product hooks coexist with IconButton.
  componentAttribute: 'data-bitfun-product-component',
  parts: [
    { id: 'root' },
    { id: 'retryHistory' },
    { id: 'retryToggle' },
    { id: 'retryAttempt' },
    { id: 'attemptLabel' },
    { id: 'diagnosticToggle' },
    { id: 'diagnosticDetails' },
    { id: 'diagnosticSection' },
    { id: 'subagent' },
    { id: 'toolItem' },
    { id: 'canvasAttachments' },
    { id: 'footer' },
    { id: 'meta' },
    { id: 'metaItem' },
    { id: 'action' },
  ],
  facets: [
    {
      id: 'status',
      attribute: 'data-bitfun-status',
      values: ['pending', 'queued', 'waiting', 'preparing', 'streaming', 'receiving', 'running', 'completed', 'error', 'cancelled', 'rejected', 'analyzing'],
    },
  ],
  states: [
    { id: 'streaming', selector: { kind: 'self', suffix: '[data-bitfun-state~="streaming"]' } },
    { id: 'expanded', selector: { kind: 'self', suffix: '[data-bitfun-state~="expanded"]' } },
    { id: 'pending', selector: { kind: 'self', suffix: '[data-bitfun-state~="pending"]' } },
    { id: 'copied', selector: { kind: 'self', suffix: '[data-bitfun-state~="copied"]' } },
  ],
};
