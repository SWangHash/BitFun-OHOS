import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
    .replace(/\r\n?/g, '\n');
}

const stylesheet = readSource('./NavPanel.scss');

/** Body of the flat top-level rule for a navigation menu surface. */
function ruleBody(className: string): string {
  const match = stylesheet.match(
    new RegExp(`\\n[ \\t]*\\.${className} \\{\\n([\\s\\S]*?)\\n[ \\t]*\\}`),
  );
  return match?.[1] ?? '';
}

// These surfaces portal into the viewport-sized overlay host and are placed from
// the anchor rectangle they measure, so product CSS must take the Menu root out
// of flow. A static Menu root ignores its inline left/top and lays out at the
// corner of the overlay layer, which is the top-left corner of the window.
const PORTALLED_NAV_MENUS = [
  'bitfun-nav-panel__footer-menu',
  'bitfun-nav-panel__appearance-submenu',
];

describe.each(PORTALLED_NAV_MENUS)('%s', (className) => {
  it('is taken out of flow so its measured anchor coordinates apply', () => {
    expect(ruleBody(className)).toMatch(/position:\s*fixed;/);
  });
});

describe('theme submenu portal', () => {
  const source = readSource('./components/AppearanceQuickSwitchMenuItem.tsx');

  it('escapes to the overlay host and measures viewport coordinates', () => {
    expect(source).toContain('createOverlayPortal');
    expect(source).toContain('getAppearanceOverlayHost');
    expect(source).toContain('getBoundingClientRect');
  });
});
