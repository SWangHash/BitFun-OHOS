import type { AppearanceThemeTokenName } from '../types';

export function withLegacyCaptionToken(
  tokens: Partial<Record<AppearanceThemeTokenName, string>> | undefined,
): Partial<Record<AppearanceThemeTokenName, string>> {
  const result = { ...tokens };
  if (result['--bitfun-color-content-caption'] === undefined
    && tokens?.['--bitfun-color-content-muted'] !== undefined) {
    result['--bitfun-color-content-caption'] = tokens['--bitfun-color-content-muted'];
  }
  return result;
}
