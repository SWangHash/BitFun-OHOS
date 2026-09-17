import type { AppearanceThemeTokenName } from '../types';

export function withLegacyComposerTokens(
  tokens: Partial<Record<AppearanceThemeTokenName, string>> | undefined,
): Partial<Record<AppearanceThemeTokenName, string>> {
  const result = { ...tokens };
  for (const [next, previous] of [
    ['--bitfun-color-composer-border', '--bitfun-color-field-border'],
    ['--bitfun-color-composer-context-background', '--bitfun-color-surface-subtle'],
  ] as const) {
    if (result[next] === undefined && tokens?.[previous] !== undefined) result[next] = tokens[previous];
  }
  return result;
}
