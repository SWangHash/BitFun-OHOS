import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const userMessageEditComposerAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'user-message-edit-composer',
  componentAttribute: 'data-bitfun-product-component',
  parts: [{ id: 'root' }, { id: 'input' }, { id: 'actions' }, { id: 'action' }, { id: 'spinner' }],
  facets: [
    { id: 'mode', attribute: 'data-bitfun-mode', values: ['rich', 'plain'] },
    { id: 'action', attribute: 'data-bitfun-action', values: ['cancel', 'submit'] },
  ],
  states: [
    { id: 'submitting', selector: { kind: 'ancestorPart', part: 'root', suffix: '[data-bitfun-state~="submitting"]' } },
  ],
};
