import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const acpPermissionActionsAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'acp-permission-actions',
  parts: [{ id: 'root' }, { id: 'action' }],
  facets: [
    { id: 'presentation', attribute: 'data-bitfun-presentation', values: ['icon', 'text'] },
    { id: 'decision', attribute: 'data-bitfun-decision', values: ['allow', 'reject'] },
  ],
  states: [{ id: 'disabled', selector: { kind: 'self', suffix: ':disabled' } }],
};
