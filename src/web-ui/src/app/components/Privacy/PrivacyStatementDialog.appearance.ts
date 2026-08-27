import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const privacyStatementDialogAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'privacy-dialog',
  parts: [
    { id: 'root', visualRole: 'dialog' },
    { id: 'metadata', visualRole: 'content' },
    { id: 'mode', visualRole: 'content' },
    { id: 'document', visualRole: 'content' },
    { id: 'error', visualRole: 'content' },
    { id: 'actions', visualRole: 'toolbar' },
    { id: 'consent', visualRole: 'control' },
  ],
};
