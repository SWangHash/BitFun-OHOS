import { afterEach, describe, expect, it } from 'vitest';
import { storage } from '@/shared/utils/storageAdapter';
import {
  loadPanelRatio,
  panelRatioFromWidth,
  panelRatioReferenceWidth,
  panelWidthFromRatio,
  savePanelRatio,
  STORAGE_KEYS,
} from './panelConfig';

describe('right panel proportional sizing', () => {
  afterEach(() => {
    storage.removeItem(STORAGE_KEYS.RIGHT_PANEL_RATIO);
  });

  it('preserves the user split ratio across window resizing', () => {
    const ratio = panelRatioFromWidth(400, 1000);

    expect(ratio).toBe(0.4);
    expect(panelWidthFromRatio(ratio!, 2000)).toBe(800);
    expect(panelWidthFromRatio(ratio!, 1000)).toBe(400);
  });

  it('uses the full viewport as the ratio reference and the panel container only as fallback', () => {
    expect(panelRatioReferenceWidth(1000, 700)).toBe(1000);
    expect(panelRatioReferenceWidth(0, 700)).toBe(700);
    expect(panelRatioReferenceWidth(0, 0)).toBeNull();
  });

  it('round-trips valid ratios and ignores invalid persisted values', () => {
    savePanelRatio(STORAGE_KEYS.RIGHT_PANEL_RATIO, 0.4);
    expect(loadPanelRatio(STORAGE_KEYS.RIGHT_PANEL_RATIO)).toBe(0.4);

    storage.setItem(STORAGE_KEYS.RIGHT_PANEL_RATIO, 'not-a-ratio');
    expect(loadPanelRatio(STORAGE_KEYS.RIGHT_PANEL_RATIO)).toBeNull();
  });

  it('rejects invalid geometry instead of inventing a ratio', () => {
    expect(panelRatioFromWidth(400, 0)).toBeNull();
    expect(panelWidthFromRatio(0, 1000)).toBeNull();
    expect(panelWidthFromRatio(1.1, 1000)).toBeNull();
  });
});
