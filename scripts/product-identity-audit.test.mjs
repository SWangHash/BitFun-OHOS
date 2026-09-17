import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  auditFile,
  auditRepository,
  listRepositoryFiles,
  normalizeRepositoryPath,
  shouldAuditContent,
  shouldAuditPath,
} from './product-identity-audit.mjs';

const displayBrand = `${'Bit'}${'Fun'}`;
const shortPrefix = `${'b'}${'f'}`;

function violationsFor(content, file = 'src/example.ts') {
  return auditFile({ file, content });
}

test('accepts the canonical product identity in supported casing and contracts', () => {
  const source = [
    'BitFun',
    'bitFunTheme',
    'bitfun',
    'BITFUN_USER_ROOT',
    '@bitfun/ui',
    '.bitfun/config',
    'bitfun://runtime/',
    '--bitfun-color-surface',
    'data-bitfun-component',
    'node.dataset.bitfunPart',
    '@layer bitfun.components',
    'minBitFunVersion: "1.0.0"',
    'min_bitfun_version: "1.2.0"',
    'bitfun-cli-1.0.0-aarch64-unknown-linux-gnu.tar.gz',
    'BitFun_1.0.0_windows-x86_64-setup.exe',
    displayBrand,
    'BitFun Remote',
    'Ask BitFun',
    'bitfun',
    'com.bitfun.desktop',
    'BITFUN_USER_ROOT',
  ].join('\n');

  assert.deepEqual(violationsFor(source), []);
});

test('rejects non-canonical casing and abbreviated BitFun names', () => {
  const nonCanonicalPascal = ['Open', 'Bit', 'fun'].join('');
  const nonCanonicalCamel = ['open', 'Bit', 'fun'].join('');
  const abbreviatedPascal = ['Open', 'B', 'F'].join('');
  const abbreviatedCli = `${['open', 'b', 'f'].join('')}-cli`;
  const source = [
    nonCanonicalPascal,
    nonCanonicalCamel,
    abbreviatedPascal,
    abbreviatedCli,
  ].join('\n');

  assert.deepEqual(
    violationsFor(source).map((violation) => violation.rule),
    [
      'noncanonical-bitfun-casing',
      'noncanonical-bitfun-casing',
      'abbreviated-bitfun-name',
      'abbreviated-bitfun-name',
    ],
  );
});

test('accepts the BitFun display brand in user-facing copy and identifiers', () => {
  const lowerBrand = displayBrand.toLowerCase();
  const source = [
    displayBrand,
    `${displayBrand} Remote`,
    `Ask ${displayBrand}`,
    `${lowerBrand}/config`,
    `${lowerBrand}://runtime/`,
  ].join('\n');

  assert.deepEqual(violationsFor(source), []);
});

test('rejects retired short CSS, DOM, dataset, layer, and environment prefixes', () => {
  const source = [
    `--${shortPrefix}-surface: white;`,
    `data-${shortPrefix}-component="button"`,
    `element.dataset.${shortPrefix}Part = 'root';`,
    `element.dataset['${shortPrefix}State'] = 'active';`,
    `@layer ${shortPrefix}.components;`,
    `${shortPrefix.toUpperCase()}_E2E_HOME=/tmp/example`,
  ].join('\n');

  const rules = violationsFor(source).map((violation) => violation.rule);
  assert.deepEqual(rules, [
    'retired-css-token-prefix',
    'retired-dom-attribute-prefix',
    'retired-dataset-property-prefix',
    'retired-dataset-property-prefix',
    'retired-css-layer-prefix',
    'retired-environment-prefix',
  ]);
});

test('scans untracked files while ignoring tracked files deleted by a rename', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'bitfun-identity-audit-'));
  const brandDirectory = path.join(root, 'legacy', displayBrand.toLowerCase());
  const brandFile = path.join(brandDirectory, 'config.json');
  const canonicalFile = path.join(root, 'bitfun', 'config.json');
  mkdirSync(brandDirectory, { recursive: true });
  mkdirSync(path.dirname(canonicalFile), { recursive: true });
  writeFileSync(brandFile, '{}\n');
  writeFileSync(canonicalFile, '{"product":"BitFun"}\n');
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  rmSync(brandFile);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.deepEqual(listRepositoryFiles(root), ['bitfun/config.json']);
  assert.deepEqual(auditRepository(root).violations, []);

  mkdirSync(brandDirectory, { recursive: true });
  writeFileSync(brandFile, '{}\n');
  assert.deepEqual(auditRepository(root).violations, []);
});

test('does not confuse unrelated abbreviations, issue ids, or hashes with product identity', () => {
  const source = [
    'BFF',
    'BFS',
    'BF-123',
    'sha256:46bf68c6409f',
    'buffer.slice(0, 2)',
    'const bf = bestFit;',
  ].join('\n');

  assert.deepEqual(violationsFor(source), []);
});

test('rejects a parallel identity-version label while keeping schema version one valid', () => {
  const parallelLabel = ['Product', 'Identity', 'v2'].join(' ');
  const violations = violationsFor(`${parallelLabel}\nschemaVersion: 1`);

  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'parallel-identity-version');
});

test('keeps compile-time product identity reads in the canonical contract owner', () => {
  const source = [
    'const PRODUCT_ID: &str = option_',
    'en',
    'v!("BITFUN_PRODUCT_ID").unwrap_or("bitfun");',
  ].join('');
  const violations = violationsFor(source, 'src/example.rs');

  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'duplicate-product-identity-owner');
  assert.deepEqual(
    violationsFor(source, 'src/crates/contracts/core-types/src/product_identity.rs'),
    [],
  );
});

test('rejects pre-1.0 minimum versions and BitFun release assets', () => {
  const preOneVersion = [0, 9, 0].join('.');
  const source = [
    `minBitFunVersion: '${preOneVersion}'`,
    `min_bitfun_version: "${preOneVersion}"`,
    `bitfun-cli-${preOneVersion}-aarch64-unknown-linux-gnu.tar.gz`,
    `BitFun_${preOneVersion}_windows-x86_64-setup.exe`,
  ].join('\n');

  assert.deepEqual(
    violationsFor(source).map((violation) => violation.rule),
    [
      'pre-1.0-bitfun-minimum-version',
      'pre-1.0-bitfun-minimum-version',
      'pre-1.0-bitfun-release-asset',
      'pre-1.0-bitfun-release-asset',
    ],
  );
});

test('normalizes Windows separators and skips dependency and generated output roots', () => {
  assert.equal(normalizeRepositoryPath('src\\web-ui\\index.ts'), 'src/web-ui/index.ts');
  assert.equal(shouldAuditPath('packages/ui/src/index.ts'), true);
  assert.equal(shouldAuditContent('packages/ui/src/index.ts'), true);

  for (const file of [
    'node_modules/example/index.js',
    'target/debug/generated.rs',
    'src/web-ui/dist/index.js',
    'docs/superpowers/archive.md',
    'src/web-ui/public/monaco-editor/vs/loader.js',
  ]) {
    assert.equal(shouldAuditPath(file), false, file);
    assert.equal(shouldAuditContent(file), false, file);
  }
});
