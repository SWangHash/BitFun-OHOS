import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';
export const fileViewerNavAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'file-viewer-nav',
  parts: [
    { id: 'root' }, { id: 'header' }, { id: 'actions' },
    { id: 'workspace' }, { id: 'workspaceButton' }, { id: 'location' }, { id: 'sections' },
    { id: 'empty' },
    { id: 'divider' }, { id: 'terminalList' }, { id: 'terminalRow' }, { id: 'terminalOpen' },
    { id: 'terminalMeta' }, { id: 'status' }, { id: 'terminalActions' }, { id: 'error' },
  ],
};
