# Fangling (芳翎)

![Idle, wave, and pointer-look preview](preview.gif)

Fangling is an original chibi adaptation of the OpenBitFun Girl character, with a
small, softly oval face, a compact black-and-ivory bell skirt, and tiny legs with
rounded shoes. Her name pairs the sound "fang" from Bifang with feather imagery.
Silver hair and OpenBitFun ornaments preserve the character's identity: both the
outer outline and the inner opening of each logo are rounded six-sided hexagons.
The artwork was created with AI image generation from the character illustration,
the official brand mark, and the requested short-legged proportions.

The built-in picker lists this pet immediately after the default blue-golden
cat. Fangling keeps the `openbitfun-girl` package ID and paths so saved selections
continue to work after the display-name change. The earlier OpenBitFun Bifang
mascot remains a separate preset.

## Sprite contract

- `spriteVersionNumber: 2`; lossless WebP with transparency.
- Atlas: 1536 × 2288 pixels, 8 columns × 11 rows, 192 × 208 pixels per cell.
- Rows 0–8: idle, running-right, running-left, waving, jumping, failed, waiting,
  working (`running`), and review. Frame counts: 6, 8, 8, 4, 5, 8, 6, 6, 6.
- Rows 9–10: 16 look directions clockwise from up in 22.5-degree steps.
- The asymmetric hair ornament stays on the character's left; leftward and
  rightward running were authored separately.

The package uses the existing shared pet renderer and adds no host command,
protocol change, or configuration migration. `pet.json` can also be used to
import the package as a v2 pet.
