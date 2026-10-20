import { describe, it, expect, afterEach } from '@ohos/hypium';
import { MobileDesignTypography, MobileTextScale } from '../main/ets/generated/MobileDesignTokens';

export default function textScaleUnitTest() {
  describe('Mobile text scale', () => {
    afterEach(() => {
      MobileTextScale.reset();
    });

    it('leaves the iPhone Pro class reference unscaled', 0, () => {
      // 460 ppi at 3x is the ramp's reference; anything denser per unit caps at 1.
      expect(MobileTextScale.resolve(460, 3)).assertEqual(1);
      expect(MobileTextScale.resolve(489, 3)).assertEqual(1);
    });

    it('shrinks text on a screen whose logical unit is physically larger', 0, () => {
      // HUAWEI Mate X7 outer screen: 415.6 xDPI at density 3.125.
      expect(MobileTextScale.resolve(415.636, 3.125)).assertEqual(0.868);
    });

    it('never drops below the floor', 0, () => {
      expect(MobileTextScale.resolve(300, 3)).assertEqual(0.85);
    });

    it('ignores implausible or missing metrics', 0, () => {
      expect(MobileTextScale.resolve(0, 3)).assertEqual(1);
      expect(MobileTextScale.resolve(96, 3)).assertEqual(1);
      expect(MobileTextScale.resolve(2000, 3)).assertEqual(1);
      expect(MobileTextScale.resolve(415, 0)).assertEqual(1);
    });

    it('scales the typography ramp to half units once applied', 0, () => {
      expect(MobileDesignTypography.bodyLarge.size).assertEqual(16);
      expect(MobileDesignTypography.bodyLarge.lineHeight).assertEqual(24);
      MobileTextScale.apply(415.636, 3.125);
      expect(MobileTextScale.factor).assertEqual(0.868);
      expect(MobileDesignTypography.bodyLarge.size).assertEqual(14);
      expect(MobileDesignTypography.bodyLarge.lineHeight).assertEqual(21);
      expect(MobileDesignTypography.titleMedium.size).assertEqual(15);
      expect(MobileDesignTypography.labelSmall.size).assertEqual(10.5);
      expect(MobileDesignTypography.bodyLarge.baseSize).assertEqual(16);
    });
  });
}
