import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';
export const floatingMiniChatAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'floating-mini-chat',
  parts: [
    { id: 'root' }, { id: 'backdrop' }, { id: 'trigger' }, { id: 'triggerActivity' },
    { id: 'triggerIcon' }, { id: 'panel' }, { id: 'header' }, { id: 'sessionIcon' },
    { id: 'headerAction' }, { id: 'title' }, { id: 'body' },
    { id: 'pending' }, { id: 'pendingIcon' },
  ],
  facets: [
    { id: 'mode', attribute: 'data-bitfun-mode', values: ['chat', 'miniapp'] },
    { id: 'communicationMode', attribute: 'data-bitfun-communication-mode', values: ['chat', 'voice'] },
  ],
  states: [
    { id: 'open', selector: { kind: 'ancestorPart', part: 'root', suffix: '[data-bitfun-state~="open"]' } },
    { id: 'processing', selector: { kind: 'ancestorPart', part: 'root', suffix: '[data-bitfun-state~="processing"]' } },
    { id: 'voice', selector: { kind: 'ancestorPart', part: 'root', suffix: '[data-bitfun-state~="voice"]' } },
    { id: 'customizing', selector: { kind: 'ancestorPart', part: 'root', suffix: '[data-bitfun-state~="customizing"]' } },
  ],
};
