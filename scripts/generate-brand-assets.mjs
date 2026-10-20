import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { COMPOSER_ICON, readMacosFallback } from './macos-icon-assets.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const SOURCE_DIR = path.join(ROOT_DIR, 'assets', 'brand', 'source');
const SOURCE_SVG = path.join(SOURCE_DIR, 'bitfun-mark.svg');
const SOURCE_APP_MARK = path.join(SOURCE_DIR, 'bitfun-app-mark.png');
const SOURCE_MARKS = {
  dark: path.join(SOURCE_DIR, 'bitfun-mark-dark.png'),
  light: path.join(SOURCE_DIR, 'bitfun-mark-light.png'),
};

const BRAND_SIZE = 512;
const APP_ICON_SIZE = 1024;
const APP_ICON_CORNER_RADIUS = 96;
const APP_MARK_LIFT = 28;
const MARK_TONE_DARK = '#202020';
const MARK_TONE_LIGHT = '#e8e8e8';
// HarmonyOS draws the simple launch-page icon (`startWindowIcon`) at its raw
// pixel size, so the PC start-window mark is authored at the pixel size that
// matches the in-app web-ui splash (120vp) on a 2x-density 2in1 display.
const OHOS_START_WINDOW_SIZE = 240;

const DESKTOP_HICOLOR_SIZES = [16, 32, 48, 64, 96, 128, 256, 512];
const EXPORT_SIZES = [16, 24, 32, 48, 64, 96, 128, 192, 256, 512, 1024, 2048];
// Every browser entry point in the workspace pins the same two favicon sizes.
const FAVICON_SIZES = [16, 32];

// Android launcher artwork. Each density ships the legacy bitmap beside the
// adaptive icon; the adaptive canvas is 108dp and its mark must stay inside the
// safe area, so the mark artboard is drawn at 60% of that canvas.
const ANDROID_LAUNCHER_SIZES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const ANDROID_ADAPTIVE_CANVAS_DP = 108;
const ANDROID_LEGACY_ICON_DP = 48;
const ANDROID_ADAPTIVE_MARK_RATIO = 0.6;

// The Mini App Market serves its own site icons from the same application
// artwork so the storefront and the desktop app never diverge.
const MARKET_TOUCH_ICON_SIZE = 180;

const LEGACY_APPLICATION_ASSETS = [
  'src/apps/desktop/icons/Logo-ICON.png',
  'src/apps/desktop/icons/icon.png',
  'src/apps/desktop/icons/icon.ico',
  'src/apps/desktop/icons/icon.icns',
  'src/apps/desktop/icons/bitfun-tray-template.png',
  'src/apps/desktop/icons/Square30x30Logo.png',
  'src/apps/desktop/icons/Square44x44Logo.png',
  'src/apps/desktop/icons/Square71x71Logo.png',
  'src/apps/desktop/icons/Square89x89Logo.png',
  'src/apps/desktop/icons/Square107x107Logo.png',
  'src/apps/desktop/icons/Square142x142Logo.png',
  'src/apps/desktop/icons/Square150x150Logo.png',
  'src/apps/desktop/icons/Square284x284Logo.png',
  'src/apps/desktop/icons/Square310x310Logo.png',
  'src/apps/desktop/icons/StoreLogo.png',
  'src/web-ui/public/Logo-ICON.png',
  'src/web-ui/public/Logo-ICON-128.png',
  'src/web-ui/public/BitFun-Logo.png',
  'src/mobile-web/src/assets/Logo-ICON.png',
  'BitFun-Installer/src/Logo-ICON.png',
  'BitFun-Installer/src-tauri/icons/icon.png',
  'BitFun-Installer/src-tauri/icons/icon.ico',
  'BitFun-Installer/src-tauri/icons/icon.icns',
  'src/apps/mobile/harmonyos/AppScope/resources/base/media/bitfun_icon.png',
  'src/apps/mobile/harmonyos/AppScope/resources/base/media/bitfun-app-icon.png',
  'src/apps/mobile/harmonyos/AppScope/resources/base/media/background.png',
  'src/apps/mobile/harmonyos/AppScope/resources/base/media/foreground.png',
  'src/apps/mobile/harmonyos/AppScope/resources/base/media/layered_image.json',
  'src/apps/mobile/harmonyos/entry/src/main/resources/base/media/bitfun_icon.png',
  'src/apps/mobile/harmonyos/entry/src/main/resources/base/media/bitfun-app-icon.png',
  'src/apps/mobile/harmonyos/entry/src/main/resources/base/media/bitfun-start-window.png',
  'src/apps/mobile/harmonyos/entry/src/main/resources/base/media/background.png',
  'src/apps/mobile/harmonyos/entry/src/main/resources/base/media/foreground.png',
  'src/apps/mobile/harmonyos/entry/src/main/resources/base/media/layered_image.json',
  'src/apps/mobile/harmonyos/entry/src/main/resources/base/media/startIcon.png',
  'src/apps/mobile/ios/BitFun/Resources.xcassets/AppIcon.appiconset/bitfun_icon.png',
  'src/apps/mobile/ios/BitFun/Resources.xcassets/BitFunLogo.imageset',
  'src/apps/relay-server/static/assets/Logo-ICON-BOaKcXgO.png',
  // Superseded by the shared start-window mark below; the HarmonyOS PC launch
  // page now reuses the same logo as the in-app splash.
  'src/apps/ohos/entry/src/main/resources/base/media/bitfun_icon_light.png',
];

const outputPath = (...segments) => path.join(ROOT_DIR, ...segments);

async function writePng(filePath, buffer) {
  await mkdir(path.dirname(filePath), { recursive: true });
  // Atomic replacement avoids drvfs/9P `EINVAL` when overwriting a file that
  // Windows still has open (preview, indexer, or a previous build's handle).
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, buffer);
  await rename(tmpPath, filePath);
}

function createReusableWebMark(svg) {
  const reusableMark = svg.replaceAll('fill="black"', 'fill="currentColor"');
  if (reusableMark === svg) {
    throw new Error('BitFun mark source is missing its canonical black fill');
  }
  return reusableMark;
}

async function normalizePng(input) {
  return sharp(input)
    .ensureAlpha()
    .resize({ width: BRAND_SIZE, height: BRAND_SIZE, fit: 'contain', kernel: 'lanczos3' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function renderMark(svg, size, tone) {
  // The mark is a filled silhouette, so every size renders from the same
  // geometry: there are no subpixel filaments to thin out optically.
  const artwork = createReusableWebMark(svg).replaceAll('currentColor', tone);
  return sharp(Buffer.from(artwork), { density: 144 })
    .resize(size, size)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function resizePng(input, size) {
  return sharp(input)
    .resize({ width: size, height: size, fit: 'contain', kernel: 'lanczos3' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

// Centers the mark artboard on a square transparent canvas. Both sizes are kept
// even so the placement never falls on a half pixel.
async function renderCenteredMark(svg, canvasSize, markSize, tone) {
  const offset = (canvasSize - markSize) / 2;
  if (!Number.isInteger(offset)) {
    throw new Error(`Mark ${markSize} cannot be centered on a ${canvasSize} canvas`);
  }
  return sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: await renderMark(svg, markSize, tone), left: offset, top: offset }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

// Vector twin of the application icon for surfaces that prefer an SVG site
// icon: the same rounded plate and the same mark artboard as the raster export.
function createApplicationIconSvg(svg, size) {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
  if (!viewBox) {
    throw new Error('BitFun mark source is missing its viewBox');
  }
  const inner = createReusableWebMark(svg)
    .replaceAll('currentColor', MARK_TONE_LIGHT)
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="BitFun">`,
    `<rect width="${size}" height="${size}" rx="${APP_ICON_CORNER_RADIUS}" fill="#000000"/>`,
    `<svg x="0" y="0" width="${size}" height="${size}" viewBox="${viewBox}">${inner}</svg>`,
    '</svg>',
    '',
  ].join(os.EOL);
}

async function createApplicationMark(lightMark) {
  const { data, info } = await sharp(lightMark)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const whiteMark = Buffer.alloc(data.length);

  for (let index = 0; index < data.length; index += channels) {
    const sourceTone = data[index];
    const liftedTone = Math.min(255, sourceTone + APP_MARK_LIFT);
    whiteMark[index] = liftedTone;
    whiteMark[index + 1] = liftedTone;
    whiteMark[index + 2] = liftedTone;
    whiteMark[index + 3] = data[index + 3];
  }

  return sharp(whiteMark, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function createApplicationIcon(applicationMark) {
  const { width: size } = await sharp(applicationMark).metadata();
  const cornerRadius = APP_ICON_CORNER_RADIUS * size / BRAND_SIZE;
  const background = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<rect width="${size}" height="${size}" rx="${cornerRadius}" fill="#000000"/>` +
    '</svg>',
  );

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: background },
      { input: applicationMark },
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function generateWindowsIcon(applicationIcon, renderIcon) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'bitfun-tauri-icons-'));
  const inputPath = path.join(tempDir, 'bitfun-app-icon.png');
  const tauriCliPath = path.join(ROOT_DIR, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  try {
    await writeFile(inputPath, applicationIcon);
    execFileSync(
      process.execPath,
      [tauriCliPath, 'icon', inputPath, '--output', tempDir],
      { cwd: ROOT_DIR, stdio: 'ignore', windowsHide: true },
    );

    // Keep Tauri's directory metadata, but rasterize each Windows size from
    // the canonical application artwork so the container matches the exports.
    const icoTemplate = await readFile(path.join(tempDir, 'icon.ico'));
    const frameCount = icoTemplate.readUInt16LE(4);
    const icoDirectory = Buffer.from(icoTemplate.subarray(0, 6 + frameCount * 16));
    const icoFrames = [];
    let icoOffset = icoDirectory.length;
    for (let index = 0; index < frameCount; index++) {
      const entry = 6 + index * 16;
      const size = icoDirectory[entry] || 256;
      const png = await renderIcon(size);
      icoDirectory.writeUInt32LE(png.length, entry + 8);
      icoDirectory.writeUInt32LE(icoOffset, entry + 12);
      icoFrames.push(png);
      icoOffset += png.length;
    }

    return Buffer.concat([icoDirectory, ...icoFrames]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function removeLegacyApplicationAssets() {
  await Promise.all(
    LEGACY_APPLICATION_ASSETS.map(relativePath =>
      rm(outputPath(...relativePath.split('/')), { recursive: true, force: true })),
  );
}

async function generateBrandAssets() {
  const applicationMark = await createApplicationMark(await normalizePng(SOURCE_APP_MARK));
  await writePng(path.join(COMPOSER_ICON, 'Assets/Mark.png'), await resizePng(applicationMark, APP_ICON_SIZE));
  if (process.argv.includes('--macos-source-only')) return;
  const macosFallback = readMacosFallback();
  const svg = await readFile(SOURCE_SVG, 'utf8');
  const [darkMark, lightMark] = await Promise.all([
    renderMark(svg, BRAND_SIZE, MARK_TONE_DARK),
    renderMark(svg, BRAND_SIZE, MARK_TONE_LIGHT),
  ]);
  await writePng(SOURCE_MARKS.dark, darkMark);
  await writePng(SOURCE_MARKS.light, lightMark);
  const applicationIcon = await createApplicationIcon(applicationMark);
  const applicationIconLarge = await resizePng(applicationIcon, APP_ICON_SIZE);
  const darkMarkSmall = await renderMark(svg, 128, MARK_TONE_DARK);
  const lightMarkSmall = await renderMark(svg, 128, MARK_TONE_LIGHT);
  const iconCache = new Map([
    [BRAND_SIZE, Promise.resolve(applicationIcon)],
    [APP_ICON_SIZE, Promise.resolve(applicationIconLarge)],
  ]);
  const renderIcon = size => {
    if (!iconCache.has(size)) {
      iconCache.set(size, resizePng(applicationIcon, size));
    }
    return iconCache.get(size);
  };
  const windowsIcon = await generateWindowsIcon(applicationIconLarge, renderIcon);

  const exportDir = outputPath('assets', 'brand', 'exports');
  await mkdir(exportDir, { recursive: true });
  await copyFile(SOURCE_SVG, path.join(exportDir, 'bitfun-mark.svg'));
  const componentAssetDir = outputPath('design-system', 'packages', 'ui', 'src', 'brand', 'assets');
  await mkdir(componentAssetDir, { recursive: true });
  // The brand package is the source of truth for the React brand components, so
  // the local masters are projected into it beside the rasterized icon family.
  await copyFile(SOURCE_SVG, path.join(componentAssetDir, 'bitfun-mark.svg'));
  await copyFile(SOURCE_APP_MARK, path.join(componentAssetDir, 'bitfun-app-mark.png'));
  for (const size of [16, 32, 128, 256, 512]) {
    await writePng(path.join(componentAssetDir, `bitfun-app-icon-${size}.png`), await renderIcon(size));
  }
  for (const size of EXPORT_SIZES) {
    const dark = await renderMark(svg, size, MARK_TONE_DARK);
    const light = await renderMark(svg, size, MARK_TONE_LIGHT);
    await writePng(path.join(exportDir, `bitfun-mark-dark-${size}.png`), dark);
    await writePng(path.join(exportDir, `bitfun-mark-light-${size}.png`), light);
    await writePng(
      path.join(exportDir, `bitfun-app-icon-${size}.png`),
      await renderIcon(size),
    );
  }
  await writeFile(path.join(exportDir, 'bitfun-app-icon.ico'), windowsIcon);
  await writeFile(path.join(exportDir, 'bitfun-app-icon.icns'), macosFallback);

  await writePng(outputPath('src', 'miniapp-market-web', 'public', 'assets', 'bitfun-email-mark.png'), darkMarkSmall);

  await writePng(outputPath('src', 'miniapp-market-web', 'public', 'assets', 'bitfun-email-app-icon.png'), applicationIcon);

  await writePng(outputPath('src', 'crates', 'services', 'miniapp-market-service', 'src', 'email', 'app-icon.png'), applicationIcon);

  const webBrandDir = outputPath('src', 'web-ui', 'public', 'brand');
  await writePng(path.join(webBrandDir, 'bitfun-mark-dark.png'), darkMark);
  await writePng(path.join(webBrandDir, 'bitfun-mark-light.png'), lightMark);
  await writePng(path.join(webBrandDir, 'bitfun-mark-dark-128.png'), darkMarkSmall);
  await writePng(path.join(webBrandDir, 'bitfun-mark-light-128.png'), lightMarkSmall);
  await writePng(path.join(webBrandDir, 'bitfun-app-icon.png'), applicationIcon);
  await writeFile(path.join(webBrandDir, 'bitfun-mark.svg'), createReusableWebMark(svg), 'utf8');

  const desktopIconDir = outputPath('src', 'apps', 'desktop', 'icons');
  await writePng(path.join(desktopIconDir, 'bitfun-app-icon.png'), applicationIconLarge);
  await writePng(path.join(desktopIconDir, 'bitfun-app-icon.ico'), windowsIcon);
  await writePng(path.join(desktopIconDir, 'bitfun-app-icon.icns'), macosFallback);
  for (const size of DESKTOP_HICOLOR_SIZES) {
    const icon = await renderIcon(size);
    await writePng(
      outputPath('src', 'apps', 'desktop', 'icons', 'hicolor', `${size}x${size}`, 'apps', 'bitfun-desktop.png'),
      icon,
    );
  }

  const mobileWebAssetDir = outputPath('src', 'mobile-web', 'src', 'assets');
  await writePng(path.join(mobileWebAssetDir, 'bitfun-mark-dark.png'), darkMark);
  await writePng(path.join(mobileWebAssetDir, 'bitfun-mark-light.png'), lightMark);
  await writePng(
    outputPath('src', 'mobile-web', 'public', 'brand', 'bitfun-app-icon.png'),
    applicationIcon,
  );
  await writePng(
    outputPath('src', 'apps', 'relay-server', 'static', 'brand', 'bitfun-app-icon.png'),
    applicationIcon,
  );

  // The installer is a shipped product surface of its own: its window, tray, and
  // container icons all render the shared application artwork, and only the
  // in-product mark stays a transparent silhouette.
  const installerBrandDir = outputPath('BitFun-Installer', 'src', 'assets');
  await writePng(path.join(installerBrandDir, 'bitfun-mark-dark.png'), darkMark);
  await writePng(path.join(installerBrandDir, 'bitfun-mark-light.png'), lightMark);
  await writePng(path.join(installerBrandDir, 'bitfun-app-icon.png'), applicationIcon);
  for (const size of FAVICON_SIZES) {
    await writePng(path.join(installerBrandDir, `bitfun-app-icon-${size}.png`), await renderIcon(size));
  }
  const installerTauriIconDir = outputPath('BitFun-Installer', 'src-tauri', 'icons');
  await writePng(path.join(installerTauriIconDir, 'bitfun-app-icon.png'), applicationIconLarge);
  await writePng(path.join(installerTauriIconDir, 'bitfun-app-icon.ico'), windowsIcon);
  await writePng(path.join(installerTauriIconDir, 'bitfun-app-icon.icns'), macosFallback);

  const dataToolsIconDir = outputPath('src', 'apps', 'data-tools', 'icons');
  await writePng(path.join(dataToolsIconDir, 'bitfun-app-icon.png'), applicationIconLarge);
  await writePng(path.join(dataToolsIconDir, 'bitfun-app-icon.ico'), windowsIcon);
  await writePng(path.join(dataToolsIconDir, 'bitfun-app-icon.icns'), macosFallback);

  // The App Store icon is a flat opaque plate: iOS applies its own corner mask,
  // so the transparent corners of the application icon are filled with the plate
  // color instead of shipping alpha.
  await writePng(
    outputPath('src', 'apps', 'mobile', 'ios', 'BitFun', 'Resources.xcassets', 'AppIcon.appiconset', 'bitfun-app-icon.png'),
    await sharp(applicationIconLarge)
      .flatten({ background: { r: 0, g: 0, b: 0 } })
      .removeAlpha()
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer(),
  );

  // Android ships both icon families. The adaptive icon (`minSdk` 26, so this is
  // what a home screen actually draws) keeps the field and the mark in separate
  // layers so the launcher can apply its own mask and themed-icon tint; the
  // legacy bitmap beside it reuses the application icon for older launchers.
  const androidResDir = outputPath('src', 'apps', 'mobile', 'android', 'app', 'src', 'main', 'res');
  for (const [density, legacySize] of Object.entries(ANDROID_LAUNCHER_SIZES)) {
    const directory = path.join(androidResDir, `mipmap-${density}`);
    const legacyIcon = await renderIcon(legacySize);
    await writePng(path.join(directory, 'ic_launcher.png'), legacyIcon);
    await writePng(path.join(directory, 'ic_launcher_round.png'), legacyIcon);
    const adaptiveSize = legacySize * ANDROID_ADAPTIVE_CANVAS_DP / ANDROID_LEGACY_ICON_DP;
    const markSize = Math.round(adaptiveSize * ANDROID_ADAPTIVE_MARK_RATIO / 2) * 2;
    const foreground = await renderCenteredMark(svg, adaptiveSize, markSize, '#ffffff');
    await writePng(path.join(directory, 'ic_launcher_foreground.png'), foreground);
    // Themed icons tint the mark through its alpha, so the monochrome layer is
    // the same silhouette the foreground ships.
    await writePng(path.join(directory, 'ic_launcher_monochrome.png'), foreground);
  }

  // Mini App Market site icons. The storefront is a separate origin, so it owns
  // its own favicon, touch icon, and manifest icons, all cut from the same
  // application artwork as the desktop app.
  const marketPublicDir = outputPath('src', 'miniapp-market-web', 'public');
  await writePng(path.join(marketPublicDir, 'icon-192.png'), await renderIcon(192));
  await writePng(path.join(marketPublicDir, 'icon-512.png'), applicationIcon);
  await writePng(
    path.join(marketPublicDir, 'apple-touch-icon.png'),
    await resizePng(applicationIcon, MARKET_TOUCH_ICON_SIZE),
  );
  for (const size of FAVICON_SIZES) {
    await writePng(
      path.join(marketPublicDir, 'assets', `bitfun-favicon-${size}.png`),
      await renderIcon(size),
    );
  }
  await writeFile(path.join(marketPublicDir, 'favicon.ico'), windowsIcon);
  await writeFile(path.join(marketPublicDir, 'favicon.svg'), createApplicationIconSvg(svg, BRAND_SIZE), 'utf8');

  for (const directory of [webBrandDir,
    outputPath('src', 'mobile-web', 'public', 'brand'),
    outputPath('src', 'apps', 'relay-server', 'static', 'brand')]) {
    for (const size of FAVICON_SIZES) {
      await writePng(path.join(directory, `bitfun-app-icon-${size}.png`), await renderIcon(size));
    }
  }

  await writePng(
    outputPath('src', 'apps', 'mobile', 'ios', 'BitFun', 'Resources.xcassets', 'BitFunMark.imageset', 'bitfun-mark-light.png'),
    lightMark,
  );

  await writePng(
    outputPath('src', 'apps', 'mobile', 'harmonyos', 'AppScope', 'resources', 'base', 'media', 'bitfun_app_icon.png'),
    applicationIconLarge,
  );
  await writePng(
    outputPath('src', 'apps', 'mobile', 'harmonyos', 'entry', 'src', 'main', 'resources', 'base', 'media', 'bitfun_app_icon.png'),
    applicationIconLarge,
  );
  await writePng(
    outputPath('src', 'apps', 'mobile', 'harmonyos', 'entry', 'src', 'main', 'resources', 'base', 'media', 'bitfun_start_window.png'),
    await resizePng(lightMark, 144),
  );
  // ArkUI tints this bitmap through its alpha mask, so the source stays a black
  // silhouette and the caller supplies the theme color.
  await writePng(
    outputPath('src', 'apps', 'mobile', 'harmonyos', 'entry', 'src', 'main', 'resources', 'base', 'media', 'bitfun_brand_mark.png'),
    await renderMark(svg, 256, '#000000'),
  );

  // HarmonyOS PC (2in1) launch page. `start_window_background` is pinned to
  // black (#000000) in both base/ and dark/, with a single light mark, so the
  // launch surface is identical in every color mode and does not flip when the
  // system/app color modes disagree. The AbilityMgr-drawn system start window,
  // the ArkUI splash mirror
  // (`oh-rs-ability/.../DefaultXComponent.ets`), and the web-ui startup overlay
  // (`src/web-ui/index.html`, shared `.splash-screen` canvas) all render the same
  // constant, so the cold-start handoff never breaks.
  await writePng(
    outputPath('src', 'apps', 'ohos', 'entry', 'src', 'main', 'resources', 'base', 'media', 'bitfun_start_window.png'),
    await renderMark(svg, OHOS_START_WINDOW_SIZE, '#ffffff'),
  );

  const ohosTrayMediaDir = outputPath('src', 'apps', 'ohos', 'entry', 'src', 'main', 'resources', 'base', 'media');
  // HarmonyOS status bar (system tray) marks for 2in1 devices. The status bar
  // paints the `white` icon on dark backgrounds and the `black` icon on light
  // ones and rejects pixel maps above its size limit.
  await writePng(
    path.join(ohosTrayMediaDir, 'bitfun_status_bar_icon_white.png'),
    await renderMark(svg, 48, '#ffffff'),
  );
  await writePng(
    path.join(ohosTrayMediaDir, 'bitfun_status_bar_icon_black.png'),
    await renderMark(svg, 48, MARK_TONE_DARK),
  );

  await removeLegacyApplicationAssets();

  console.log('Generated BitFun application brand assets.');
}

await generateBrandAssets();
