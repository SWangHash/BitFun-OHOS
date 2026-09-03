import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance/types';

export const agentsAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'agents',
  parts: [
    { id: 'root' },
    { id: 'anchorBar' },
    { id: 'zones' },
    { id: 'coreGrid' },
    { id: 'industryGrid' },
    { id: 'filters' },
    { id: 'detailSection' },
  ],
};
