import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const fileHistoryViewAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'file-history-view',
  parts: [
    { id: 'root' }, { id: 'empty' }, { id: 'header' }, { id: 'headerLeft' },
    { id: 'headerRight' }, { id: 'main' }, { id: 'commits' }, { id: 'state' },
    { id: 'commitList' }, { id: 'commit' }, { id: 'timeline' }, { id: 'commitInfo' },
    { id: 'diff' }, { id: 'diffEmpty' }, { id: 'rootContent' },
  ],
  states: [
    { id: 'selected', selector: { kind: 'self', suffix: '[data-bitfun-state~="selected"]' } },
  ],
};
