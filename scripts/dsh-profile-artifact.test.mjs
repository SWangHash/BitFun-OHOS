import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import { profileDigest, verifyHapProfile } from './dsh-profile-artifact.mjs';
import { prepareDshProfile } from './prepare-dsh-profile.mjs';

test('final HAP validation rejects missing and altered profile resources', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'bitfun-dsh-hap-'));
  try {
    const files = new Map([
      ['package.json', Buffer.from('{}')], ['cordis.patch.yml', Buffer.from('- insert: []')],
      ['lib/app.js', Buffer.from('export {}')],
      ['node_modules/@agentclientprotocol/sdk/package.json', Buffer.from('{}')],
      ['node_modules/@deepseek-ai/dsh-agent-spine-demo/package.json', Buffer.from('{}')],
    ]);
    files.set('.bitfun-bridge.json', Buffer.from(JSON.stringify({
      profile: 'bitfun-acp', content: profileDigest(files), bridge: '1.0.0', minDshVersion: '0.1.0-rc.6',
    })));
    const source = path.join(root, 'source');
    const zip = new JSZip();
    const prefix = 'resources/resfile/dsh-profile/';
    for (const [name, bytes] of files) {
      mkdirSync(path.dirname(path.join(source, name)), { recursive: true });
      writeFileSync(path.join(source, name), bytes);
      zip.file(prefix + name.replace(/^node_modules\//, 'vendor-node-modules/').replace(/^\.bitfun-bridge.json$/, 'bitfun-bridge.json'), bytes);
    }
    const hap = path.join(root, 'fixture.hap');
    const save = async () => writeFileSync(hap, await zip.generateAsync({ type: 'nodebuffer' }));
    await save();
    assert.equal((await verifyHapProfile(hap, source)).files, files.size);
    const sdk = prefix + 'vendor-node-modules/@agentclientprotocol/sdk/package.json';
    zip.remove(sdk);
    await save();
    await assert.rejects(verifyHapProfile(hap, source), /missing.*sdk/);
    zip.file(sdk, '{}');
    zip.file(prefix + 'lib/app.js', 'changed');
    await save();
    await assert.rejects(verifyHapProfile(hap, source), /digest/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('required packaging cannot silently opt out of the profile', () => {
  const before = process.env.BITFUN_SKIP_DSH_PROFILE;
  try {
    process.env.BITFUN_SKIP_DSH_PROFILE = '1';
    assert.throws(() => prepareDshProfile({ required: true }), /cannot be used/);
  } finally {
    if (before === undefined) delete process.env.BITFUN_SKIP_DSH_PROFILE;
    else process.env.BITFUN_SKIP_DSH_PROFILE = before;
  }
});
