import { createHash } from 'node:crypto';
import {
  cssVariables as systemCssVariables,
  tokens as systemTokens,
} from '@bitfun/design-tokens';
import { themeCssVariables } from '@bitfun/theme-bitfun';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { widgetAppearanceAdapter } from '@/infrastructure/appearance/adapters/WidgetAppearanceAdapter';
import {
  WIDGET_APPEARANCE_FALLBACK_VARS,
  WIDGET_APPEARANCE_VAR_NAMES,
  WIDGET_TYPOGRAPHY_VARIABLE_NAMES,
  createWidgetAppearanceFallbackCss,
  readWidgetAppearancePayload,
} from './appearancePayload';

const CANONICAL_THEME_VARIABLE_NAMES = Object.values(themeCssVariables);
const SHARED_THEME_VARIABLE_NAMES_HASH = 'e80ebcdf9452a0b5f8ab26d9b41cb81c4e74d75451e4402f99afc68af3c13f42';
// Button owns these state colors independently of the existing shared actions.
// Keep the original shared contract intact and enumerate this addition exactly.
const BUTTON_THEME_VARIABLE_NAMES = [
  '--bitfun-component-button-content',
  '--bitfun-component-button-fill-background',
  '--bitfun-component-button-fill-background-hover',
  '--bitfun-component-button-fill-background-pressed',
  '--bitfun-component-button-outline-border',
  '--bitfun-component-button-outline-border-interactive',
  '--bitfun-component-button-primary-background',
  '--bitfun-component-button-primary-background-hover',
  '--bitfun-component-button-primary-background-pressed',
  '--bitfun-component-button-primary-content-disabled',
  '--bitfun-component-button-text-content',
  '--bitfun-component-button-text-content-disabled',
  '--bitfun-component-button-text-content-hover',
] as const;
// Field editing borders and hints have dedicated semantics; preserve the shared
// contract fingerprint while asserting these two additions by their exact names.
const FIELD_STATE_THEME_VARIABLE_NAMES = [
  '--bitfun-color-field-border-active',
  '--bitfun-color-field-placeholder',
] as const;
// Grouped forms own a translucent fill independently of opaque tertiary surfaces
// and transient subtle feedback; keep this addition outside the shared fingerprint.
const FIELD_GROUP_THEME_VARIABLE_NAME = '--bitfun-color-field-group-background';
// Menu and navigation captions own their final contrast independently of body
// descriptions and field hints; assert this addition without changing the shared baseline.
const CAPTION_THEME_VARIABLE_NAME = '--bitfun-color-content-caption';
// Persistent action cards own their fill independently of transient feedback
// and form groups; keep the shared contract fingerprint unchanged.
const ACTION_CARD_THEME_VARIABLE_NAME = '--bitfun-color-action-card-background';
// Compact indicators own badge fill and key-hint contrast independently of
// shared action surfaces and muted prose; enumerate only these additions.
const INDICATOR_THEME_VARIABLE_NAMES = [
  '--bitfun-color-key-hint-content',
  '--bitfun-color-number-badge-background',
] as const;
// Composer and ChatComposer share editor borders and context tint independently
// of form fields and transient surfaces; enumerate these additions exactly.
const COMPOSER_THEME_VARIABLE_NAMES = [
  '--bitfun-color-composer-border',
  '--bitfun-color-composer-context-background',
] as const;
const RETIRED_WIDGET_VARIABLE_NAMES = [
  '--background-primary',
  '--bg-primary',
  '--text-primary',
  '--accent-primary',
  '--bitfun-appearance-token-color-bg-primary',
  '--bitfun-appearance-token-color-text-primary',
  '--bitfun-appearance-token-color-accent-500',
  '--bitfun-appearance-token-btn-primary-bg',
  '--bitfun-color-accent-default-rgb',
  '--bitfun-color-status-success-content-bg',
  '--bitfun-color-status-success-content-border',
  '--bitfun-color-status-warning-content-bg',
  '--bitfun-color-status-warning-content-border',
  '--bitfun-color-status-danger-content-bg',
  '--bitfun-color-status-danger-content-border',
] as const;

function readPayloadWithHostValues(hostValues: Record<string, string> = {}) {
  widgetAppearanceAdapter.apply({
    id: 'test-appearance',
    mode: 'dark',
    vars: hostValues,
  }, undefined, { revision: 1, mode: 'dark', assets: {} });

  return readWidgetAppearancePayload();
}

function hashNames(names: readonly string[]): string {
  return createHash('sha256')
    .update(names.join('\n'))
    .digest('hex');
}

describe('generated widget appearance payload contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('derives its complete host payload allowlist from the canonical theme package', () => {
    expect(WIDGET_APPEARANCE_VAR_NAMES).toEqual(CANONICAL_THEME_VARIABLE_NAMES);
    expect(new Set(WIDGET_APPEARANCE_VAR_NAMES).size).toBe(WIDGET_APPEARANCE_VAR_NAMES.length);
    const buttonNames = WIDGET_APPEARANCE_VAR_NAMES.filter(name => name.startsWith('--bitfun-component-button-'));
    const fieldStateNames = WIDGET_APPEARANCE_VAR_NAMES.filter(name => FIELD_STATE_THEME_VARIABLE_NAMES.some(fieldName => fieldName === name));
    const indicatorNames = WIDGET_APPEARANCE_VAR_NAMES.filter(name => INDICATOR_THEME_VARIABLE_NAMES.some(indicatorName => indicatorName === name));
    const composerNames = WIDGET_APPEARANCE_VAR_NAMES.filter(name => COMPOSER_THEME_VARIABLE_NAMES.some(composerName => composerName === name));
    const sharedNames = WIDGET_APPEARANCE_VAR_NAMES.filter(name => (
      !name.startsWith('--bitfun-component-button-')
      && !FIELD_STATE_THEME_VARIABLE_NAMES.some(fieldName => fieldName === name)
      && name !== FIELD_GROUP_THEME_VARIABLE_NAME
      && name !== CAPTION_THEME_VARIABLE_NAME
      && name !== ACTION_CARD_THEME_VARIABLE_NAME
      && !INDICATOR_THEME_VARIABLE_NAMES.some(indicatorName => indicatorName === name)
      && !COMPOSER_THEME_VARIABLE_NAMES.some(composerName => composerName === name)
    ));
    expect(buttonNames).toEqual(BUTTON_THEME_VARIABLE_NAMES);
    expect(fieldStateNames).toEqual(FIELD_STATE_THEME_VARIABLE_NAMES);
    expect(indicatorNames).toEqual(INDICATOR_THEME_VARIABLE_NAMES);
    expect(composerNames).toEqual(COMPOSER_THEME_VARIABLE_NAMES);
    expect(WIDGET_APPEARANCE_VAR_NAMES).toContain(FIELD_GROUP_THEME_VARIABLE_NAME);
    expect(WIDGET_APPEARANCE_VAR_NAMES).toContain(CAPTION_THEME_VARIABLE_NAME);
    expect(WIDGET_APPEARANCE_VAR_NAMES).toContain(ACTION_CARD_THEME_VARIABLE_NAME);
    expect({
      count: sharedNames.length,
      hash: hashNames(sharedNames),
      first: sharedNames[0],
      last: sharedNames[sharedNames.length - 1],
    }).toEqual({
      count: 127,
      hash: SHARED_THEME_VARIABLE_NAMES_HASH,
      first: '--bitfun-color-accent-border',
      last: '--bitfun-shadow-xs',
    });
  });

  it('uses the builtin canonical theme as the payload fallback', () => {
    const payload = readPayloadWithHostValues();

    expect(payload?.vars).toMatchObject(WIDGET_APPEARANCE_FALLBACK_VARS);
    expect(Object.keys(WIDGET_APPEARANCE_FALLBACK_VARS)).toEqual(WIDGET_APPEARANCE_VAR_NAMES);
    expect(Object.keys(payload?.vars ?? {}).sort()).toEqual([
      ...WIDGET_APPEARANCE_VAR_NAMES,
      ...WIDGET_TYPOGRAPHY_VARIABLE_NAMES,
    ].sort());
    expect(WIDGET_APPEARANCE_FALLBACK_VARS['--bitfun-color-surface-canvas']).toBe('transparent');
  });

  it('exports canonical state and status semantics without legacy aliases', () => {
    expect(WIDGET_APPEARANCE_VAR_NAMES).toEqual(expect.arrayContaining([
      '--bitfun-color-action-primary-background',
      '--bitfun-color-action-primary-hover',
      '--bitfun-color-action-primary-pressed',
      '--bitfun-color-code-change-added',
      '--bitfun-color-code-change-removed',
      '--bitfun-color-status-info-emphasis',
      '--bitfun-color-status-success-emphasis',
      '--bitfun-color-status-warning-emphasis',
      '--bitfun-color-status-danger-emphasis',
      '--bitfun-color-status-success-content',
      '--bitfun-color-status-success-surface',
      '--bitfun-color-status-success-border',
      '--bitfun-color-status-warning-surface',
      '--bitfun-color-status-danger-surface',
      '--bitfun-color-status-info-surface',
    ]));
    expect(WIDGET_APPEARANCE_VAR_NAMES).not.toEqual(
      expect.arrayContaining(RETIRED_WIDGET_VARIABLE_NAMES),
    );
    expect(WIDGET_APPEARANCE_VAR_NAMES.some(name => name.startsWith('--bitfun-appearance-token-')))
      .toBe(false);
  });

  it('passes canonical host overrides through unchanged', () => {
    const hostValues = {
      '--bitfun-color-action-primary-background': 'linear-gradient(test-primary)',
      '--bitfun-color-action-primary-content': '#101010',
      '--bitfun-color-action-primary-hover': 'linear-gradient(test-hover)',
      '--bitfun-color-action-primary-pressed': '#202020',
      '--bitfun-color-action-card-background': 'rgba(0, 0, 0, 0.07)',
      '--bitfun-color-composer-border': 'rgba(0, 0, 0, 0.14)',
      '--bitfun-color-composer-context-background': 'rgba(0, 0, 0, 0.06)',
      '--bitfun-color-content-caption': 'rgba(0, 0, 0, 0.45)',
      '--bitfun-component-button-primary-background': '#303030',
      '--bitfun-component-button-fill-background': 'rgba(0, 0, 0, 0.08)',
      '--bitfun-color-field-border-active': 'rgba(0, 0, 0, 0.20)',
      '--bitfun-color-field-group-background': 'rgba(0, 0, 0, 0.03)',
      '--bitfun-color-field-placeholder': 'rgba(0, 0, 0, 0.40)',
      '--bitfun-color-key-hint-content': 'rgba(0, 0, 0, 0.55)',
      '--bitfun-color-number-badge-background': 'rgba(0, 0, 0, 0.09)',
      '--bitfun-color-status-danger-surface': 'rgba(200, 0, 0, 0.12)',
      '--bitfun-color-status-danger-border': '#303030',
      '--bitfun-shadow-raised': '0 1px 2px #404040',
    };

    expect(readPayloadWithHostValues(hostValues)?.vars).toMatchObject(hostValues);
  });

  it('renders one self-contained fallback scope from canonical theme and system tokens', () => {
    const css = createWidgetAppearanceFallbackCss();

    for (const [name, value] of Object.entries(WIDGET_APPEARANCE_FALLBACK_VARS)) {
      expect(css).toContain(`      ${name}: ${value};`);
    }
    for (const [tokenName, value] of Object.entries(systemTokens)) {
      const variableName = systemCssVariables[tokenName as keyof typeof systemCssVariables];
      expect(css).toContain(`      ${variableName}: ${String(value)};`);
    }
    for (const retiredName of RETIRED_WIDGET_VARIABLE_NAMES) {
      expect(css).not.toContain(`${retiredName}:`);
    }
  });
});
