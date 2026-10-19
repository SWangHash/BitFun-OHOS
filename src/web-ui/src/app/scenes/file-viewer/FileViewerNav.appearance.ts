import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';
export const fileViewerNavAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'file-viewer-nav',
  parts: [
    { id: 'root' }, { id: 'header' }, { id: 'actions' },
    { id: 'workspace' }, { id: 'workspaceButton' }, { id: 'location' }, { id: 'sections' },
    { id: 'empty' },
  ],
};
