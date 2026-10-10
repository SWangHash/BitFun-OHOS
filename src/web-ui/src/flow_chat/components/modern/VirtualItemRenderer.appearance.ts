import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const virtualItemAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'virtual-item',
  parts: [
    { id: 'root' },
    { id: 'imageAnalyzing' },
    { id: 'placeholder' },
    { id: 'searchLine' },
    // Runtime QT toolchain provisioning: the waterfall row itself, and the
    // ambient card inside it.
    { id: 'qtToolchainProvisionRow' },
    { id: 'qtToolchainProvision' },
  ],
  states: [
    { id: 'searchMatch', selector: { kind: 'self', suffix: '[data-bitfun-state~="searchMatch"]' } },
    { id: 'searchCurrent', selector: { kind: 'self', suffix: '[data-bitfun-state~="searchCurrent"]' } },
  ],
};
