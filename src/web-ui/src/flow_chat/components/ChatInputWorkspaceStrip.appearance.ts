import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';
export const chatInputWorkspaceStripAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'chat-input-workspace-strip',
  // The strip is two rails: `context` is the situation the next turn starts
  // from, `next` is what that turn is configured with. The old `main` /
  // `harness` / `runtime` / `actions` grouping went with the conditional grid.
  parts: [
    { id: 'root' }, { id: 'context' }, { id: 'next' },
    { id: 'workspace' }, { id: 'workspaceMenu' },
    { id: 'workspaceOption' }, { id: 'branch' }, { id: 'divider' },
    { id: 'permission' }, { id: 'permissionMenu' },
    { id: 'permissionOptions' }, { id: 'usageAction' },
    { id: 'goal' },
    // Quick goal controls are separate parts, not states of the readout:
    // pausing and clearing are gestures on the goal, not ways it can look.
    { id: 'goalRun' }, { id: 'goalClear' },
  ],
  states: [
    { id: 'open', selector: { kind: 'self', suffix: '[data-bitfun-state~="open"]' } },
    { id: 'selected', selector: { kind: 'self', suffix: '[data-bitfun-state~="selected"]' } },
    { id: 'active', selector: { kind: 'self', suffix: '[data-bitfun-state~="active"]' } },
    // The goal control carries its tone as its state, so these three exist as
    // states of the track rather than as classes that skins must guess at.
    { id: 'paused', selector: { kind: 'self', suffix: '[data-bitfun-state~="paused"]' } },
    { id: 'blocked', selector: { kind: 'self', suffix: '[data-bitfun-state~="blocked"]' } },
    { id: 'complete', selector: { kind: 'self', suffix: '[data-bitfun-state~="complete"]' } },
    { id: 'armed', selector: { kind: 'self', suffix: '[data-bitfun-state~="armed"]' } },
  ],
};
