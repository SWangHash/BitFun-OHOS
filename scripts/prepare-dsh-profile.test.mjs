import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  dshProfileInputDigest,
  getDshProfileRebuildPlan,
  syncOhosDshProfile,
} from './prepare-dsh-profile.mjs';

import { profileDigest, profileFiles } from './dsh-profile-artifact.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createPackageTree() {
  const root = mkdtempSync(path.join(tmpdir(), 'bitfun-dsh-profile-'));
  const packageDir = path.join(root, 'packages', 'dsh-acp');
  const outDir = path.join(packageDir, 'dist-profile');
  const prepareScriptPath = path.join(root, 'scripts', 'prepare-dsh-profile.mjs');

  mkdirSync(path.join(packageDir, 'src'), { recursive: true });
  mkdirSync(path.join(packageDir, 'presets'), { recursive: true });
  mkdirSync(path.join(packageDir, 'scripts'), { recursive: true });
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  mkdirSync(outDir, { recursive: true });

  writeFileSync(path.join(packageDir, 'src', 'app.ts'), 'export {}\n');
  writeFileSync(path.join(packageDir, 'presets', 'preset.yml'), 'name: test\n');
  writeFileSync(path.join(packageDir, 'cordis.yml'), 'name: test\n');
  writeFileSync(path.join(packageDir, 'package.json'), '{}\n');
  writeFileSync(path.join(packageDir, 'package-lock.json'), '{}\n');
  writeFileSync(path.join(packageDir, 'tsconfig.build.json'), '{}\n');
  writeFileSync(path.join(packageDir, 'scripts', 'build-profile.mjs'), 'export {}\n');
  writeFileSync(prepareScriptPath, 'export {}\n');

  return { root, packageDir, outDir, prepareScriptPath };
}

function writeStamp(outDir, override = {}) {
  for (const name of ['package.json', 'cordis.patch.yml', 'lib/app.js', 'node_modules/@agentclientprotocol/sdk/package.json', 'node_modules/@deepseek-ai/dsh-agent-spine-demo/package.json']) {
    mkdirSync(path.dirname(path.join(outDir, name)), { recursive: true });
    writeFileSync(path.join(outDir, name), '{}\n');
  }
  const packageDir = path.dirname(outDir);
  const prepareScriptPath = path.join(packageDir, '../../scripts/prepare-dsh-profile.mjs');
  const stamp = {
    profile: 'bitfun-acp', bridge: '1.0.0', minDshVersion: '0.1.0-rc.6',
    content: profileDigest(profileFiles(outDir)),
    buildInputs: dshProfileInputDigest({ packageDir, prepareScriptPath }), ...override,
  };
  const stampPath = path.join(outDir, '.bitfun-bridge.json');
  writeFileSync(stampPath, `${JSON.stringify(stamp)}\n`);
  return stampPath;
}

function setMtime(filePath, mtimeMs) {
  const atime = new Date(mtimeMs);
  const mtime = new Date(mtimeMs);
  utimesSync(filePath, atime, mtime);
}

test('rebuilds when the profile stamp is missing', () => {
  const { root, packageDir, outDir, prepareScriptPath } = createPackageTree();
  try {
    const plan = getDshProfileRebuildPlan({ packageDir, outDir, prepareScriptPath });
    assert.equal(plan.shouldBuild, true);
    assert.match(plan.reason, /stamp is missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rebuilds when force is requested', () => {
  const { root, packageDir, outDir, prepareScriptPath } = createPackageTree();
  try {
    const stampPath = writeStamp(outDir);
    setMtime(stampPath, Date.now() + 60_000);
    const plan = getDshProfileRebuildPlan({
      packageDir,
      outDir,
      prepareScriptPath,
      force: true,
    });
    assert.equal(plan.shouldBuild, true);
    assert.match(plan.reason, /Force rebuild/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rebuilds when the stamp is incomplete', () => {
  const { root, packageDir, outDir, prepareScriptPath } = createPackageTree();
  try {
    writeStamp(outDir, { content: undefined });
    const plan = getDshProfileRebuildPlan({ packageDir, outDir, prepareScriptPath });
    assert.equal(plan.shouldBuild, true);
    assert.match(plan.reason, /incomplete/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rebuilds when input content changes even if timestamps are unchanged', () => {
  const { root, packageDir, outDir, prepareScriptPath } = createPackageTree();
  try {
    const stampPath = writeStamp(outDir);
    const older = Date.now() - 60_000;
    const newer = Date.now();
    for (const filePath of [
      path.join(packageDir, 'src', 'app.ts'),
      path.join(packageDir, 'presets', 'preset.yml'),
      path.join(packageDir, 'cordis.yml'),
      path.join(packageDir, 'package.json'),
      path.join(packageDir, 'package-lock.json'),
      path.join(packageDir, 'tsconfig.build.json'),
      path.join(packageDir, 'scripts', 'build-profile.mjs'),
      prepareScriptPath,
      stampPath,
    ]) {
      setMtime(filePath, older);
    }
    writeFileSync(path.join(packageDir, 'src', 'app.ts'), 'export const changed = true;\n');
    setMtime(path.join(packageDir, 'src', 'app.ts'), older);
    const plan = getDshProfileRebuildPlan({ packageDir, outDir, prepareScriptPath });
    assert.equal(plan.shouldBuild, true);
    assert.match(plan.reason, /inputs changed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reuses an intact profile when input content matches', () => {
  const { root, packageDir, outDir, prepareScriptPath } = createPackageTree();
  try {
    const older = Date.now() - 60_000;
    const newer = Date.now();
    for (const filePath of [
      path.join(packageDir, 'src', 'app.ts'),
      path.join(packageDir, 'presets', 'preset.yml'),
      path.join(packageDir, 'cordis.yml'),
      path.join(packageDir, 'package.json'),
      path.join(packageDir, 'package-lock.json'),
      path.join(packageDir, 'tsconfig.build.json'),
      path.join(packageDir, 'scripts', 'build-profile.mjs'),
      prepareScriptPath,
    ]) {
      setMtime(filePath, older);
    }
    const stampPath = writeStamp(outDir);
    setMtime(stampPath, newer);
    const plan = getDshProfileRebuildPlan({ packageDir, outDir, prepareScriptPath });
    assert.equal(plan.shouldBuild, false);
    assert.match(plan.reason, /up to date/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('stages a clean HarmonyOS profile with resfile-compatible names', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'bitfun-dsh-ohos-profile-'));
  const sourceDir = path.join(root, 'dist-profile');
  const destinationDir = path.join(root, 'resfile', 'dsh-profile');
  try {
    mkdirSync(sourceDir, { recursive: true });
    writeStamp(sourceDir);
    mkdirSync(destinationDir, { recursive: true });
    writeFileSync(path.join(destinationDir, 'stale.js'), 'stale');

    syncOhosDshProfile({ sourceDir, destinationDir });

    assert.equal(existsSync(path.join(destinationDir, 'stale.js')), false);
    assert.equal(existsSync(path.join(destinationDir, '.bitfun-bridge.json')), false);
    assert.equal(existsSync(path.join(destinationDir, 'node_modules')), false);
    assert.equal(existsSync(path.join(destinationDir, 'bitfun-bridge.json')), true);
    assert.equal(
      existsSync(
        path.join(destinationDir, 'vendor-node-modules', '@agentclientprotocol', 'sdk', 'package.json'),
      ),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('desktop:dev does not compile the DeepSeek profile', () => {
  const devScript = readFileSync(path.join(repoRoot, 'scripts', 'dev.cjs'), 'utf8');
  assert.doesNotMatch(devScript, /runCommandPrefixed\('dsh-profile'/);
  assert.doesNotMatch(devScript, /\['run', 'prepare:dsh-profile'\]/);
  assert.match(
    devScript,
    /Prepare resources \(parallel: monaco, version, mobile-web, flashgrep, plugin-host\)/,
  );
});

test('desktop clippy does not compile the DeepSeek profile', () => {
  const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.doesNotMatch(packageJson.scripts['lint:rs:desktop'], /prepare:dsh-profile/);
});

test('official desktop packaging owns profile preparation independently of frontend hooks', () => {
  const script = readFileSync(path.join(repoRoot, 'scripts', 'desktop-tauri-build.mjs'), 'utf8');
  assert.match(script, /prepareDshProfile\(\{ required: true \}\)/);
});

test('an incomplete or corrupted cached profile is rebuilt', () => {
  const tree = createPackageTree();
  try {
    writeStamp(tree.outDir);
    rmSync(path.join(tree.outDir, 'node_modules/@agentclientprotocol/sdk/package.json'));
    assert.equal(getDshProfileRebuildPlan(tree).shouldBuild, true);
    writeStamp(tree.outDir);
    writeFileSync(path.join(tree.outDir, 'lib/app.js'), 'corrupted');
    assert.equal(getDshProfileRebuildPlan(tree).shouldBuild, true);
  } finally { rmSync(tree.root, { recursive: true, force: true }); }
});
