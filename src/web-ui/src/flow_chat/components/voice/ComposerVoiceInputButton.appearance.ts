import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const composerVoiceInputAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'composer-voice-input',
  parts: [
    { id: 'root' },
    { id: 'control' },
    { id: 'status' },
    { id: 'recordingHint' },
  ],
  facets: [
    { id: 'phase', attribute: 'data-bf-phase', values: ['idle', 'preparing', 'recording', 'transcribing'] },
  ],
  states: [
    { id: 'active', selector: { kind: 'ancestorPart', part: 'root', suffix: '[data-bf-state~="active"]' } },
    { id: 'lowVolume', selector: { kind: 'ancestorPart', part: 'root', suffix: '[data-bf-state~="low-volume"]' } },
    { id: 'disabled', selector: { kind: 'self', suffix: '[data-bf-state~="disabled"]' } },
  ],
};
