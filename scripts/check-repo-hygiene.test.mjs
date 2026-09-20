import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const checker = fileURLToPath(new URL('./check-repo-hygiene.mjs', import.meta.url));
const localOnlyPaths = [
  'package-lock.json',
  'BitFun-Installer/package-lock.json',
  'src/mobile-web/package-lock.json',
  'tests/e2e/package-lock.json',
  'BitFun-Installer/src-tauri/Cargo.lock',
  'BitFun-Installer/src-tauri/gen/schemas/capabilities.json',
  'docs/superpowers/plans/local.md',
];

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'bitfun-repo-hygiene-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  const write = (relative, content = '{}\n') => {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  const commit = () => git(
    '-c', 'user.name=Repository Tests', '-c', 'user.email=tests@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture',
  );
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  write('.gitignore', `${localOnlyPaths.map(file => `/${file}`).join('\n')}\n`);
  for (const file of [
    'pnpm-lock.yaml',
    'Cargo.lock',
    'packages/dsh-acp/package-lock.json',
    'src/apps/extension-host/bun.lock',
    'src/apps/mobile/harmonyos/oh-package-lock.json5',
    'BitFun-Installer/src-tauri/capabilities/default.json',
  ]) write(file);
  git('add', '.');
  commit();
  const check = () => spawnSync(process.execPath, [checker], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  return { git, write, commit, check };
}

test('allows production lockfiles and ignored local build/process artifacts', t => {
  const repo = fixture(t);
  for (const file of localOnlyPaths) repo.write(file);
  const result = repo.check();
  assert.equal(result.status, 0, result.stderr);
});

test('rejects local-only artifacts even when force-added past gitignore', t => {
  const repo = fixture(t);
  for (const file of localOnlyPaths) repo.write(file);
  repo.git('add', '-f', '--', ...localOnlyPaths);
  const result = repo.check();
  assert.equal(result.status, 1, result.stdout);
  for (const file of localOnlyPaths) assert.ok(result.stderr.includes(file), file);
});

test('checks tracked storage policy beyond the latest commit content', t => {
  const repo = fixture(t);
  repo.write('package-lock.json');
  repo.git('add', '-f', '--', 'package-lock.json');
  repo.commit();
  repo.write('README.md', '# Current project\n');
  repo.git('add', 'README.md');
  repo.commit();
  const result = repo.check();
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /package-lock\.json duplicates the workspace/);
});
