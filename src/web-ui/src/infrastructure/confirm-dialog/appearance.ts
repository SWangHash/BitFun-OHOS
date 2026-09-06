import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance/types';

export const confirmDialogAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'confirm-dialog',
  parts: [
    { id: 'root' },
    { id: 'icon' },
    { id: 'content' },
    { id: 'title' },
    { id: 'message' },
    { id: 'messageRow' },
    { id: 'preview' },
    { id: 'actions' },
  ],
  facets: [{
    id: 'status',
    attribute: 'data-openbitfun-status',
    values: ['info', 'warning', 'danger', 'success'],
  }],
};
