import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const navSearchDialogAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'nav-search-dialog',
  parts: [
    { id: 'root' }, { id: 'search' }, { id: 'results' }, { id: 'group' },
    { id: 'groupLabel' }, { id: 'item' }, { id: 'itemIcon' }, { id: 'itemContent' },
    { id: 'itemLabel' }, { id: 'itemSublabel' }, { id: 'sessionHint' },
    { id: 'card' }, { id: 'inputRow' }, { id: 'empty' },
  ],
  states: [
    { id: 'active', selector: { kind: 'self', suffix: '[data-bitfun-state~="active"]' } },
  ],
};
