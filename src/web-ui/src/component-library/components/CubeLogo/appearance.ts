import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance/types';

export const cubeLogoAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'cube-logo',
  parts: [
    { id: 'root' }, { id: 'particles' }, { id: 'particle' }, { id: 'scene' },
    { id: 'cube' }, { id: 'block' }, { id: 'face' },
  ],
  facets: [{ id: 'variant', attribute: 'data-openbitfun-variant', values: ['default', 'compact'] }],
};
