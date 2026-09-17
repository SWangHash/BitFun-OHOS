import type { AppearanceThemeTokenName } from '../types';

export function withLegacyIndicatorTokens(
  tokens: Partial<Record<AppearanceThemeTokenName, string>> | undefined,
): Partial<Record<AppearanceThemeTokenName, string>> {
  const result = { ...tokens };
  for (const [next, previous] of [
    ['--bitfun-color-number-badge-background', '--bitfun-color-action-neutral-surface'],
    ['--bitfun-color-key-hint-content', '--bitfun-color-content-muted'],
  ] as const) {
    if (result[next] === undefined && tokens?.[previous] !== undefined) result[next] = tokens[previous];
  }
  return result;
}
