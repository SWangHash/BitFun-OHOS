import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

/** Desktop-shell chrome owned by the product surface, not by @openbitfun/ui. */
export const windowControlsAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'window-controls',
  parts: [{ id: 'root' }, { id: 'minimize' }, { id: 'maximize' }, { id: 'close' }],
  states: [
    { id: 'disabled', selector: { kind: 'self', suffix: '[data-openbitfun-state~="disabled"]' } },
    { id: 'maximized', selector: { kind: 'self', suffix: '[data-openbitfun-state~="maximized"]' } },
  ],
};
