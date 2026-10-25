import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8',
  ).replace(/\r\n/g, '\n');
}

/**
 * The Hello launcher is a fixed, always-on control flush in the window's
 * bottom-right corner and ranks above every overlay. This panel docks against
 * that same corner, so its floating controls must stay outside the launcher
 * footprint; otherwise a click on them opens the launcher instead.
 */
describe('BTW session panel clearance around the Hello launcher', () => {
  it('keeps the launcher anchored in the bottom-right corner with a block-size footprint', () => {
    const launcherStylesheet = readSource('../../../app/layout/FloatingMiniChat.scss');

    expect(launcherStylesheet).toContain('position: fixed;');
    expect(launcherStylesheet).toContain('right: 0;');
    expect(launcherStylesheet).toContain('bottom: 0;');
    expect(launcherStylesheet).toContain(
      'inline-size: var(--bitfun-control-launcher-button-block-size);',
    );
  });

  it('lifts the panel scroll-to-bottom control out of the launcher footprint', () => {
    const panelStylesheet = readSource('./BtwSessionPanel.scss');

    expect(panelStylesheet).toContain(
      '$hello-launcher-corner-clearance: calc(\n  var(--bitfun-control-launcher-button-block-size) + var(--bitfun-space-2)\n);',
    );
    expect(panelStylesheet).toContain(
      '&__scroll-to-bottom {\n    bottom: calc(18px + #{$hello-launcher-corner-clearance});',
    );
  });

  it('insets the action row that is right-aligned inside the same corner', () => {
    const panelStylesheet = readSource('./BtwSessionPanel.scss');

    expect(panelStylesheet).toContain(
      '&__action-bar-wrapper .deep-review-action-bar__actions {\n    padding-inline-end: #{$hello-launcher-corner-clearance};',
    );
  });
});
