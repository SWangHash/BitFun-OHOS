import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const composerVoiceInputAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'composer-voice-input',
  parts: [
    { id: 'root' }, { id: 'control' }, { id: 'setupPill' },
    { id: 'setupMessage' }, { id: 'status' }, { id: 'action' },
  ],
  facets: [
    { id: 'phase', attribute: 'data-bitfun-phase', values: ['idle', 'setup', 'downloading', 'preparing', 'recording', 'transcribing'] },
    { id: 'action', attribute: 'data-bitfun-action', values: ['install', 'dismiss', 'stop'] },
  ],
  states: [
    { id: 'active', selector: { kind: 'ancestorPart', part: 'root', suffix: '[data-bitfun-state~="active"]' } },
    { id: 'lowVolume', selector: { kind: 'ancestorPart', part: 'root', suffix: '[data-bitfun-state~="low-volume"]' } },
    { id: 'disabled', selector: { kind: 'self', suffix: '[data-bitfun-state~="disabled"]' } },
  ],
};
