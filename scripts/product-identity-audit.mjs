#!/usr/bin/env node

/**
 * Keep product identity usage canonical.
 *
 * The product display brand is BitFun (renamed from BitFun). BitFun
 * remains the canonical form for code identifiers, CSS tokens, data
 * attributes, and storage keys. This audit rejects non-canonical casings and
 * abbreviated spellings of BitFun, plus identity-owner and version-label
 * violations.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');

const shortPrefix = `${'b'}${'f'}`;
const productIdentityOwner = 'src/crates/contracts/core-types/src/product_identity.rs';
const noncanonicalIdentityDataBoundaryFiles = new Set([
  'BITFUN_LEGACY_DATA_MIGRATION_INVENTORY.md',
  'deploy/bitfun-host/migrate-market-data-v1.py',
]);

const identityRules = Object.freeze([
  Object.freeze({
    id: 'noncanonical-bitfun-casing',
    description: 'non-canonical BitFun casing',
    pattern: /bitfun/giu,
    isViolation: (value) => !['BitFun', 'bitFun', 'bitfun', 'BITFUN'].includes(value),
    allowedFiles: noncanonicalIdentityDataBoundaryFiles,
  }),
  Object.freeze({
    id: 'abbreviated-bitfun-name',
    description: 'abbreviated BitFun product name',
    pattern: /\bopen[\s_-]*bf\b/giu,
  }),
  Object.freeze({
    id: 'retired-css-token-prefix',
    description: 'retired CSS custom-property prefix',
    pattern: new RegExp(`--${shortPrefix}-`, 'giu'),
  }),
  Object.freeze({
    id: 'retired-dom-attribute-prefix',
    description: 'retired DOM data-attribute prefix',
    pattern: new RegExp(`data-${shortPrefix}-`, 'giu'),
  }),
  Object.freeze({
    id: 'retired-dataset-property-prefix',
    description: 'retired dataset property prefix',
    pattern: new RegExp(
      `\\bdataset\\s*(?:\\.\\s*${shortPrefix}(?=[A-Z0-9_]|\\b)|\\[\\s*['\"]${shortPrefix}(?=[A-Z0-9_-]|['\"]))`,
      'giu',
    ),
  }),
  Object.freeze({
    id: 'retired-css-layer-prefix',
    description: 'retired CSS layer prefix',
    pattern: new RegExp(`@layer\\s+${shortPrefix}(?=[.\\s,{;]|$)`, 'giu'),
  }),
  Object.freeze({
    id: 'retired-environment-prefix',
    description: 'retired environment-variable prefix',
    pattern: new RegExp(`\\b${shortPrefix.toUpperCase()}_[A-Z0-9_]+\\b`, 'gu'),
  }),
  Object.freeze({
    id: 'parallel-identity-version',
    description: 'parallel product-identity version label',
    pattern: new RegExp(
      `${'product'}[\\s_-]*${'identity'}[\\s_-]*${'v2'}|${'identity'}-${'v2'}`,
      'giu',
    ),
  }),
  Object.freeze({
    id: 'duplicate-product-identity-owner',
    description: 'product identity compile-time environment read outside the canonical owner',
    pattern: /\b(?:option_)?env!\s*\(\s*["']BITFUN_(?:PRODUCT_ID|DATA_NAMESPACE|HIDDEN_DATA_DIRECTORY)["']\s*\)/gu,
    allowedFiles: new Set([productIdentityOwner]),
  }),
  Object.freeze({
    id: 'pre-1.0-bitfun-minimum-version',
    description: 'minimum BitFun version earlier than 1.0.0',
    pattern: /\b(?:minBitFunVersion|min_bitfun_version)\b\s*(?::|=)\s*['"]0\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?['"]/giu,
  }),
  Object.freeze({
    id: 'pre-1.0-bitfun-release-asset',
    description: 'BitFun release asset earlier than 1.0.0',
    pattern: /\b(?:bitfun-cli-|bitfun[_-])0\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/giu,
  }),
]);

const textExtensions = new Set([
  '.c',
  '.bat',
  '.cjs',
  '.cmd',
  '.conf',
  '.cpp',
  '.csproj',
  '.css',
  '.desktop',
  '.diff',
  '.env',
  '.ets',
  '.fish',
  '.ftl',
  '.gradle',
  '.graphql',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsonc',
  '.json5',
  '.jsx',
  '.kt',
  '.kts',
  '.lock',
  '.md',
  '.mjs',
  '.mm',
  '.nsi',
  '.pbxproj',
  '.patch',
  '.plist',
  '.properties',
  '.proto',
  '.ps1',
  '.py',
  '.rs',
  '.scss',
  '.service',
  '.sh',
  '.sln',
  '.sql',
  '.svelte',
  '.swift',
  '.svg',
  '.timer',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.wxs',
  '.xcconfig',
  '.xml',
  '.yaml',
  '.yml',
  '.zsh',
]);

const textBasenames = new Set([
  '.dockerignore',
  '.gitattributes',
  '.gitignore',
  '.gitmodules',
  'codeowners',
  'dockerfile',
  'makefile',
  'procfile',
]);

const ignoredPaths = Object.freeze([
  /(^|\/)node_modules\//,
  /(^|\/)target\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)coverage\//,
  /^docs\/superpowers\//,
  /^src\/web-ui\/public\/monaco-editor\//,
]);

export function normalizeRepositoryPath(file) {
  return file.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function shouldAuditPath(file) {
  const normalized = normalizeRepositoryPath(file);
  return !ignoredPaths.some((pattern) => pattern.test(normalized));
}

export function shouldAuditContent(file) {
  const normalized = normalizeRepositoryPath(file);
  if (!shouldAuditPath(normalized)) {
    return false;
  }

  const basename = path.posix.basename(normalized).toLowerCase();
  return textExtensions.has(path.posix.extname(basename).toLowerCase())
    || textBasenames.has(basename)
    || basename.startsWith('dockerfile.');
}

function collectMatches(value, location) {
  const violations = [];

  for (const rule of identityRules) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    for (const match of value.matchAll(pattern)) {
      if (rule.allowedMatch?.({ match: match[0], location })) {
        continue;
      }
      if (rule.allowedFiles?.has(location.file)) {
        continue;
      }
      if (rule.allowedFilePrefixes?.some((prefix) => location.file.startsWith(prefix))) {
        continue;
      }
      if (rule.isViolation && !rule.isViolation(match[0])) {
        continue;
      }
      violations.push({
        ...location,
        column: (match.index ?? 0) + 1,
        rule: rule.id,
        description: rule.description,
        match: match[0],
      });
    }
  }

  return violations;
}

export function auditFile({ file, content }) {
  const normalized = normalizeRepositoryPath(file);
  if (!shouldAuditPath(normalized)) {
    return [];
  }

  const violations = collectMatches(normalized, {
    file: normalized,
    location: 'path',
    line: null,
  });

  if (!shouldAuditContent(normalized) || content === undefined) {
    return violations;
  }

  const lines = String(content).split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    violations.push(...collectMatches(line, {
      file: normalized,
      location: 'content',
      line: index + 1,
      lineText: line,
    }));
  }

  return violations;
}

export function listRepositoryFiles(root = repositoryRoot) {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  return [...new Set(output.split('\0').filter(Boolean).map(normalizeRepositoryPath))]
    .filter((file) => {
      const absolutePath = path.join(root, file);
      return existsSync(absolutePath) && statSync(absolutePath).isFile();
    })
    .sort((left, right) => left.localeCompare(right, 'en'));
}

export function auditRepository(root = repositoryRoot) {
  const files = listRepositoryFiles(root);
  const violations = [];
  let contentFilesScanned = 0;

  for (const file of files) {
    if (!shouldAuditPath(file)) {
      continue;
    }

    let content;
    if (shouldAuditContent(file)) {
      content = readFileSync(path.join(root, file), 'utf8');
      contentFilesScanned += 1;
    }
    violations.push(...auditFile({ file, content }));
  }

  return {
    filesChecked: files.length,
    contentFilesScanned,
    violations,
  };
}

function formatViolation(violation) {
  const position = violation.location === 'content'
    ? `${violation.file}:${violation.line}:${violation.column}`
    : violation.file;
  return `${position} ${violation.description} (${violation.rule})`;
}

function main() {
  const report = auditRepository(repositoryRoot);

  if (report.violations.length > 0) {
    console.error('BitFun product identity audit failed:');
    for (const violation of report.violations) {
      console.error(`- ${formatViolation(violation)}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `BitFun product identity audit passed (${report.contentFilesScanned} text files scanned, ${report.filesChecked} repository files checked).`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
