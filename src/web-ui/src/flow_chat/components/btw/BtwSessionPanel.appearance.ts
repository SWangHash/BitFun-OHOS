import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const btwSessionPanelAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'btw-session-panel',
  parts: [
    { id: 'root' },
    { id: 'header' },
    { id: 'headerMain' },
    { id: 'badge' },
    { id: 'title' },
    { id: 'meta' },
    { id: 'actions' },
    { id: 'body' },
    { id: 'empty' },
    { id: 'scrollToBottom' },
    { id: 'minimized' },
    { id: 'actionBar' },
  ],
  facets: [
    { id: 'view', attribute: 'data-bitfun-view', values: ['empty', 'session'] },
  ],
  states: [
    { id: 'hasActionBar', selector: { kind: 'self', suffix: '[data-bitfun-state~="hasActionBar"]' } },
    { id: 'minimized', selector: { kind: 'self', suffix: '[data-bitfun-state~="minimized"]' } },
    { id: 'hidden', selector: { kind: 'self', suffix: '[data-bitfun-state~="hidden"]' } },
  ],
};
