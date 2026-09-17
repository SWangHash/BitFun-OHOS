import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const workspaceSessionBatchModalAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'workspace-session-batch-modal',
  parts: [
    { id: 'root' }, { id: 'hero' }, { id: 'toolbar' }, { id: 'toolbarActions' },
    { id: 'summary' }, { id: 'list' }, { id: 'state' }, { id: 'row' },
    { id: 'rowCheck' }, { id: 'rowContent' }, { id: 'footer' },
  ],
  states: [
    { id: 'selected', selector: { kind: 'self', suffix: '[data-bitfun-state~="selected"]' } },
    { id: 'loading', selector: { kind: 'self', suffix: '[data-bitfun-state~="loading"]' } },
    { id: 'error', selector: { kind: 'self', suffix: '[data-bitfun-state~="error"]' } },
    { id: 'child', selector: { kind: 'self', suffix: '[data-bitfun-state~="child"]' } },
  ],
};
