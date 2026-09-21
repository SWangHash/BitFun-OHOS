import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const privacyGateAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'privacy-gate',
  parts: [
    { id: 'root', visualRole: 'dialog' },
    { id: 'resource', visualRole: 'dialog' },
    { id: 'metadata', visualRole: 'content' },
    { id: 'intro', visualRole: 'content' },
    { id: 'document', visualRole: 'content' },
    { id: 'releaseBlocked', visualRole: 'content' },
    { id: 'error', visualRole: 'content' },
    { id: 'actions', visualRole: 'toolbar' },
    { id: 'consent', visualRole: 'control' },
  ],
};
