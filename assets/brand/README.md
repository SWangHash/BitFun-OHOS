# BitFun application brand assets

`source/bitfun-mark.svg` is the transparent vector master for the current Logo
used by startup and in-product brand surfaces. It carries the diagonal mark of
the HarmonyOS application icon as four filled subpaths in a 120-unit viewBox,
and it matches the About dialog's static geometry. Motion and moving highlights
are intentionally absent from static files. The SVG fills with `black`; the
generator rewrites that to `currentColor` for the reusable web asset, so each
surface tints it itself.

The generator also maintains the existing transparent PNG paths:

- `bitfun-mark-dark.png` is the dark mark for light surfaces.
- `bitfun-mark-light.png` is the light mark for dark surfaces.

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

The HarmonyOS PC (2in1) launch page uses a single neutral appearance so it can
never flip between color modes: the generator writes one light mark into the
ohos `entry` `base/media` directory, and `start_window_background` is pinned to
`#6A6A6A` in both `base/` and `dark/` (a neutral that sits between the app's
light and dark chrome surfaces). The AbilityMgr-drawn system start window, the
ArkUI splash mirror (`oh-rs-ability/.../DefaultXComponent.ets`), and the web-ui
startup overlay (`src/web-ui/index.html`, `.splash-screen--ohos-brand`) all
render the same constant, so the cold-start handoff never flashes. The previous
`bitfun_icon_light.png` is a retired legacy asset and is removed by the
generator.

Run `pnpm run generate-brand-assets` after changing either source master. The
generator is the single owner of the derived desktop, web, HarmonyOS, and market
files.

Verify generated dimensions, small-size mark readability, favicon references,
and icon containers with `node --test scripts/generate-brand-assets.test.mjs`.

## Frozen icon targets

The installer, Android launcher, and iOS App Store icons are already-released
artifacts and deliberately keep their previous artwork:

- `BitFun-Installer/src-tauri/icons/bitfun-app-icon.{png,ico,icns}`
- `BitFun-Installer/src/assets/bitfun-app-icon{,-16,-32}.png`
- `src/apps/mobile/android/app/src/main/res/mipmap-*/ic_launcher*.png`
- `src/apps/mobile/ios/BitFun/Resources.xcassets/AppIcon.appiconset/bitfun-app-icon.png`

The generator must not write any of them; it only refreshes their in-product
marks. To migrate one of these targets, add it back to
`scripts/generate-brand-assets.mjs` and drop it from the digest guard in
`scripts/generate-brand-assets.test.mjs`.

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
