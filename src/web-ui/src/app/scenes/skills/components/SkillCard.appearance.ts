import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const skillCardAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'skill-card',
  parts: [
    { id: 'root' }, { id: 'header' }, { id: 'avatar' }, { id: 'name' }, { id: 'headerRight' },
    { id: 'description' }, { id: 'footer' }, { id: 'leftContent' }, { id: 'action' },
    { id: 'afterAction' },
  ],
  states: [
    { id: 'hover', selector: { kind: 'self', suffix: ':hover' } },
    { id: 'focusVisible', selector: { kind: 'self', suffix: ':focus-visible' } },
    { id: 'disabled', selector: { kind: 'self', suffix: ':disabled' } },
  ],
};
