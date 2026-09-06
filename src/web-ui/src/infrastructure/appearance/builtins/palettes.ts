export { openOpenBitFunDarkPalette } from './dark';
export { openOpenBitFunLightPalette } from './light';
export { openOpenBitFunMonochromePalette } from './monochrome';
export { openOpenBitFunMidnightPalette } from './midnight';
export { openOpenBitFunChinaStylePalette } from './chinaStyle';
export { openOpenBitFunChinaNightPalette } from './chinaNight';
export { openOpenBitFunCyberPalette } from './cyber';
export { openOpenBitFunSlatePalette } from './slate';
export { openOpenBitFunTokyoNightPalette } from './tokyoNight';

import { openOpenBitFunDarkPalette } from './dark';
import { openOpenBitFunLightPalette } from './light';
import { openOpenBitFunMonochromePalette } from './monochrome';
import { openOpenBitFunMidnightPalette } from './midnight';
import { openOpenBitFunChinaStylePalette } from './chinaStyle';
import { openOpenBitFunChinaNightPalette } from './chinaNight';
import { openOpenBitFunCyberPalette } from './cyber';
import { openOpenBitFunSlatePalette } from './slate';
import { openOpenBitFunTokyoNightPalette } from './tokyoNight';
import type { AppearancePalette, AppearancePaletteId } from './AppearancePalette';

export const DEFAULT_LIGHT_APPEARANCE_ID: AppearancePaletteId = 'openbitfun-light';
export const DEFAULT_DARK_APPEARANCE_ID: AppearancePaletteId = 'openbitfun-dark';

export const builtinAppearancePalettes: readonly AppearancePalette[] = Object.freeze([
  openOpenBitFunLightPalette,
  openOpenBitFunMonochromePalette,
  openOpenBitFunSlatePalette,
  openOpenBitFunDarkPalette,
  openOpenBitFunMidnightPalette,
  openOpenBitFunChinaStylePalette,
  openOpenBitFunChinaNightPalette,
  openOpenBitFunCyberPalette,
  openOpenBitFunTokyoNightPalette,
]);
