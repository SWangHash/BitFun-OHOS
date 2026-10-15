import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

/**
 * Product surface: parts are addressed through `data-bitfun-product-component`
 * / `data-bitfun-product-part` so they survive on `@bitfun/ui` hosts, which own
 * `data-bitfun-component` themselves.
 */
export const migrationProgressPanelAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'migration-progress-panel',
  componentAttribute: 'data-bitfun-product-component',
  parts: [
    { id: 'root' }, { id: 'header' }, { id: 'title' }, { id: 'livePill' }, { id: 'refresh' },
    { id: 'overview' }, { id: 'percent' }, { id: 'phaseStrip' }, { id: 'phaseSegment' },
    { id: 'now' }, { id: 'heartbeat' }, { id: 'currentAction' }, { id: 'notice' },
    { id: 'body' }, { id: 'section' }, { id: 'decision' }, { id: 'phaseList' }, { id: 'phase' },
    { id: 'phaseHeader' }, { id: 'gatePill' }, { id: 'todo' }, { id: 'gateUnmet' }, { id: 'item' },
    { id: 'diagnostic' }, { id: 'reference' },
    { id: 'externalFeature' }, { id: 'featureMilestones' }, { id: 'featureMilestone' },
    { id: 'featureGate' }, { id: 'featureFile' },
    { id: 'featureSelection' },
    { id: 'footer' },
  ],
  facets: [
    {
      id: 'status',
      attribute: 'data-bitfun-status',
      values: ['done', 'doing', 'ready', 'pending', 'blocked', 'error', 'unknown'],
    },
    {
      id: 'live',
      attribute: 'data-bitfun-live',
      values: ['active', 'blocked', 'completed', 'idle'],
    },
    {
      id: 'milestone',
      attribute: 'data-bitfun-milestone',
      values: ['done', 'current', 'pending'],
    },
    {
      id: 'featureGate',
      attribute: 'data-bitfun-gate',
      values: ['ready', 'blocked', 'closed'],
    },
  ],
  states: [
    { id: 'current', selector: { kind: 'self', suffix: '[data-bitfun-state~="current"]' } },
    { id: 'paused', selector: { kind: 'self', suffix: '[data-bitfun-state~="paused"]' } },
    { id: 'running', selector: { kind: 'self', suffix: '[data-bitfun-state~="running"]' } },
    { id: 'searching', selector: { kind: 'self', suffix: '[data-bitfun-state~="searching"]' } },
  ],
};
