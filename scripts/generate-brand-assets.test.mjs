import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import sharp from 'sharp';
import { canonicalizeIcns } from './icns-container.mjs';

const GENERATED_ICNS_FILES = [
  'src/apps/desktop/icons/bitfun-app-icon.icns',
  'BitFun-Installer/src-tauri/icons/bitfun-app-icon.icns',
  'src/apps/data-migrator/icons/bitfun-app-icon.icns',
];

const ANDROID_LAUNCHER_SIZES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const ANDROID_ADAPTIVE_CANVAS_DP = 108;
const ANDROID_LEGACY_ICON_DP = 48;

const HARMONY_MEDIA_DIRS = [
  'src/apps/mobile/harmonyos/AppScope/resources/base/media',
  'src/apps/mobile/harmonyos/entry/src/main/resources/base/media',
  'src/apps/ohos/entry/src/main/resources/base/media',
];

function createChunk(type, payload) {
  const chunk = Buffer.alloc(8 + payload.length);
  chunk.write(type, 0, 4, 'ascii');
  chunk.writeUInt32BE(chunk.length, 4);
  payload.copy(chunk, 8);
  return chunk;
}

function createIcns(chunks) {
  const length = 8 + chunks.reduce((total, chunk) => total + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(length, 4);
  return Buffer.concat([header, ...chunks], length);
}

test('ICNS canonicalization is independent of Tauri chunk order', () => {
  const chunks = [
    createChunk('ic10', Buffer.from('large')),
    createChunk('ic07', Buffer.from('small')),
    createChunk('s8mk', Buffer.from('mask')),
  ];
  const forward = canonicalizeIcns(createIcns(chunks));
  const reverse = canonicalizeIcns(createIcns([...chunks].reverse()));

  assert.deepEqual(forward, reverse);
  assert.deepEqual(canonicalizeIcns(forward), forward);
});

test('application ICNS files use the canonical ICNS layout', () => {
  // Every bundled product (desktop, installer, data migrator) ships one icon
  // family, so the three containers must stay byte-identical and canonical.
  const [desktop, ...rest] = GENERATED_ICNS_FILES.map(filePath => readFileSync(filePath));

  assert.ok(desktop.equals(canonicalizeIcns(desktop)), 'desktop ICNS is not canonical');
  for (const [index, container] of rest.entries()) {
    assert.ok(container.equals(canonicalizeIcns(container)), `${GENERATED_ICNS_FILES[index + 1]} is not canonical`);
    assert.deepEqual(container, desktop, `${GENERATED_ICNS_FILES[index + 1]} drifted from the shared artwork`);
  }
});

test('application icons preserve the submitted artwork independently from the startup Logo', async () => {
  const applicationMark = readFileSync('assets/brand/source/bitfun-app-mark.png');
  const startupMark = readFileSync('assets/brand/source/bitfun-mark-light.png');
  const generatedIcon = readFileSync('assets/brand/exports/bitfun-app-icon-512.png');

  assert.equal(
    createHash('sha256').update(applicationMark).digest('hex'),
    'ecba383b19baa7140f4c63741d19889d29fdb844357ff8219410199f5a561ed3',
  );
  assert.equal(
    createHash('sha256').update(generatedIcon).digest('hex'),
    '1b9e53949131c5787991835cfba322234c4f50d0bd3c7076c23241679af04e83',
  );
  assert.notDeepEqual(applicationMark, startupMark);

  const metadata = await sharp(applicationMark).metadata();
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);
  assert.equal(metadata.hasAlpha, true);
});

test('iOS App Store icon is a 1024 pixel RGB image without alpha', async () => {
  const metadata = await sharp('src/apps/mobile/ios/BitFun/Resources.xcassets/AppIcon.appiconset/bitfun-app-icon.png').metadata();
  assert.equal(metadata.width, 1024);
  assert.equal(metadata.height, 1024);
  assert.equal(metadata.hasAlpha, false);
  assert.equal(metadata.channels, 3);
});

test('brand exports provide decodable transparent PNGs at every advertised size', async () => {
  const sizes = [16, 24, 32, 48, 64, 96, 128, 192, 256, 512, 1024, 2048];
  for (const size of sizes) {
    for (const treatment of ['mark-dark', 'mark-light', 'app-icon']) {
      const image = sharp(`assets/brand/exports/bitfun-${treatment}-${size}.png`);
      const metadata = await image.metadata();
      assert.equal(metadata.width, size);
      assert.equal(metadata.height, size);
      assert.equal(metadata.hasAlpha, true);
      const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
      // Tiny rounded-square icons can have partial edge coverage in the corner.
      assert.ok(data[info.channels - 1] <= 16, 'corner must remain transparent apart from antialiasing');
    }
  }
  assert.deepEqual(
    readFileSync('assets/brand/exports/bitfun-mark.svg'),
    readFileSync('assets/brand/source/bitfun-mark.svg'),
  );
});

test('Web UI exposes the canonical mark as a reusable currentColor vector asset', () => {
  const source = readFileSync('assets/brand/source/bitfun-mark.svg', 'utf8');
  const webAsset = readFileSync('src/web-ui/public/brand/bitfun-mark.svg', 'utf8');

  assert.equal(webAsset, source.replaceAll('fill="black"', 'fill="currentColor"'));
  assert.equal(webAsset.match(/<path\b/g)?.length, 1);
  assert.match(webAsset, /fill="currentColor"/);
  assert.doesNotMatch(webAsset, /#[0-9a-f]{3,8}\b/i);
});

test('Windows ICO frames contain the size-specific app PNGs', async () => {
  const ico = readFileSync('src/apps/desktop/icons/bitfun-app-icon.ico');
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const sizes = [];
  for (let index = 0; index < ico.readUInt16LE(4); index++) {
    const entry = 6 + index * 16;
    const size = ico[entry] || 256;
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.ok(offset + length <= ico.length);
    const frame = ico.subarray(offset, offset + length);
    assert.deepEqual(frame, readFileSync(`assets/brand/exports/bitfun-app-icon-${size}.png`));
    const metadata = await sharp(frame).metadata();
    assert.equal(metadata.width, size);
    assert.equal(metadata.height, size);
    sizes.push(size);
  }
  assert.deepEqual(sizes.sort((a, b) => a - b), [16, 24, 32, 48, 64, 256]);
});

test('small icons keep the diagonal mark readable inside the rounded square', async () => {
  // The mark is a diagonal silhouette. Unlike the previous evenly spread
  // contour ribbon it does not reach every compass sector, so the contract is
  // that the mark survives antialiasing at every size instead of fading into
  // the dark plate. The measured share is 4.4% at 16 px and grows with size.
  for (const size of [16, 24, 32, 48, 64]) {
    const { data, info } = await sharp(`assets/brand/exports/bitfun-app-icon-${size}.png`)
      .raw().toBuffer({ resolveWithObject: true });
    let plate = 0;
    let mark = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const offset = (y * size + x) * info.channels;
        if (data[offset + 3] < 16) continue;
        plate++;
        if (data[offset] >= 200) mark++;
      }
    }
    assert.ok(
      mark / plate >= 0.03,
      `${size}px icon loses the mark: ${mark}/${plate} bright pixels`,
    );
  }
});

test('desktop tray uses a macOS template and the application icon on other platforms', () => {
  const source = readFileSync('src/apps/desktop/src/tray.rs', 'utf8');
  assert.match(source, /#\[cfg\(target_os = "macos"\)\]\s*let icon = macos_tray_icon\(\)\?/);
  assert.match(source, /#\[cfg\(not\(target_os = "macos"\)\)\]\s*let icon = app\s*\.default_window_icon\(\)/);
  assert.doesNotMatch(source, /bitfun-tray-template/);
  assert.match(source, /\.icon_as_template\(cfg!\(target_os = "macos"\)\)/);
  // The unread badge is gone, so the mark is built once and never swapped:
  // nothing may re-apply the icon or write a numeric tray title afterwards.
  assert.doesNotMatch(source, /set_icon_with_as_template|set_title/);
});

test('browser entry points reference generated application favicons', () => {
  for (const [htmlPath, assetDir] of [
    ['src/web-ui/index.html', 'src/web-ui/public/brand'],
    ['src/mobile-web/index.html', 'src/mobile-web/public/brand'],
    ['src/apps/relay-server/static/index.html', 'src/apps/relay-server/static/brand'],
  ]) {
    const html = readFileSync(htmlPath, 'utf8');
    for (const size of [16, 32]) {
      assert.ok(html.includes(`sizes="${size}x${size}"`));
      const name = `bitfun-app-icon-${size}.png`;
      assert.ok(html.includes(name));
      assert.deepEqual(readFileSync(`${assetDir}/${name}`), readFileSync(`assets/brand/exports/${name}`));
    }
  }

  // The installer now ships the generated application artwork, so its entry
  // point and its bundled files must reference the same exports as every other
  // surface.
  const installerHtml = readFileSync('BitFun-Installer/index.html', 'utf8');
  for (const name of ['bitfun-app-icon.png', 'bitfun-app-icon-16.png', 'bitfun-app-icon-32.png']) {
    assert.ok(installerHtml.includes(name), `installer entry point no longer references ${name}`);
  }
  assert.deepEqual(
    readFileSync('BitFun-Installer/src/assets/bitfun-app-icon.png'),
    readFileSync('assets/brand/exports/bitfun-app-icon-512.png'),
  );
  for (const size of [16, 32]) {
    assert.deepEqual(
      readFileSync(`BitFun-Installer/src/assets/bitfun-app-icon-${size}.png`),
      readFileSync(`assets/brand/exports/bitfun-app-icon-${size}.png`),
      `installer ships a stale ${size}px favicon`,
    );
  }
});

test('installer, data migrator, and Mini App Market icons reuse the application exports', () => {
  const exportedPng = size => readFileSync(`assets/brand/exports/bitfun-app-icon-${size}.png`);
  const exportedIco = readFileSync('assets/brand/exports/bitfun-app-icon.ico');
  const exportedIcns = readFileSync('assets/brand/exports/bitfun-app-icon.icns');

  for (const directory of [
    'BitFun-Installer/src-tauri/icons',
    'src/apps/data-migrator/icons',
  ]) {
    assert.deepEqual(readFileSync(`${directory}/bitfun-app-icon.png`), exportedPng(1024), directory);
    assert.deepEqual(readFileSync(`${directory}/bitfun-app-icon.ico`), exportedIco, directory);
    assert.deepEqual(readFileSync(`${directory}/bitfun-app-icon.icns`), exportedIcns, directory);
  }

  const market = 'src/miniapp-market-web/public';
  assert.deepEqual(readFileSync(`${market}/icon-512.png`), exportedPng(512));
  assert.deepEqual(readFileSync(`${market}/icon-192.png`), exportedPng(192));
  assert.deepEqual(readFileSync(`${market}/favicon.ico`), exportedIco);
  for (const size of [16, 32]) {
    assert.deepEqual(readFileSync(`${market}/assets/bitfun-favicon-${size}.png`), exportedPng(size));
  }
});

test('Mini App Market touch icon keeps the application plate at its own size', async () => {
  const { data, info } = await sharp('src/miniapp-market-web/public/apple-touch-icon.png')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  assert.equal(info.width, 180);
  assert.equal(info.height, 180);
  assert.ok(data[info.channels - 1] <= 16, 'the corner stays outside the rounded plate');
  const center = ((90 * info.width) + 90) * info.channels;
  assert.equal(data[center + 3], 255, 'the plate must be opaque at its center');
});

test('Mini App Market favicon is a vector twin of the application icon', () => {
  const source = readFileSync('assets/brand/source/bitfun-mark.svg', 'utf8');
  const favicon = readFileSync('src/miniapp-market-web/public/favicon.svg', 'utf8');
  const markPath = source.match(/<path[^>]*\sd="([^"]+)"/)?.[1];

  assert.ok(markPath, 'source mark has no path geometry');
  assert.match(favicon, /<rect width="512" height="512" rx="96" fill="#000000"\/>/);
  assert.match(favicon, /viewBox="0 0 120 120"/);
  assert.ok(favicon.includes(markPath), 'favicon must embed the canonical mark geometry');
  assert.equal(favicon.match(/<path\b/g)?.length, 1);
  assert.doesNotMatch(favicon, /currentColor/);
});

test('Android launcher icons keep the application plate and the adaptive safe area', async () => {
  const androidRes = 'src/apps/mobile/android/app/src/main/res';
  // The 512px export is the canonical application icon the generator resizes
  // from, so the legacy bitmaps are checked against the same downsample.
  const applicationIcon = readFileSync('assets/brand/exports/bitfun-app-icon-512.png');
  const downsample = size => sharp(applicationIcon)
    .resize({ width: size, height: size, fit: 'contain', kernel: 'lanczos3' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  for (const [density, legacySize] of Object.entries(ANDROID_LAUNCHER_SIZES)) {
    const directory = `${androidRes}/mipmap-${density}`;
    const legacyIcon = readFileSync(`${directory}/ic_launcher.png`);

    assert.deepEqual(legacyIcon, await downsample(legacySize), `${density} launcher plate`);
    assert.deepEqual(readFileSync(`${directory}/ic_launcher_round.png`), legacyIcon);
    assert.deepEqual(
      readFileSync(`${directory}/ic_launcher_monochrome.png`),
      readFileSync(`${directory}/ic_launcher_foreground.png`),
    );

    const canvas = legacySize * ANDROID_ADAPTIVE_CANVAS_DP / ANDROID_LEGACY_ICON_DP;
    const { data, info } = await sharp(`${directory}/ic_launcher_foreground.png`)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(info.width, canvas, `${density} adaptive canvas`);
    assert.equal(info.height, canvas, `${density} adaptive canvas`);
    assert.equal(info.channels, 4);

    // The launcher mask may cut anything outside the safe area, so the mark has
    // to stay clear of the canvas edge at every density.
    const margin = Math.round(canvas * 0.1);
    for (let y = 0; y < canvas; y++) {
      for (let x = 0; x < canvas; x++) {
        if (data[((y * canvas) + x) * info.channels + 3] === 0) continue;
        assert.ok(
          x >= margin && x < canvas - margin && y >= margin && y < canvas - margin,
          `${density} adaptive mark leaves the safe area at ${x},${y}`,
        );
      }
    }
  }
});

test('HarmonyOS generated media use valid resource identifiers', () => {
  for (const directory of HARMONY_MEDIA_DIRS) {
    for (const fileName of readdirSync(directory)) {
      const resourceName = fileName.replace(/\.[^.]+$/, '');
      assert.match(
        resourceName,
        /^[a-zA-Z0-9_]+$/,
        `${directory}/${fileName} is not a valid HarmonyOS resource name`,
      );
    }
  }

  const appConfig = readFileSync('src/apps/mobile/harmonyos/AppScope/app.json5', 'utf8');
  const moduleConfig = readFileSync('src/apps/mobile/harmonyos/entry/src/main/module.json5', 'utf8');
  assert.match(appConfig, /\$media:bitfun_app_icon/);
  assert.match(moduleConfig, /\$media:bitfun_app_icon/);
  assert.match(moduleConfig, /\$media:bitfun_start_window/);

  // The HarmonyOS PC launch page reuses the shared start-window mark. The
  // start window is pinned to a single appearance (a black canvas and one light
  // mark) so the AbilityMgr-drawn system start window, the ArkUI splash mirror,
  // and the web-ui startup overlay can never diverge.
  const ohosModuleConfig = readFileSync('src/apps/ohos/entry/src/main/module.json5', 'utf8');
  assert.match(ohosModuleConfig, /\$media:bitfun_start_window/);
  assert.doesNotMatch(ohosModuleConfig, /bitfun_icon_light/);
  assert.doesNotThrow(() => readFileSync('src/apps/ohos/entry/src/main/resources/base/media/bitfun_start_window.png'));
  for (const scope of ['base', 'dark']) {
    const colorConfig = JSON.parse(
      readFileSync(`src/apps/ohos/entry/src/main/resources/${scope}/element/color.json`, 'utf8'),
    );
    const background = colorConfig.color.find(entry => entry.name === 'start_window_background');
    assert.equal(background?.value, '#000000', `${scope} start_window_background must stay the launch constant`);
  }
});

test('ICNS canonicalization rejects malformed containers', () => {
  assert.throws(
    () => canonicalizeIcns(Buffer.from('not-an-icns')),
    /Invalid ICNS header/,
  );

  const truncated = createIcns([createChunk('ic07', Buffer.from('small'))]).subarray(0, -1);
  assert.throws(() => canonicalizeIcns(truncated), /Invalid ICNS length/);
});

test('verification email reuses the current mark and the BitFun reference palette', () => {
  const emailMark = readFileSync('src/miniapp-market-web/public/assets/bitfun-email-app-icon.png');
  assert.deepEqual(emailMark, readFileSync('src/web-ui/public/brand/bitfun-app-icon.png'));
  assert.deepEqual(emailMark, readFileSync('src/crates/services/miniapp-market-service/src/email/app-icon.png'));
  const html = readFileSync('src/crates/services/miniapp-market-service/src/email/sign-in.html', 'utf8');
  const tokens = JSON.parse(readFileSync('design-system/packages/theme-bitfun/src/reference.tokens.json', 'utf8'));
  const palette = new Set([...Object.values(tokens.ref.color.neutral), ...Object.values(tokens.ref.color.cyan)]
    .map(token => token?.$value).filter(Boolean));
  for (const [color] of html.matchAll(/#[0-9a-f]{6}\b/g)) assert.ok(palette.has(color), `Email color ${color} must come from the existing neutral/cyan palette`);
  assert.match(html, /src="cid:bitfun-app-icon"/);
  assert.doesNotMatch(html, /<script|<form|data:image|\?[^\s]*\{\{code\}\}/i);
});
