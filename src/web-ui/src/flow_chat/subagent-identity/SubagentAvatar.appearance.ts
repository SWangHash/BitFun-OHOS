import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const subagentAvatarAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'subagent-avatar',
  parts: [{ id: 'root' }],
  states: [
    { id: 'running', selector: { kind: 'self', suffix: '[data-bitfun-state~="running"]' } },
    { id: 'finishing', selector: { kind: 'self', suffix: '[data-bitfun-state~="finishing"]' } },
    { id: 'waiting', selector: { kind: 'self', suffix: '[data-bitfun-state~="waiting"]' } },
    { id: 'completed', selector: { kind: 'self', suffix: '[data-bitfun-state~="completed"]' } },
    { id: 'cancelled', selector: { kind: 'self', suffix: '[data-bitfun-state~="cancelled"]' } },
    { id: 'error', selector: { kind: 'self', suffix: '[data-bitfun-state~="error"]' } },
    { id: 'idle', selector: { kind: 'self', suffix: '[data-bitfun-state~="idle"]' } },
  ],
};
