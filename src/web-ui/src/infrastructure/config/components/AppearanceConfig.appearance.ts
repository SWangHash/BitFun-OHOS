import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const appearanceConfigAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'appearance-config',
  parts: [
    { id: 'root' }, { id: 'content' }, { id: 'settings' },
    { id: 'settingsContent' }, { id: 'language' }, { id: 'palettePicker' },
    { id: 'paletteSelect' }, { id: 'paletteOption' },
  ],
};
