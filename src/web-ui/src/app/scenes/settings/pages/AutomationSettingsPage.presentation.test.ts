import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8',
  );
}

describe('AutomationSettingsPage structure', () => {
  it('keeps quick actions and Hooks in one continuous page without tabs', () => {
    const source = readSource('./tools/AutomationSettingsPage.tsx');
    const quickActionsIndex = source.indexOf('<QuickActionsSettingsSection />');
    const hooksIndex = source.indexOf('<HooksSettingsSection />');

    expect(quickActionsIndex).toBeGreaterThan(-1);
    expect(hooksIndex).toBeGreaterThan(quickActionsIndex);
    expect(source).not.toContain('SettingsViewPage');
    expect(source).not.toContain('<Tabs');
    expect(source).not.toContain('<TabPane');
  });

  it('separates quick actions and Hooks with whitespace instead of a divider', () => {
    const source = readSource('./tools/AutomationSettingsPage.tsx');

    expect(source).toContain('data-bitfun-part="quickActions"');
    expect(source).toContain('data-bitfun-part="hooks"');
    expect(source).not.toMatch(/<Divider\b/);
    expect(source).not.toContain('border-top');
  });
});
