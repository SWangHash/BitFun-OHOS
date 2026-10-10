import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { canonicalizeIcns } from './icns-container.mjs';

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
// HarmonyOS draws the simple launch-page icon (`startWindowIcon`) at its raw
// pixel size, so the PC start-window mark is authored at the pixel size that
// matches the in-app web-ui splash (120vp) on a 2x-density 2in1 display.
const OHOS_START_WINDOW_SIZE = 240;

const DESKTOP_HICOLOR_SIZES = [16, 32, 48, 64, 96, 128, 256, 512];
const EXPORT_SIZES = [16, 24, 32, 48, 64, 96, 128, 192, 256, 512, 1024, 2048];

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

async function generateTauriContainers(applicationIcon, renderIcon) {
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

    // Let Tauri encode legacy RGB/mask chunks from the same application
    // artwork; modern PNG representations use the matching exported sizes.
    const icnsTemplate = await readFile(path.join(tempDir, 'icon.icns'));
    const legacyChunks = new Map();
    for (const [size, types] of [[16, ['is32', 's8mk']], [32, ['il32', 'l8mk']]]) {
      const smallInput = path.join(tempDir, `input-${size}.png`);
      const smallOutput = path.join(tempDir, `legacy-${size}`);
      await writeFile(smallInput, await renderIcon(size));
      execFileSync(process.execPath,
        [tauriCliPath, 'icon', smallInput, '--output', smallOutput],
        { cwd: ROOT_DIR, stdio: 'ignore', windowsHide: true });
      const smallIcns = await readFile(path.join(smallOutput, 'icon.icns'));
      for (let offset = 8; offset < smallIcns.length;) {
        const length = smallIcns.readUInt32BE(offset + 4);
        const type = smallIcns.toString('ascii', offset, offset + 4);
        if (types.includes(type)) legacyChunks.set(type, smallIcns.subarray(offset, offset + length));
        offset += length;
      }
    }
    const icnsChunks = [];
    for (let offset = 8; offset < icnsTemplate.length;) {
      const length = icnsTemplate.readUInt32BE(offset + 4);
      const chunk = icnsTemplate.subarray(offset, offset + length);
      if (chunk.subarray(8, 16).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
        const { width } = await sharp(chunk.subarray(8)).metadata();
        const png = await renderIcon(width);
        const header = Buffer.from(chunk.subarray(0, 8));
        header.writeUInt32BE(png.length + 8, 4);
        icnsChunks.push(Buffer.concat([header, png]));
      } else {
        icnsChunks.push(legacyChunks.get(chunk.toString('ascii', 0, 4)) ?? chunk);
      }
      offset += length;
    }
    const icnsHeader = Buffer.from(icnsTemplate.subarray(0, 8));
    icnsHeader.writeUInt32BE(8 + icnsChunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
    return {
      ico: Buffer.concat([icoDirectory, ...icoFrames]),
      icns: canonicalizeIcns(Buffer.concat([icnsHeader, ...icnsChunks])),
    };
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
  const svg = await readFile(SOURCE_SVG, 'utf8');
  const [darkMark, lightMark, applicationSourceMark] = await Promise.all([
    renderMark(svg, BRAND_SIZE, '#202020'),
    renderMark(svg, BRAND_SIZE, '#e8e8e8'),
    normalizePng(SOURCE_APP_MARK),
  ]);
  await writePng(SOURCE_MARKS.dark, darkMark);
  await writePng(SOURCE_MARKS.light, lightMark);
  const applicationMark = await createApplicationMark(applicationSourceMark);
  const applicationIcon = await createApplicationIcon(applicationMark);
  const applicationIconLarge = await resizePng(applicationIcon, APP_ICON_SIZE);
  const darkMarkSmall = await renderMark(svg, 128, '#202020');
  const lightMarkSmall = await renderMark(svg, 128, '#e8e8e8');
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
  const tauriContainers = await generateTauriContainers(applicationIconLarge, renderIcon);

  const exportDir = outputPath('assets', 'brand', 'exports');
  await mkdir(exportDir, { recursive: true });
  await copyFile(SOURCE_SVG, path.join(exportDir, 'bitfun-mark.svg'));
  for (const size of EXPORT_SIZES) {
    const dark = await renderMark(svg, size, '#202020');
    const light = await renderMark(svg, size, '#e8e8e8');
    await writePng(path.join(exportDir, `bitfun-mark-dark-${size}.png`), dark);
    await writePng(path.join(exportDir, `bitfun-mark-light-${size}.png`), light);
    await writePng(
      path.join(exportDir, `bitfun-app-icon-${size}.png`),
      await renderIcon(size),
    );
  }
  await writeFile(path.join(exportDir, 'bitfun-app-icon.ico'), tauriContainers.ico);
  await writeFile(path.join(exportDir, 'bitfun-app-icon.icns'), tauriContainers.icns);

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
  await writePng(path.join(desktopIconDir, 'bitfun-app-icon.ico'), tauriContainers.ico);
  await writePng(path.join(desktopIconDir, 'bitfun-app-icon.icns'), tauriContainers.icns);
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

  // The installer, Android launcher, and iOS App Store icons deliberately keep
  // their previous artwork: they are already-released artifacts. The generator
  // only refreshes the installer's in-product mark. Read the "Frozen icon
  // targets" section of assets/brand/README.md before adding them back, and
  // update the matching guard in generate-brand-assets.test.mjs.
  const installerBrandDir = outputPath('BitFun-Installer', 'src', 'assets');
  await writePng(path.join(installerBrandDir, 'bitfun-mark-dark.png'), darkMark);
  await writePng(path.join(installerBrandDir, 'bitfun-mark-light.png'), lightMark);

  for (const directory of [webBrandDir,
    outputPath('src', 'mobile-web', 'public', 'brand'),
    outputPath('src', 'apps', 'relay-server', 'static', 'brand')]) {
    for (const size of [16, 32]) {
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

  // HarmonyOS PC (2in1) launch page. `start_window_background` is pinned to a
  // neutral gray (#6A6A6A) in both base/ and dark/, with a single light mark,
  // so the launch surface is identical in every color mode and does not flip
  // when the system/app color modes disagree. The neutral tone sits between the
  // app's light (#f8f8f9) and dark (#1c1c1f) chrome surfaces, so the handoff to
  // either app theme is a moderate step instead of a black or white flash. The
  // AbilityMgr-drawn system start window, the ArkUI splash mirror
  // (`oh-rs-ability/.../DefaultXComponent.ets`), and the web-ui startup overlay
  // (`src/web-ui/index.html`, `.splash-screen--ohos-brand`) all render the same
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
    await renderMark(svg, 48, '#202020'),
  );

  await removeLegacyApplicationAssets();

  console.log('Generated BitFun application brand assets.');
}

await generateBrandAssets();
