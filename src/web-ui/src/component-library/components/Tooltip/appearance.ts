import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance/types';
export const tooltipAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'tooltip', parts: [{ id: 'root' }, { id: 'arrow' }, { id: 'content' }, { id: 'body' }],
  facets: [{ id: 'placement', attribute: 'data-bitfun-placement', values: ['top', 'bottom', 'left', 'right'] }, { id: 'interactive', attribute: 'data-bitfun-interactive', values: ['true', 'false'] }],
  states: [{ id: 'visible', selector: { kind: 'self', suffix: '[data-bitfun-state~="visible"]' } }],
};
