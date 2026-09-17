import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance/types';

export const modalAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'modal',
  parts: [
    { id: 'overlay', propertyProfile: 'overlay', visualRole: 'popup' },
    { id: 'dialog', propertyProfile: 'overlay', visualRole: 'dialog' },
    { id: 'headerShell', visualRole: 'toolbar', continuityGroup: 'modal-dialog' },
    { id: 'header', visualRole: 'toolbar', continuityGroup: 'modal-dialog' },
    { id: 'titleGroup', visualRole: 'content' },
    { id: 'title', propertyProfile: 'paint', visualRole: 'content' },
    { id: 'titleExtra', visualRole: 'content' },
    { id: 'close', propertyProfile: 'control', visualRole: 'control' },
    { id: 'content', visualRole: 'content', continuityGroup: 'modal-dialog' },
    { id: 'resizeHandle', propertyProfile: 'overlay', visualRole: 'control' },
  ],
  facets: [
    {
      id: 'size',
      attribute: 'data-bitfun-size',
      values: ['small', 'medium', 'large', 'xlarge'],
    },
    {
      id: 'placement',
      attribute: 'data-bitfun-placement',
      values: ['center', 'bottom-left', 'bottom-right'],
    },
    {
      id: 'resizeDirection',
      attribute: 'data-bitfun-resize-direction',
      values: ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'],
    },
  ],
  states: [
    { id: 'hover', selector: { kind: 'self', suffix: ':hover' } },
    { id: 'focusVisible', selector: { kind: 'self', suffix: ':focus-visible' } },
    { id: 'draggable', selector: { kind: 'self', suffix: '[data-bitfun-state~="draggable"]' } },
    { id: 'dragging', selector: { kind: 'self', suffix: '[data-bitfun-state~="dragging"]' } },
    { id: 'resizable', selector: { kind: 'self', suffix: '[data-bitfun-state~="resizable"]' } },
    { id: 'resizing', selector: { kind: 'self', suffix: '[data-bitfun-state~="resizing"]' } },
    { id: 'contentInset', selector: { kind: 'self', suffix: '[data-bitfun-state~="contentInset"]' } },
  ],
};
