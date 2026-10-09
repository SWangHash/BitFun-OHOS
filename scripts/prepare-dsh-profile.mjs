#!/usr/bin/env node

/**
 * Build the DeepSeek Harness bridge into the profile directory the desktop
 * bundle ships (`packages/dsh-acp/dist-profile`).
 *
 * BitFun launches DeepSeek Harness as `dsh --profile bitfun-acp`, and copies
 * that directory into the user's own dsh install on first use — see
 * `src/crates/interfaces/acp/src/client/dsh_profile.rs`. The build has to
 * happen here rather than in Cargo because it is a TypeScript compile.
 *
 * `packages/dsh-acp` is deliberately NOT a pnpm workspace member: it pins the
 * whole harness `0.1.0-rc.6` train, and making every contributor's
 * `pnpm install` fetch that is a poor trade when only the desktop bundle needs
 * it. So this installs the package from its own lockfile, here, once — unless
 * a developer already linked a local harness checkout, in which case that
 * checkout wins and no install runs.
 *
 * A failure here fails the build. An app that silently ships no bridge looks
 * exactly like an app that ships a working one until a user tries to start a
 * DeepSeek session, and that is the wrong place to find out. Set
 * `BITFUN_SKIP_DSH_PROFILE=1` to opt out deliberately.
 *
 * Official packaging calls this from its product build entrypoint. desktop:dev
 * and cargo check do not: the profile is not a compile-time Tauri resource.
 * Local DeepSeek sessions run this script explicitly. An intact stamped profile whose
 * inputs have not changed is reused using a content hash of the build inputs and complete output. Escape hatches: `--force` /
 * `BITFUN_DSH_PROFILE_FORCE_BUILD=1`.
 */

import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { validateProfileDirectory } from './dsh-profile-artifact.mjs';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_DIR = path.join(ROOT_DIR, 'packages', 'dsh-acp');
const OUT_DIR = path.join(PACKAGE_DIR, 'dist-profile');
const STAMP_FILENAME = '.bitfun-bridge.json';
const OHOS_STAMP_FILENAME = 'bitfun-bridge.json';
const NODE_MODULES_DIR = 'node_modules';
const OHOS_NODE_MODULES_DIR = 'vendor-node-modules';

/** One installed harness package is enough to tell a populated tree from a bare one. */
const DEPS_PROBE = path.join(PACKAGE_DIR, 'node_modules', '@deepseek-ai', 'dsh-app-boot');

/** Explains an empty dist-profile to whoever finds one in a build tree. */
const PLACEHOLDER = `This BitFun build ships no DeepSeek Harness bridge.

BITFUN_SKIP_DSH_PROFILE was set when this build ran, so packages/dsh-acp was
never compiled. BitFun's profile resolver rejects this unstamped directory and
reports that the bridge is missing from the build.

To include it: run \`pnpm run prepare:dsh-profile\` without that variable.
`;

export function dshProfileInputDigest({ packageDir = PACKAGE_DIR, prepareScriptPath = fileURLToPath(import.meta.url) } = {}) {
  const digest = createHash('sha256');
  const visit = (name, file) => {
    if (!existsSync(file)) { digest.update(`missing:${name}\0`); return; }
    const stat = lstatSync(file);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(file).sort()) visit(`${name}/${entry}`, path.join(file, entry));
    } else {
      digest.update(`${name}\0`);
      digest.update(readFileSync(file));
    }
  };
  for (const name of ['src', 'presets', 'cordis.yml', 'package.json', 'package-lock.json', 'tsconfig.build.json', 'scripts/build-profile.mjs']) {
    visit(name, path.join(packageDir, name));
  }
  visit('prepare-dsh-profile.mjs', prepareScriptPath);
  visit('dsh-profile-artifact.mjs', path.join(ROOT_DIR, 'scripts', 'dsh-profile-artifact.mjs'));
  return digest.digest('hex');
}

/**
 * Decide whether the shipped profile needs a rebuild.
 *
 * A directory is not enough: Tauri only needs the path to exist, but BitFun's
 * resolver rejects an unstamped tree. The stamp `.bitfun-bridge.json` is the
 * same file `scripts/build-profile.mjs` writes and ACP reads.
 *
 * @param {{
 *   packageDir?: string,
 *   outDir?: string,
 *   prepareScriptPath?: string,
 *   force?: boolean,
 * }} [options]
 * @returns {{ shouldBuild: boolean, reason: string }}
 */
export function getDshProfileRebuildPlan({
  packageDir = PACKAGE_DIR,
  outDir = path.join(packageDir, 'dist-profile'),
  prepareScriptPath = path.join(ROOT_DIR, 'scripts', 'prepare-dsh-profile.mjs'),
  force = false,
} = {}) {
  if (force) {
    return { shouldBuild: true, reason: 'Force rebuild requested for dsh-profile' };
  }

  const stampPath = path.join(outDir, STAMP_FILENAME);
  if (!existsSync(stampPath)) {
    return { shouldBuild: true, reason: 'dsh-profile stamp is missing' };
  }

  try {
    const stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
    if (
      typeof stamp.profile !== 'string' ||
      stamp.profile === '' ||
      typeof stamp.content !== 'string' ||
      stamp.content === ''
    ) {
      return { shouldBuild: true, reason: 'dsh-profile stamp is incomplete' };
    }
  } catch {
    return { shouldBuild: true, reason: 'dsh-profile stamp is unreadable' };
  }

  try {
    const stamp = validateProfileDirectory(outDir);
    if (stamp.buildInputs !== dshProfileInputDigest({ packageDir, prepareScriptPath })) {
      return { shouldBuild: true, reason: 'dsh-profile inputs changed since the last build' };
    }
  } catch (error) {
    return { shouldBuild: true, reason: `dsh-profile requires rebuilding: ${error.message}` };
  }

  return {
    shouldBuild: false,
    reason:
      'dsh-profile is up to date; skipping install/build (use --force or BITFUN_DSH_PROFILE_FORCE_BUILD=1 to rebuild)',
  };
}

/**
 * Stage the built profile into HarmonyOS resfile-compatible names.
 *
 * The HarmonyOS resource bundle uses aliases for the profile's leading-dot
 * marker and `node_modules` directory. Keep the canonical desktop build
 * unchanged and normalize the names back when the Rust client materializes the
 * profile into the user's DSH home.
 *
 * @param {{ sourceDir?: string, destinationDir?: string }} [options]
 */
export function syncOhosDshProfile({
  sourceDir = OUT_DIR,
  destinationDir,
} = {}) {
  if (!destinationDir) throw new Error('An explicit OHOS profile destination is required');
  const stamp = validateProfileDirectory(sourceDir);
  try {
    if (JSON.stringify(validateProfileDirectory(destinationDir)) === JSON.stringify(stamp)) return;
  } catch {
    // A new stage or an incomplete export needs one fresh resource placement.
  }
  rmSync(destinationDir, { recursive: true, force: true });
  mkdirSync(path.dirname(destinationDir), { recursive: true });
  cpSync(sourceDir, destinationDir, { recursive: true, dereference: true });

  const stampPath = path.join(destinationDir, STAMP_FILENAME);
  if (existsSync(stampPath)) {
    renameSync(stampPath, path.join(destinationDir, OHOS_STAMP_FILENAME));
  }

  const nodeModules = path.join(destinationDir, NODE_MODULES_DIR);
  if (existsSync(nodeModules)) {
    renameSync(nodeModules, path.join(destinationDir, OHOS_NODE_MODULES_DIR));
  }
}

/**
 * Run a command in the bridge package directory.
 * @param {string} command - the executable to run.
 * @param {string[]} args - its arguments.
 * @returns {number} the exit status, with a missing status treated as a failure.
 */
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: PACKAGE_DIR,
    shell: process.platform === 'win32',
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
  });
  return result.status ?? 1;
}

/**
 * Fail the build, saying what to do about it.
 * @param {string} message - what went wrong.
 * @param {number} status - the exit status to propagate.
 */
function fail(message, status) {
  process.stderr.write(`[dsh-profile] ${message}\n`);
  process.stderr.write(
    '[dsh-profile] fix profile preparation before packaging\n',
  );
  process.exit(status === 0 ? 1 : status);
}

export function prepareDshProfile({ destinationDir, required = false, force = false } = {}) {
  if (process.env.BITFUN_SKIP_DSH_PROFILE === '1') {
    if (required) throw new Error('Packaging requires the DSH profile; BITFUN_SKIP_DSH_PROFILE cannot be used');
    process.stdout.write('[dsh-profile] skipped (this build ships no DeepSeek bridge)\n');
    rmSync(OUT_DIR, { recursive: true, force: true });
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(path.join(OUT_DIR, 'NOT-BUILT.md'), PLACEHOLDER);
    if (destinationDir) syncOhosDshProfile({ destinationDir });
    return;
  }

  force ||= process.env.BITFUN_DSH_PROFILE_FORCE_BUILD === '1';
  const plan = getDshProfileRebuildPlan({ force });
  if (!plan.shouldBuild) {
    process.stdout.write(`[dsh-profile] ${plan.reason}\n`);
    if (destinationDir) syncOhosDshProfile({ destinationDir });
    return;
  }
  process.stdout.write(`[dsh-profile] ${plan.reason}\n`);

  if (!existsSync(DEPS_PROBE)) {
    process.stdout.write('[dsh-profile] installing the harness toolchain from package-lock.json\n');
    const installed = run('npm', ['ci', '--no-audit', '--no-fund']);
    if (installed !== 0) fail('npm ci failed', installed);
  }

  const compiled = run('npm', ['run', 'build']);
  if (compiled !== 0) fail('tsc failed', compiled);

  const packaged = run('node', ['scripts/build-profile.mjs', '--from-local']);
  if (packaged !== 0) fail('profile packaging failed', packaged);

  const stampPath = path.join(OUT_DIR, STAMP_FILENAME);
  const stamp = validateProfileDirectory(OUT_DIR);
  stamp.buildInputs = dshProfileInputDigest();
  writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`);
  if (destinationDir) syncOhosDshProfile({ destinationDir });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    force: { type: 'boolean' }, required: { type: 'boolean' }, 'ohos-out': { type: 'string' },
  } });
  prepareDshProfile({ destinationDir: values['ohos-out'] && resolve(values['ohos-out']), required: values.required, force: values.force });
}
