import type { AppearanceThemeTokenName } from '../types';

export function withLegacyActionCardToken(
  tokens: Partial<Record<AppearanceThemeTokenName, string>> | undefined,
): Partial<Record<AppearanceThemeTokenName, string>> {
  const result = { ...tokens };
  if (result['--bitfun-color-action-card-background'] === undefined
    && tokens?.['--bitfun-color-action-neutral-surface'] !== undefined) {
    result['--bitfun-color-action-card-background'] = tokens['--bitfun-color-action-neutral-surface'];
  }
  return result;
}
