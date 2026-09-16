import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const desktop = join(root, 'src/apps/desktop');
const config = JSON.parse(readFileSync(join(desktop, 'tauri.conf.json'), 'utf8'));
const plist = body => `<?xml version="1.0"?><plist version="1.0"><dict>${body}</dict></plist>`;

function verifyFixture(t, { entitlement = 'configured', usage = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'openbitfun-microphone-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const app = join(dir, 'Microphone.app');
  const executable = join(app, 'Contents/MacOS/fixture');
  mkdirSync(dirname(executable), { recursive: true });
  copyFileSync('/usr/bin/true', executable);
  const usagePlist = readFileSync(join(desktop, 'Info.plist'), 'utf8');
  const usageBody = usage ? usagePlist.match(/<dict>([\s\S]*?)<\/dict>/)[1] : '';
  writeFileSync(join(app, 'Contents/Info.plist'), plist(`
    <key>CFBundleIdentifier</key><string>com.openbitfun.microphone-fixture</string>
    <key>CFBundleExecutable</key><string>fixture</string>
    <key>CFBundlePackageType</key><string>APPL</string>${usageBody}`));
  const entitlementPath = join(dir, 'entitlements.plist');
  writeFileSync(entitlementPath, entitlement === 'configured'
    ? readFileSync(join(desktop, config.bundle.macOS.entitlements), 'utf8')
    : plist(entitlement === 'false'
      ? '<key>com.apple.security.device.audio-input</key><false/>' : ''));
  const sign = spawnSync('codesign', [
    '--force', '--sign', '-', '--options', 'runtime', '--entitlements', entitlementPath, app,
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(sign.status, 0, sign.stderr);
  return spawnSync('bash', [join(root, 'scripts/ci/verify-macos-microphone.sh'), app], {
    encoding: 'utf8', windowsHide: true,
  });
}

test('signed app preserves the configured microphone entitlement and usage description', {
  skip: process.platform !== 'darwin',
}, t => {
  const result = verifyFixture(t);
  assert.equal(result.status, 0, result.stderr);
});

for (const entitlement of ['missing', 'false']) {
  test(`rejects signed app with ${entitlement} microphone entitlement`, {
    skip: process.platform !== 'darwin',
  }, t => {
    const result = verifyFixture(t, { entitlement });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing enabled Audio Input entitlement/);
  });
}

test('rejects signed app without the microphone usage description', {
  skip: process.platform !== 'darwin',
}, t => {
  const result = verifyFixture(t, { usage: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing microphone usage description/);
});
