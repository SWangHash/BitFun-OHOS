import type { AppearanceThemeTokenName } from '../types';

// Old packages used content.muted for hints and borderFocus for editing. Explicit field colors
// take precedence; missing values continue to come from the selected base theme.
export function withLegacyFieldTokens(
  tokens: Partial<Record<AppearanceThemeTokenName, string>> | undefined,
): Partial<Record<AppearanceThemeTokenName, string>> {
  const result = { ...tokens };
  const legacy = tokens?.['--bitfun-color-content-muted'];
  if (result['--bitfun-color-field-placeholder'] === undefined && legacy !== undefined) {
    result['--bitfun-color-field-placeholder'] = legacy;
  }
  const legacyFocus = tokens?.['--bitfun-color-field-border-focus'];
  if (result['--bitfun-color-field-border-active'] === undefined && legacyFocus !== undefined) {
    result['--bitfun-color-field-border-active'] = legacyFocus;
  }
  const legacyGroup = tokens?.['--bitfun-color-surface-tertiary'];
  if (result['--bitfun-color-field-group-background'] === undefined && legacyGroup !== undefined) {
    result['--bitfun-color-field-group-background'] = legacyGroup;
  }
  return result;
}
