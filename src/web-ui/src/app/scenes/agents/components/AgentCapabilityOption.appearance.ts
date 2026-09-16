import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance/types';

export const agentCapabilityOptionAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'agent-capability-option',
  parts: [{ id: 'root' }],
  states: [
    { id: 'selected', selector: { kind: 'self', suffix: '[data-openbitfun-state~="selected"]' } },
  ],
};
