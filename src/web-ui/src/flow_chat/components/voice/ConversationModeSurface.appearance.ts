import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const conversationModeSurfaceAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'conversation-mode-surface',
  parts: [
    { id: 'root' },
    { id: 'body' },
    { id: 'voiceHeader' },
    { id: 'composer' },
    { id: 'modeSwitch' },
    { id: 'modeSwitchButton' },
    { id: 'history' },
    { id: 'images' },
    { id: 'imagePreview' },
  ],
  states: [
    { id: 'chat', selector: { kind: 'self', suffix: '[data-bitfun-state~="chat"]' } },
    { id: 'voice', selector: { kind: 'self', suffix: '[data-bitfun-state~="voice"]' } },
  ],
};
