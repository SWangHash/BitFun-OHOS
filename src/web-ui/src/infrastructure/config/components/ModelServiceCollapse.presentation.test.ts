import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const modelSettingsSource = readFileSync(
  fileURLToPath(new URL('./ModelSettingsPage.tsx', import.meta.url)),
  'utf8',
).replaceAll('\r\n', '\n');
const cardActions = readFileSync(fileURLToPath(new URL('./ModelPoolCardActions.tsx', import.meta.url)), 'utf8');
const defaultModelSource = readFileSync(
  fileURLToPath(new URL('./DefaultModelConfig.tsx', import.meta.url)),
  'utf8',
);

describe('model service collapsed presentation', () => {
  it('presents configured models directly with search, provider, and capability filters', () => {
    expect(modelSettingsSource).toContain('value={libraryQuery}');
    expect(modelSettingsSource).toContain('value={libraryProvider}');
    expect(modelSettingsSource).toContain('value={libraryCapability}');
    expect(modelSettingsSource).toContain("visibleLibraryModels.map(config => renderModelCollectionItem(config, 'card'))");
    expect(modelSettingsSource).toContain('group.models.map(config => renderModelCollectionItem(config))');
  });

  it('marks the primary model slot as required in both label and control semantics', () => {
    expect(defaultModelSource).toMatch(
      /label=\{renderSlotLabel\(t\('core\.primary\.label'\)[\s\S]*?multiline=\{compact\}[\s\S]*?required[\s\S]*?<Combobox[\s\S]*?aria-required="true"/,
    );
  });

  it('keeps the enable switch at the trailing edge and reveals secondary model actions on interaction', () => {
    expect(cardActions).toContain('className="bitfun-model-settings__pool-card-controls"');
    expect(cardActions).toContain('data-bitfun-part="modelActions"');
    expect(cardActions.indexOf('<MenuPopover')).toBeLessThan(cardActions.indexOf('<Switch'));
    expect(modelSettingsSource).toContain('<ModelPoolCardActions');
  });

  it('keeps model connection test progress and results visible without hover or expansion', () => {
    const badgeStart = modelSettingsSource.indexOf('const badge = (');
    const detailsStart = modelSettingsSource.indexOf('const roles = ', badgeStart);
    const badgeSource = modelSettingsSource.slice(badgeStart, detailsStart);

    expect(badgeSource).toContain('{(isTesting || testResult) && (');
    expect(badgeSource).toContain('bitfun-model-settings__status-dot');
    expect(badgeSource).not.toContain('<StatusPill');
    expect(badgeSource).toContain('role="status"');
    expect(badgeSource).toContain('aria-live="polite"');
    expect(badgeSource).toContain('aria-label={testStatusLabel}');
    expect(badgeSource).toContain("isTesting ? 'is-testing' : testResult?.success ? 'is-success' : 'is-error'");
    expect(modelSettingsSource).toContain(
      "isTesting\n      ? t('messages.testing')\n      : testResult?.message.split('\\n', 1)[0]",
    );
  });

});
