import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const sessionMenuAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'session-menu',
  parts: [
    { id: 'root' }, { id: 'trigger' }, { id: 'dropdown' }, { id: 'actions' },
    { id: 'scroll' }, { id: 'divider' }, { id: 'item' }, { id: 'itemIcon' },
    { id: 'itemLabel' },
  ],
  facets: [
    { id: 'itemKind', attribute: 'data-bitfun-item-kind', values: ['create', 'session'] },
    { id: 'sessionKind', attribute: 'data-bitfun-session-kind', values: ['code', 'cowork', 'unified'] },
  ],
  states: [
    { id: 'open', selector: { kind: 'ancestorPart', part: 'root', suffix: '[data-bitfun-state~="open"]' } },
    { id: 'active', selector: { kind: 'self', suffix: '[data-bitfun-state~="active"]' } },
  ],
};
