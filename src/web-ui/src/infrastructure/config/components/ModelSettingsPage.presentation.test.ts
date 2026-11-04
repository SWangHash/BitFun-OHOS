import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./ModelSettingsPage.tsx', import.meta.url)),
  'utf8',
);
const styles = readFileSync(
  fileURLToPath(new URL('./ModelSettingsPage.scss', import.meta.url)),
  'utf8',
);

describe('ModelSettingsPage presentation', () => {
  it('does not render Unicode replacement characters', () => {
    expect(source).not.toContain('\uFFFD');
  });

  it('declares required model fields structurally instead of embedding asterisks in label copy', () => {
    expect(source).not.toMatch(/label=\{`[^`]*\*[^`]*`\}/);
    expect(source.match(/<ConfigPageRow label=\{t\('form\.configName'\)\} required/g)).toHaveLength(1);
    expect(source).toContain('data-testid="settings-model-name-input"');
    expect(source).toMatch(/required\s+invalid=\{showModelValidation && !draft\.modelName\.trim\(\)\}/);
    // Template and custom-provider connections share the required API URL field.
    expect(source.match(/<ConfigPageRow label=\{t\('form\.baseUrl'\)\} required/g)).toHaveLength(1);
    expect(source).toContain('<ConfigPageRow label={label} required={apiKeyRequired} align="center" wide>');
  });

  it('preserves the intrinsic width of design-system switches in edit rows', () => {
    expect(styles.match(/> :not\(\[data-bitfun-component='switch'\]\)/g)).toHaveLength(2);
    expect(styles).not.toMatch(/> \* \{\s*min-width: 0;\s*width: 100%/);
    expect(styles).not.toMatch(/> \* \{\s*width: auto;\s*max-width: none;/);
  });

  it('connects endpoint layout styles and keeps quick-add actions at their intrinsic width', () => {
    expect(source).toContain('<ConfigPageRow label={t(\'form.baseUrl\')} required wide className="bitfun-model-settings__endpoint-row">');
    expect(source).toContain('<span className="bitfun-model-settings__resolved-url-label">');
    expect(source).toContain('<span className="bitfun-model-settings__resolved-url-value">');
    const pickerStyles = styles.match(/&__model-picker-row\s*\{([^}]+)\}/)?.[1];
    expect(pickerStyles).toContain('display: inline-flex;');
    expect(pickerStyles).not.toContain('width: 100%');
    expect(pickerStyles).not.toContain('subgrid');
    expect(styles).toMatch(/&__connection-section &__connection-row:has\(> \.bitfun-config-page-row:only-child\)\s*\{\s*grid-template-columns: minmax\(0, 1fr\);/);
    expect(styles).toMatch(/&__form--modal\s*\{[^}]*container: config-panel \/ inline-size;/);
    expect(styles).toMatch(/@container config-panel \(max-width: 520px\)\s*\{\s*&__connection-section &__connection-row \{ grid-template-columns: minmax\(0, 1fr\); \}\s*&__endpoint-inputs \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  });

  it('uses the shared overflow surface for models.dev cache metadata', () => {
    expect(source).toContain("<code><OverflowText>{modelsDevStatus?.cache_path || '—'}</OverflowText></code>");
    expect(source).not.toContain('title={modelsDevStatus?.cache_path}');
    expect(source).toContain("<OverflowText>{modelsDevStatus?.revision || '—'}</OverflowText>");
    expect(source).not.toContain('title={modelsDevStatus?.revision}');
    expect(source).not.toContain('modelsDevStatus.revision.slice(');
  });

  it('lets advanced mode actions align to the right edge of their rows', () => {
    expect(styles).toMatch(
      /&__custom-headers-row,\s*&__custom-request-body-row\s*\{\s*> \.bitfun-config-page-row__meta\s*\{\s*width: 100%;\s*max-width: none;/,
    );
    expect(styles).toMatch(/&__inline-header-actions\s*\{[\s\S]*?margin-left: auto;/);
  });

  it('keeps subscription actions right-aligned through the shared compact breakpoint', () => {
    expect(styles).toMatch(
      /@container config-panel \(max-width: 520px\)\s*\{\s*&__cli-account\.bitfun-config-page-row\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*?gap: var\(--bitfun-space-4\);[\s\S]*?justify-content: flex-end;/,
    );
    expect(styles).toMatch(
      /@container config-panel \(max-width: 360px\)\s*\{\s*&__cli-account\.bitfun-config-page-row\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?gap: var\(--bitfun-space-2\);[\s\S]*?justify-content: flex-start;/,
    );
  });
});
