import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const sessionFilesBadgeAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'session-files-badge',
  parts: [
    { id: 'root' },
    { id: 'reviewMenu' },
    { id: 'reviewTrigger' },
    { id: 'reviewPopover' },
    { id: 'reviewItem' },
    { id: 'trigger' },
    { id: 'stats' },
    { id: 'popover' },
    { id: 'summary' },
    { id: 'list' },
    { id: 'file' },
    { id: 'fileError' },
    { id: 'fileStats' },
  ],
  facets: [
    { id: 'operation', attribute: 'data-bitfun-operation', values: ['create', 'modify', 'delete'] },
  ],
  states: [
    { id: 'expanded', selector: { kind: 'self', suffix: '[data-bitfun-state~="expanded"]' } },
    { id: 'open', selector: { kind: 'self', suffix: '[data-bitfun-state~="open"]' } },
    { id: 'selected', selector: { kind: 'self', suffix: '[data-bitfun-state~="selected"]' } },
    { id: 'error', selector: { kind: 'self', suffix: '[data-bitfun-state~="error"]' } },
  ],
};
