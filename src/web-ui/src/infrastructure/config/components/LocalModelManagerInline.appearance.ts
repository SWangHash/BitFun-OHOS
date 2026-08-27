import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const localModelManagerAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'local-model-manager',
  parts: [
    { id: 'root' },
    { id: 'header' },
    { id: 'serviceInfo' },
    { id: 'modelList' },
    { id: 'modelRow' },
    { id: 'progress' },
    { id: 'readyBadge' },
    { id: 'empty' },
    { id: 'loading' },
  ],
};
