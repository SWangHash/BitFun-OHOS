import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const sessionFileModificationsBarAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'session-file-modifications-bar',
  parts: [
    { id: 'root' }, { id: 'header' }, { id: 'summary' }, { id: 'toggle' },
    { id: 'list' }, { id: 'file' }, { id: 'fileIcon' }, { id: 'fileName' },
    { id: 'fileSource' }, { id: 'fileError' }, { id: 'fileStats' },
  ],
  facets: [
    { id: 'layout', attribute: 'data-bitfun-layout', values: ['default', 'compact'] },
    { id: 'operation', attribute: 'data-bitfun-operation', values: ['write', 'delete', 'edit'] },
  ],
  states: [
    { id: 'expanded', selector: { kind: 'self', suffix: '[data-bitfun-state~="expanded"]' } },
    { id: 'error', selector: { kind: 'self', suffix: '[data-bitfun-state~="error"]' } },
  ],
};
