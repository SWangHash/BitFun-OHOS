/** Codex Petdex keeps the first nine animation rows stable across v1 and v2. */
const ANIMATION_FRAMES = [6, 8, 8, 4, 5, 8, 6, 6, 6] as const;

export function getPetSpriteLayout(version: number | null | undefined) {
  const resolvedVersion = version ?? 1;
  if (resolvedVersion !== 1 && resolvedVersion !== 2) {
    throw new Error(`Unsupported pet sprite version: ${resolvedVersion}`);
  }
  return {
    version: resolvedVersion,
    columns: 8,
    rows: resolvedVersion === 2 ? 11 : 9,
    supportsLook: resolvedVersion === 2,
  };
}

export function getPetSpriteFrameSize(width: number, height: number, version?: number | null) {
  const layout = getPetSpriteLayout(version);
  // Retain support for uniformly scaled atlases without rounding across cell boundaries.
  if (width <= 0 || height <= 0 || width % layout.columns || height % layout.rows) {
    throw new Error(`Invalid pet spritesheet dimensions: ${width}x${height} for v${layout.version}`);
  }
  return { width: width / layout.columns, height: height / layout.rows };
}

export function getPetAnimationFrameCount(row: number): number {
  const frames = ANIMATION_FRAMES[row];
  if (frames === undefined) throw new Error(`Invalid pet animation row: ${row}`);
  return frames;
}

/** Clockwise from north in 22.5 degree steps; coordinates are in the pet window's CSS pixels. */
export function getPetLookDirection(x: number, y: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) <= 1) return null;
  const angle = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
  return Math.round(angle / 22.5) % 16;
}

export function getPetLookFrame(version: number | null | undefined, direction: number | null | undefined) {
  if (!getPetSpriteLayout(version).supportsLook || direction == null
    || !Number.isInteger(direction) || direction < 0 || direction >= 16) return null;
  return { row: 9 + Math.floor(direction / 8), column: direction % 8 };
}
