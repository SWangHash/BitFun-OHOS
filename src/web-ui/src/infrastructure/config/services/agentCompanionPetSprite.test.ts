import { describe, expect, it } from 'vitest';
import { getPetAnimationFrameCount, getPetLookDirection, getPetLookFrame, getPetSpriteFrameSize, getPetSpriteLayout } from './agentCompanionPetSprite';

describe('Petdex version compatibility', () => {
  it('keeps legacy atlases and v2 cells the same size', () => {
    expect(getPetSpriteLayout(undefined).rows).toBe(9);
    expect(getPetSpriteFrameSize(1536, 1872)).toEqual({ width: 192, height: 208 });
    expect(getPetSpriteFrameSize(1536, 2288, 2)).toEqual({ width: 192, height: 208 });
    expect(getPetSpriteFrameSize(768, 1144, 2)).toEqual({ width: 96, height: 104 });
    expect(() => getPetSpriteFrameSize(1536, 2288, 1)).toThrow('dimensions');
    expect(() => getPetSpriteLayout(3)).toThrow('Unsupported');
  });

  it('uses only populated animation cells', () => {
    expect(Array.from({ length: 9 }, (_, row) => getPetAnimationFrameCount(row)))
      .toEqual([6, 8, 8, 4, 5, 8, 6, 6, 6]);
    expect(() => getPetAnimationFrameCount(9)).toThrow();
  });

  it('maps all 16 clockwise directions to the final two v2 rows', () => {
    for (let direction = 0; direction < 16; direction += 1) {
      const angle = direction * Math.PI / 8;
      const resolved = getPetLookDirection(100 * Math.sin(angle), -100 * Math.cos(angle));
      expect(resolved).toBe(direction);
      expect(getPetLookFrame(2, resolved)).toEqual({ row: 9 + Math.floor(direction / 8), column: direction % 8 });
      expect(getPetLookFrame(1, resolved)).toBeNull();
      expect(getPetLookFrame(undefined, resolved)).toBeNull();
    }
    expect(getPetLookDirection(0, 0)).toBeNull();
    expect(getPetLookDirection(NaN, 10)).toBeNull();
    expect(getPetLookFrame(2, 16)).toBeNull();
  });
});
