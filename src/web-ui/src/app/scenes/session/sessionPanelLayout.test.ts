import { describe, expect, it } from 'vitest';

import { PANEL_COMMON_CONFIG, RIGHT_PANEL_CONFIG } from '../../layout/panelConfig';
import { clampRightPanelPreferredWidth, fitRightPanelWidth } from './sessionPanelLayout';

/** Scene box that leaves exactly `panelWidth` for the right panel. */
const sceneWidthFor = (panelWidth: number): number =>
  panelWidth + PANEL_COMMON_CONFIG.RESIZER_WIDTH + PANEL_COMMON_CONFIG.MIN_CENTER_WIDTH;

describe('right panel width fitting', () => {
  it('keeps a remembered width the scene box can hold', () => {
    expect(fitRightPanelWidth(642, sceneWidthFor(800))).toBe(642);
  });

  it('narrows a wide remembered width into a smaller restored window', () => {
    expect(fitRightPanelWidth(1200, sceneWidthFor(420))).toBe(420);
  });

  it('re-derives the remembered width when the scene box grows again', () => {
    // A maximize/restore cycle must not turn the fitted width into the preference.
    expect(fitRightPanelWidth(642, sceneWidthFor(250))).toBe(250);
    expect(fitRightPanelWidth(642, sceneWidthFor(900))).toBe(642);
  });

  it('never fits below the compact width while the scene box can hold one', () => {
    expect(fitRightPanelWidth(642, sceneWidthFor(RIGHT_PANEL_CONFIG.COMPACT_WIDTH))).toBe(
      RIGHT_PANEL_CONFIG.COMPACT_WIDTH,
    );
  });

  it('keeps the remembered width while the scene box is not laid out yet', () => {
    expect(fitRightPanelWidth(642, 0)).toBe(642);
    expect(fitRightPanelWidth(642, Number.NaN)).toBe(642);
  });

  it('clamps the remembered width to the configurable range', () => {
    expect(clampRightPanelPreferredWidth(120)).toBe(RIGHT_PANEL_CONFIG.COMPACT_WIDTH);
    expect(clampRightPanelPreferredWidth(4000)).toBe(RIGHT_PANEL_CONFIG.MAX_WIDTH);
    expect(clampRightPanelPreferredWidth(Number.NaN)).toBe(RIGHT_PANEL_CONFIG.COMFORTABLE_DEFAULT);
  });
});
