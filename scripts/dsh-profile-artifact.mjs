import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const PROFILE_STAMP = '.bitfun-bridge.json';
export const OHOS_PROFILE_STAMP = 'bitfun-bridge.json';
const REQUIRED_FILES = [
  'package.json', 'cordis.patch.yml', 'lib/app.js',
  'node_modules/@agentclientprotocol/sdk/package.json',
  'node_modules/@deepseek-ai/dsh-agent-spine-demo/package.json',
];

export function canonicalProfilePath(name) {
  if (name === OHOS_PROFILE_STAMP) return PROFILE_STAMP;
  return name.replace(/^vendor-node-modules\//, 'node_modules/');
}

export function profileFiles(root) {
  const files = new Map();
  const walk = (dir, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), name + '/');
      else files.set(canonicalProfilePath(name), readFileSync(path.join(dir, entry.name)));
    }
  };
  walk(root);
  return files;
}

export function profileDigest(files) {
  const digest = createHash('sha256');
  for (const name of [...files.keys()].filter(name => name !== PROFILE_STAMP).sort()) {
    digest.update(name);
    digest.update('\0');
    digest.update(files.get(name));
  }
  return digest.digest('hex');
}

export function validateProfileFiles(files) {
  const raw = files.get(PROFILE_STAMP);
  if (!raw) throw new Error('dsh-profile stamp is missing');
  const stamp = JSON.parse(raw.toString('utf8'));
  if (stamp.profile !== 'bitfun-acp' || ['content', 'bridge', 'minDshVersion'].some(key => typeof stamp[key] !== 'string' || stamp[key] === '')) {
    throw new Error('dsh-profile stamp is incomplete');
  }
  for (const name of REQUIRED_FILES) {
    if (!files.has(name)) throw new Error(`dsh-profile is missing ${name}`);
  }
  if (profileDigest(files) !== stamp.content) throw new Error('dsh-profile content digest does not match');
  return stamp;
}

export function validateProfileDirectory(root) {
  return validateProfileFiles(profileFiles(root));
}

export async function verifyHapProfile(hap, sourceDir) {
  const { default: JSZip } = await import('jszip');
  // Read only profile entries; the native library can be very large in debug HAPs.
  // Their digest checks every profile byte without inflating unrelated resources.
  const zip = await JSZip.loadAsync(readFileSync(hap));
  const prefix = 'resources/resfile/dsh-profile/';
  const files = new Map();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir && name.startsWith(prefix)) {
      files.set(canonicalProfilePath(name.slice(prefix.length)), await entry.async('nodebuffer'));
    }
  }
  const stamp = validateProfileFiles(files);
  const expected = profileFiles(sourceDir);
  validateProfileFiles(expected);
  if (files.size !== expected.size || [...expected].some(([name, bytes]) => !bytes.equals(files.get(name) ?? Buffer.alloc(0)))) {
    throw new Error('HAP dsh-profile differs from the prepared profile');
  }
  return { files: files.size, content: stamp.content };
}
