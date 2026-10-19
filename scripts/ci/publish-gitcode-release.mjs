#!/usr/bin/env node

// Upload package artifacts to a GitCode release.
// Usage: publish-gitcode-release.mjs <tag> <owner/repo> <assets-dir>
//   [target-branch] [packaged-commit] [release-title] [asset-extensions]
//   GITCODE_TOKEN env var is required (GitCode personal access token).
// The asset extension allowlist defaults to "hap,app"; desktop pipelines
// pass e.g. "exe" (NSIS installer) or "dmg". The release title defaults
// to the tag; it only changes when an explicit non-empty title is passed,
// so re-runs without one keep the current title.
// Idempotent: an existing release is reused and already-present asset
// names are skipped.

import { createReadStream, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const [rawTag, repository, assetsDir, targetBranch, packagedCommit, rawTitle, rawExtensions] = process.argv.slice(2);
const token = process.env.GITCODE_TOKEN;

if (!rawTag || !repository || !assetsDir) {
  console.error(
    'Usage: publish-gitcode-release.mjs <tag> <owner/repo> <assets-dir> [target-branch] [packaged-commit] [release-title] [asset-extensions=hap,app] (GITCODE_TOKEN required)',
  );
  process.exit(2);
}

// Use the tag exactly as provided; no automatic version prefixing.
const tag = rawTag;
// Light git-refname validation: tags must be valid git refs.
if (/[\s~^:?*[\]\\]/.test(tag) || tag.startsWith('-') || tag.endsWith('.lock')) {
  console.error(
    `Invalid tag name: ${tag} (git refname rules: no spaces or ~^:?*[]\\ characters, no leading '-', no trailing '.lock')`,
  );
  process.exit(2);
}
if (!token) {
  console.error('GITCODE_TOKEN is required to publish a GitCode release.');
  process.exit(2);
}

// Asset extension allowlist (leading dots tolerated): "hap,app" default,
// desktop pipelines pass e.g. "exe" or "dmg".
const ASSET_EXTENSIONS = new Set(
  (rawExtensions && rawExtensions.trim() ? rawExtensions.trim() : 'hap,app')
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((ext) => `.${ext.replace(/^\./, '').toLowerCase()}`),
);
if (ASSET_EXTENSIONS.size === 0 || [...ASSET_EXTENSIONS].some((ext) => !/^\.[a-z0-9]+$/.test(ext))) {
  console.error(`Invalid asset extensions: ${rawExtensions} (expected comma-separated letters/digits, e.g. exe,dmg)`);
  process.exit(2);
}
const repositoryParts = repository.split('/');
if (repositoryParts.length !== 2 || repositoryParts.some((part) => !part)) {
  throw new Error(`Invalid GitCode repository: ${repository}`);
}

const [owner, repo] = repositoryParts.map(encodeURIComponent);
const apiRoot = `https://gitcode.com/api/v5/repos/${owner}/${repo}`;
const releaseStatus = tag.includes('-') ? 'pre' : 'latest';
// Title is only sent when explicitly provided; the GitCode API then keeps
// the existing title on updates and defaults to the tag on creation.
const releaseName = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim() : undefined;
const releaseBody = `Release ${tag} package assets produced by the OHOS package workflow.`;

function isUsableCommitSha(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{40}$/i.test(value)
    && !/^0{40}$/.test(value);
}

// The workflow passes the exact commit the artifacts were built from
// (packaged-commit.txt) so the release tag points at the packaged state
// even when the branch moves afterwards; fall back to the branch name.
const targetCommitish = isUsableCommitSha(packagedCommit)
  ? packagedCommit
  : targetBranch;

function apiUrl(pathname, params = {}) {
  const url = new URL(`${apiRoot}${pathname}`);
  url.searchParams.set('access_token', token);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function readResponse(response, operation) {
  const text = await response.text();
  let value;
  try {
    value = text ? JSON.parse(text) : undefined;
  } catch {
    value = text;
  }
  if (!response.ok) {
    throw new Error(
      `${operation} failed (${response.status}): ${
        typeof value === 'string' ? value : JSON.stringify(value)
      }`,
    );
  }
  return value;
}

async function getRelease() {
  const response = await fetch(apiUrl(`/releases/${encodeURIComponent(tag)}`), {
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404) return undefined;
  return readResponse(response, `Get release ${tag}`);
}

async function ensureRelease() {
  let release = await getRelease();
  if (!release) {
    const payload = {
      tag_name: tag,
      // GitCode's create endpoint requires name (400 "name不能为空");
      // default it to the tag when no explicit title was provided.
      name: releaseName || tag,
      body: releaseBody,
      release_status: releaseStatus,
    };
    // Point the new tag at the packaged commit (or branch) when provided.
    if (targetCommitish) {
      payload.target_commitish = targetCommitish;
    }
    const response = await fetch(apiUrl('/releases'), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    release = await readResponse(response, `Create release ${tag}`);
    console.log(`Created GitCode release ${tag} (target: ${targetCommitish || 'default branch'})`);
    return release;
  }

  const payload = {
    body: releaseBody,
    release_status: releaseStatus,
  };
  if (releaseName) {
    payload.name = releaseName;
  }
  if (targetCommitish) {
    payload.target_commitish = targetCommitish;
  }
  const response = await fetch(apiUrl(`/releases/${encodeURIComponent(tag)}`), {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  release = await readResponse(response, `Update release ${tag}`);
  console.log(`Using existing GitCode release ${tag}`);
  return release;
}

async function uploadAsset(fileName, existingNames) {
  if (existingNames.has(fileName)) {
    console.log(`Release asset already exists, skipping: ${fileName}`);
    return;
  }
  const response = await fetch(
    apiUrl(`/releases/${encodeURIComponent(tag)}/upload_url`, { file_name: fileName }),
    { headers: { Accept: 'application/json' } },
  );
  const upload = await readResponse(response, `Get upload URL for ${fileName}`);
  if (!upload?.url || !upload?.headers) {
    throw new Error(`GitCode returned an invalid upload URL for ${fileName}`);
  }
  const headers = { ...upload.headers };
  headers['Content-Length'] = String(statSync(path.join(assetsDir, fileName)).size);
  const uploadResponse = await fetch(upload.url, {
    method: 'PUT',
    headers,
    body: createReadStream(path.join(assetsDir, fileName)),
    duplex: 'half',
  });
  await readResponse(uploadResponse, `Upload release asset ${fileName}`);
  console.log(`Uploaded release asset: ${fileName}`);
}

const release = await ensureRelease();
const assets = (await readdir(assetsDir, { withFileTypes: true }))
  .filter(
    (entry) => entry.isFile() && ASSET_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
  )
  .map((entry) => entry.name)
  .sort();
if (assets.length === 0) {
  throw new Error(`No ${[...ASSET_EXTENSIONS].join('/')} artifacts found in ${assetsDir}`);
}
const existingNames = new Set(
  (release?.assets ?? []).map((asset) => asset.name).filter(Boolean),
);
for (const asset of assets) {
  await uploadAsset(asset, existingNames);
}
