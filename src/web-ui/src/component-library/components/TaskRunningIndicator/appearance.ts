import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance/types';

export const taskRunningIndicatorAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'task-running-indicator',
  parts: [{ id: 'root' }, { id: 'bar' }],
  facets: [{ id: 'size', attribute: 'data-openbitfun-size', values: ['xs', 'sm', 'md', 'lg'] }],
};
