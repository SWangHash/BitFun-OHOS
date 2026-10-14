# BitFun application brand assets

`source/bitfun-mark.svg` is the transparent vector master for the current Logo
used by startup and in-product brand surfaces. It carries the diagonal mark of
the HarmonyOS application icon as four filled subpaths in a 120-unit viewBox,
and it matches the application icon silhouette. Motion and moving highlights
are intentionally absent from static files. The SVG fills with `black`; the
generator rewrites that to `currentColor` for the reusable web asset, so each
surface tints it itself.

The generator also maintains the existing transparent PNG paths:

- `bitfun-mark-dark.png` is the dark mark for light surfaces.
- `bitfun-mark-light.png` is the light mark for dark surfaces.

The desktop About dialog follows the same split: it shows the application icon
badge on light surfaces, where the black plate reads as a badge, and switches to
the transparent light mark on dark surfaces, where that plate would be
indistinguishable from the raised dialog background. The mark occupies the same
bounding box in both files, so the swap does not resize the artwork.

`source/bitfun-app-mark.png` is the silver rasterization of the same diagonal
silhouette on a transparent background. Desktop, window, taskbar, Dock, tray,
browser, HarmonyOS, and market-email icons use this artwork on the black
rounded-square background with transparent corners. It stays a separate source
from the vector master, so regenerating either family cannot replace the other.

`exports/` contains the SVG, ICO, ICNS, and PNGs at 16, 24, 32, 48, 64, 96,
128, 192, 256, 512, 1024, and 2048 px. Each PNG size includes a dark transparent
mark, a light transparent mark, and the application icon. The mark is a filled
silhouette, so every size renders from the same geometry without per-size stroke
treatments. Application icons are resized from the preserved application artwork.
Windows ICO frames, Linux icons, and macOS PNG representations use the matching
size-specific application exports. Tauri encodes the legacy 16/32 px ICNS
representations from the same artwork.

Browser entry points select explicit 16/32 px favicons. The system tray reuses
the configured application/window icon on every desktop platform.

The HarmonyOS PC (2in1) launch page uses a single launch appearance so it can
never flip between color modes: the generator writes one light mark into the
ohos `entry` `base/media` directory, and `start_window_background` is pinned to
`#000000` in both `base/` and `dark/`. The AbilityMgr-drawn system start window,
the ArkUI splash mirror (`oh-rs-ability/.../DefaultXComponent.ets`), and the
web-ui startup overlay (`src/web-ui/index.html`, the shared `.splash-screen`
canvas) all render the same constant, so the cold-start handoff never flashes.
The previous `bitfun_icon_light.png` is a retired legacy asset and is removed by
the generator.

Run `pnpm run generate-brand-assets` after changing either source master. The
generator is the single owner of the derived desktop, mobile, installer, web,
HarmonyOS, and market files.

Verify generated dimensions, small-size mark readability, favicon references,
and icon containers with `node --test scripts/generate-brand-assets.test.mjs`.

## Per-product icon targets

Every shipped product surface renders the same application artwork, so the
generator owns all of their launcher, container, and site icons:

- `BitFun-Installer/src-tauri/icons/bitfun-app-icon.{png,ico,icns}` and
  `BitFun-Installer/src/assets/bitfun-app-icon{,-16,-32}.png`
- `src/apps/data-migrator/icons/bitfun-app-icon.{png,ico,icns}`
- `src/apps/mobile/android/app/src/main/res/mipmap-*/ic_launcher*.png`
- `src/apps/mobile/ios/BitFun/Resources.xcassets/AppIcon.appiconset/bitfun-app-icon.png`
- `src/miniapp-market-web/public/{favicon.svg,favicon.ico,icon-192.png,icon-512.png,apple-touch-icon.png}`
  and `src/miniapp-market-web/public/assets/bitfun-favicon-{16,32}.png`

Two platform rules shape those outputs:

- The App Store icon is a flat opaque plate. iOS masks the corners itself, so
  the transparent corners of the application icon are filled with the plate
  color instead of shipping alpha, and the file stays a 1024 px RGB PNG.
- Android ships both icon families. The adaptive icon (`minSdk` 26, so this is
  what a home screen draws) keeps the field and the mark in separate layers, and
  the mark artboard is drawn at 60% of the 108 dp canvas so the launcher mask
  cannot cut it. `ic_launcher_foreground.png` and `ic_launcher_monochrome.png`
  are the same white silhouette; the legacy `ic_launcher.png` and
  `ic_launcher_round.png` beside them reuse the application icon.

`scripts/generate-brand-assets.test.mjs` verifies the outputs against `exports/`,
and checks the platform rules directly for the two icons that have no export:
the App Store plate stays an alpha-free 1024 px RGB PNG, and the Android
adaptive mark stays inside its safe area at every density. A hand-edited icon
therefore fails loudly instead of silently changing a shipped surface. Add a new
target to `scripts/generate-brand-assets.mjs` and to that test together.

Hand-authored marketing artwork — `png/*.png`, `png/*.jpg`,
`src/apps/desktop/dmg/background.png`, and `src/miniapp-market-web/public/og.png`
— is composed outside this repository's generators and is not refreshed by
`pnpm run generate-brand-assets`.

`source/release-letter-mascot.svg` preserves the authored character from
`bitfun-letter.html`. Its named body, rigid head/rod, and eye parts are used
by the release letter's connected animation rig. The gradients belong to this
illustration, not to the application theme. Vite bundles this source directly;
it is independent of the application icon generator and needs no PNG export.

Verification emails use the silver application mark on its black rounded-square
background, generated at
`src/miniapp-market-web/public/assets/bitfun-email-app-icon.png`. The market build
publishes this stable anonymous image path for email clients; it contains no
recipient or verification data and does not require authentication.

The previous email mark URL remains available for already-sent messages.
