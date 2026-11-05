import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const WEB_FONT_PROFILE_ENV = 'BITFUN_WEB_FONT_PROFILE';
export const APPLE_SYSTEM_FONT_PROFILE = 'apple-system';
export const HARMONY_BUNDLED_FONT_PROFILE = 'harmony-bundled';
// HarmonyOS PC renders product text with the platform face, which is the same
// HarmonyOS Sans the bundled profile ships. Bundling it means the launch fetches
// roughly 8 MB per weight over the ArkWeb scheme handler, which cannot serve
// concurrent requests, so the CJK faces end up competing with the startup IPC
// that the launch surface waits on. Only the editor/tool monospace face stays
// bundled here: it loads on demand when an editor opens, never during a launch.
export const OHOS_SYSTEM_FONT_PROFILE = 'ohos-system';

const FIRA_CODE_LICENSE_FILE = 'third-party/fonts/fira-code/LICENSE.txt';

export const HARMONY_FONT_ASSETS = Object.freeze([
  {
    relativePath: 'base/HarmonyOS_Sans.ttf',
    bytes: 342_076,
    sha256: '72D5ADB60242FAE60686CA94C27E10B89CB7ED2008531390D3F22AC61AD64593',
  },
  {
    relativePath: 'sc/HarmonyOS_Sans_SC.ttf',
    bytes: 20_617_156,
    sha256: '8978E05044E7089AD6A9DE38C505C8148305607983487435A916D2610700A7CA',
  },
  {
    relativePath: 'LICENSE.txt',
    bytes: 32_766,
    sha256: '7D7ACF8E3AC928AE7F34AAA9F8E348DD0476DBB52CAAA058E402894D4F6EFE73',
  },
]);

const HARMONY_FONT_STEMS = Object.freeze(
  HARMONY_FONT_ASSETS
    .filter(({ relativePath }) => relativePath.endsWith('.ttf'))
    .map(({ relativePath }) => relativePath.split('/').at(-1).replace(/\.ttf$/, '')),
);

const FIRA_FONT_STEMS = Object.freeze([
  'FiraCode-Regular',
  'FiraCode-Medium',
  'FiraCode-SemiBold',
  'FiraCode-VF',
]);

const PRODUCT_FONT_ASSET_PATTERN = /(?:HarmonyOS[_-]Sans|FiraCode-|Noto[_-]Sans[_-]SC)[^/]*\.(?:ttf|otf|woff2?)$/i;

export function normalizeWebFontProfile(value) {
  if (
    value === APPLE_SYSTEM_FONT_PROFILE
    || value === HARMONY_BUNDLED_FONT_PROFILE
    || value === OHOS_SYSTEM_FONT_PROFILE
  ) {
    return value;
  }
  throw new Error(
    `Unsupported ${WEB_FONT_PROFILE_ENV} value: ${value}. `
      + `Expected ${APPLE_SYSTEM_FONT_PROFILE}, ${HARMONY_BUNDLED_FONT_PROFILE} `
      + `or ${OHOS_SYSTEM_FONT_PROFILE}.`,
  );
}

/**
 * Resolve the product font profile for a Vite command.
 *
 * The plain production build (no `--mode`) is the HarmonyOS PC product build,
 * because that is the form the HAP flow runs: `pnpm --dir src/web-ui build`,
 * and the same bare `vite build` inside `scripts/build-web-parallel.mjs`. That
 * product renders its text with the platform face, so it must not carry the
 * bundled CJK faces. Explicit `--mode desktop` / `--mode web` builds, desktop
 * packaging (`fontProfileForDesktopTarget`) and `serve` keep the bundled face.
 */
export function resolveWebFontProfile({
  requested,
  command = 'build',
  platform = process.platform,
  mode = 'production',
} = {}) {
  if (requested) return normalizeWebFontProfile(requested);

  // Development follows the host so macOS never downloads product font packages
  // merely to run HMR.
  if (command === 'serve') {
    return platform === 'darwin'
      ? APPLE_SYSTEM_FONT_PROFILE
      : HARMONY_BUNDLED_FONT_PROFILE;
  }

  // Desktop and web builds run on hosts whose platform font differs from the
  // product face, and have no launch cost competing with the bundled faces.
  if (mode === 'desktop' || mode === 'web') {
    return HARMONY_BUNDLED_FONT_PROFILE;
  }

  return OHOS_SYSTEM_FONT_PROFILE;
}

export function fontProfileForDesktopTarget({ target, platform = process.platform } = {}) {
  if (target) {
    if (/apple/i.test(target)) return APPLE_SYSTEM_FONT_PROFILE;
    if (/ohos|harmony/i.test(target)) return OHOS_SYSTEM_FONT_PROFILE;
    return HARMONY_BUNDLED_FONT_PROFILE;
  }
  return platform === 'darwin'
    ? APPLE_SYSTEM_FONT_PROFILE
    : HARMONY_BUNDLED_FONT_PROFILE;
}

export function verifyHarmonyFontSources(assetRoot) {
  for (const expected of HARMONY_FONT_ASSETS) {
    const source = readFileSync(join(assetRoot, ...expected.relativePath.split('/')));
    const actualHash = createHash('sha256').update(source).digest('hex').toUpperCase();
    if (source.byteLength !== expected.bytes || actualHash !== expected.sha256) {
      throw new Error(
        `HarmonyOS Sans source changed: ${expected.relativePath}. `
          + `Expected ${expected.bytes} bytes / ${expected.sha256}, `
          + `received ${source.byteLength} bytes / ${actualHash}.`,
      );
    }
  }

  const expectedFontPaths = new Set(
    HARMONY_FONT_ASSETS
      .filter(({ relativePath }) => relativePath.endsWith('.ttf'))
      .map(({ relativePath }) => relativePath.toLowerCase()),
  );
  const unexpectedFonts = listFontFiles(assetRoot).filter(
    (relativePath) => !expectedFontPaths.has(relativePath.toLowerCase()),
  );
  if (unexpectedFonts.length > 0) {
    throw new Error(
      `HarmonyOS Sans source contains unapproved font files: ${unexpectedFonts.join(', ')}`,
    );
  }
}

export function assertWebFontProfileBundle(profile, bundleFileNames) {
  const normalized = normalizeWebFontProfile(profile);
  const names = [...bundleFileNames];
  const productFonts = names.filter((name) => PRODUCT_FONT_ASSET_PATTERN.test(name));

  if (normalized === APPLE_SYSTEM_FONT_PROFILE) {
    if (productFonts.length > 0) {
      throw new Error(
        `Apple Web bundle contains product text fonts: ${productFonts.join(', ')}`,
      );
    }
    return;
  }

  if (normalized === OHOS_SYSTEM_FONT_PROFILE) {
    const textFonts = productFonts.filter(
      (name) => !FIRA_FONT_STEMS.some((stem) => name.includes(stem)),
    );
    if (textFonts.length > 0) {
      throw new Error(
        `HarmonyOS system-font Web bundle contains product text fonts: ${textFonts.join(', ')}`,
      );
    }

    const missingFira = FIRA_FONT_STEMS.filter(
      (stem) => !productFonts.some((name) => name.includes(stem)),
    );
    if (missingFira.length > 0) {
      throw new Error(
        `HarmonyOS system-font Web bundle is missing font assets: ${missingFira.join(', ')}`,
      );
    }

    if (!names.includes(FIRA_CODE_LICENSE_FILE)) {
      throw new Error(
        `HarmonyOS system-font Web bundle is missing legal asset: ${FIRA_CODE_LICENSE_FILE}`,
      );
    }
    return;
  }

  const expectedStems = [...HARMONY_FONT_STEMS, ...FIRA_FONT_STEMS];
  const matchesByStem = new Map(
    expectedStems.map((stem) => [
      stem,
      productFonts.filter((name) => matchesFontStem(name, stem)),
    ]),
  );
  const missing = expectedStems.filter((stem) => matchesByStem.get(stem).length === 0);
  if (missing.length > 0) {
    throw new Error(`Harmony Web bundle is missing font assets: ${missing.join(', ')}`);
  }

  const duplicated = expectedStems.filter((stem) => matchesByStem.get(stem).length > 1);
  if (duplicated.length > 0) {
    throw new Error(`Harmony Web bundle contains duplicate font assets: ${duplicated.join(', ')}`);
  }

  const unexpectedFonts = productFonts.filter(
    (name) => !expectedStems.some((stem) => matchesFontStem(name, stem)),
  );
  if (unexpectedFonts.length > 0) {
    throw new Error(
      `Harmony Web bundle contains unapproved font assets: ${unexpectedFonts.join(', ')}`,
    );
  }

  const wrongFormats = expectedStems.flatMap((stem) => {
    const expectedExtension = HARMONY_FONT_STEMS.includes(stem) ? '.ttf' : '.woff2';
    return matchesByStem.get(stem).filter(
      (name) => !name.toLowerCase().endsWith(expectedExtension),
    );
  });
  if (wrongFormats.length > 0) {
    throw new Error(
      `Harmony Web bundle contains font assets in unapproved formats: ${wrongFormats.join(', ')}`,
    );
  }

  for (const legalFile of [
    'third-party/fonts/harmonyos-sans/LICENSE.txt',
    'third-party/fonts/harmonyos-sans/NOTICE.txt',
    'third-party/fonts/fira-code/LICENSE.txt',
  ]) {
    if (!names.includes(legalFile)) {
      throw new Error(`Harmony Web bundle is missing legal asset: ${legalFile}`);
    }
  }
}

function matchesFontStem(path, stem) {
  const fileName = path.split('/').at(-1);
  // Match the asset/hash boundary so the base family cannot also match SC or
  // the retired per-weight faces.
  return fileName.startsWith(`${stem}-`) || fileName.startsWith(`${stem}.`);
}

function listFontFiles(root, current = root, prefix = '') {
  const paths = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      paths.push(...listFontFiles(root, join(current, entry.name), relativePath));
    } else if (/\.(?:ttf|otf|woff2?)$/i.test(entry.name)) {
      paths.push(relativePath);
    }
  }
  return paths.sort();
}
