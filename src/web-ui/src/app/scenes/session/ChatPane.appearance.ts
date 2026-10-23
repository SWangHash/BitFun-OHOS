import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const chatPaneAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'chat-pane',
  parts: [
    {
      id: 'root',
      propertyProfile: 'layout',
      visualRole: 'continuous-surface',
      continuityGroup: 'session-workspace',
    },
    { id: 'modelNotice', propertyProfile: 'paint', visualRole: 'content' },
    { id: 'modelNoticeCopy', propertyProfile: 'paint', visualRole: 'content' },
    { id: 'modelNoticeAction', propertyProfile: 'control', visualRole: 'control' },
  ],
};
