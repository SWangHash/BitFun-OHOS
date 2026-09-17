import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const dateTimePickerAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'datetime-picker',
  parts: [
    { id: 'root' },
    { id: 'head' },
    { id: 'grid' },
    { id: 'day' },
    { id: 'foot' },
  ],
  states: [
    { id: 'selected', selector: { kind: 'self', suffix: '[data-bitfun-state~="selected"]' } },
    { id: 'today', selector: { kind: 'self', suffix: '[data-bitfun-state~="today"]' } },
  ],
};
