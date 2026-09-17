export { bitFunDarkPalette } from './dark';
export { bitFunLightPalette } from './light';
export { bitFunMonochromePalette } from './monochrome';
export { bitFunMidnightPalette } from './midnight';
export { bitFunChinaStylePalette } from './chinaStyle';
export { bitFunChinaNightPalette } from './chinaNight';
export { bitFunCyberPalette } from './cyber';
export { bitFunSlatePalette } from './slate';
export { bitFunTokyoNightPalette } from './tokyoNight';

import { bitFunDarkPalette } from './dark';
import { bitFunLightPalette } from './light';
import { bitFunMonochromePalette } from './monochrome';
import { bitFunMidnightPalette } from './midnight';
import { bitFunChinaStylePalette } from './chinaStyle';
import { bitFunChinaNightPalette } from './chinaNight';
import { bitFunCyberPalette } from './cyber';
import { bitFunSlatePalette } from './slate';
import { bitFunTokyoNightPalette } from './tokyoNight';
import type { AppearancePalette, AppearancePaletteId } from './AppearancePalette';

export const DEFAULT_LIGHT_APPEARANCE_ID: AppearancePaletteId = 'bitfun-light';
export const DEFAULT_DARK_APPEARANCE_ID: AppearancePaletteId = 'bitfun-dark';

export const builtinAppearancePalettes: readonly AppearancePalette[] = Object.freeze([
  bitFunLightPalette,
  bitFunMonochromePalette,
  bitFunSlatePalette,
  bitFunDarkPalette,
  bitFunMidnightPalette,
  bitFunChinaStylePalette,
  bitFunChinaNightPalette,
  bitFunCyberPalette,
  bitFunTokyoNightPalette,
]);
