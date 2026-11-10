import { describe, expect, it } from 'vitest';
import { systemVoiceBins } from './realtimeVoiceLevel';

describe('systemVoiceBins', () => {
  it('keeps a silent frame at zero so the meter stays idle', () => {
    expect(Array.from(systemVoiceBins(0))).toEqual(new Array(128).fill(0));
  });

  it('clamps the reported level to the byte range', () => {
    const loud = systemVoiceBins(400);
    const quiet = systemVoiceBins(255);
    expect(loud[0]).toBe(255);
    expect(Array.from(loud)).toEqual(Array.from(quiet));
  });

  it('falls off towards the high bins while staying audible', () => {
    const bins = systemVoiceBins(200);
    expect(bins.length).toBe(128);
    expect(bins[0]).toBe(200);
    expect(bins[64]).toBeGreaterThan(0);
    expect(bins[64]).toBeLessThan(bins[0]);
    expect(bins[127]).toBeLessThan(bins[64]);
  });

  it('treats a non-finite level as silence instead of emitting NaN bytes', () => {
    expect(Array.from(systemVoiceBins(Number.NaN))).toEqual(new Array(128).fill(0));
  });
});
