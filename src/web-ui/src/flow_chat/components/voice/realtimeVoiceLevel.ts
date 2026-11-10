const BIN_COUNT = 128;

/**
 * Expand a client-side provider's single loudness value into the particle
 * meter's byte bins.
 *
 * The HarmonyOS system recognizer reports one RMS level (0-255) per frame and
 * exposes no FFT, so the bins fall off towards the high end instead of
 * pretending to carry spectral detail. Provider-hosted sessions keep reading
 * real FFT data and never use this helper.
 */
export function systemVoiceBins(level: number): Uint8Array {
  const bins = new Uint8Array(BIN_COUNT);
  if (!Number.isFinite(level)) return bins;
  const clamped = Math.max(0, Math.min(255, Math.round(level)));
  for (let index = 0; index < bins.length; index += 1) {
    bins[index] = Math.max(0, Math.round(clamped * (1 - index / (bins.length * 2))));
  }
  return bins;
}
