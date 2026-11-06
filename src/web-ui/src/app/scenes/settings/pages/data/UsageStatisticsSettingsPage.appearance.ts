import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const usageStatisticsConfigAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'usage-statistics-config',
  parts: [
    { id: 'root' },
    { id: 'overview' },
    { id: 'summary' },
    { id: 'activityPanel' },
    { id: 'details' },
    { id: 'distributions' },
    { id: 'details' },
    { id: 'trendPanel' },
    { id: 'empty' },
  ],
};
