import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const contextListAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'context-list',
  parts: [
    { id: 'root' },
    { id: 'empty' },
    { id: 'header' },
    { id: 'title' },
    { id: 'count' },
    { id: 'items' },
    { id: 'item' },
    { id: 'card' },
    { id: 'cardIndicator' },
    { id: 'cardBody' },
    { id: 'cardToolbar' },
    { id: 'cardError' },
    { id: 'dropZone' },
  ],
  states: [
    { id: 'empty', selector: { kind: 'self', suffix: '[data-bitfun-state~="empty"]' } },
    { id: 'valid', selector: { kind: 'self', suffix: '[data-bitfun-state~="valid"]' } },
    { id: 'invalid', selector: { kind: 'self', suffix: '[data-bitfun-state~="invalid"]' } },
    { id: 'dragOver', selector: { kind: 'self', suffix: '[data-bitfun-state~="drag-over"]' } },
    { id: 'canAccept', selector: { kind: 'self', suffix: '[data-bitfun-state~="can-accept"]' } },
  ],
};
