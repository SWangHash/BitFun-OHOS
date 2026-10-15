#!/usr/bin/env node

// Upload package artifacts (.hap/.so) to a GitCode release.
// Usage: publish-gitcode-release.mjs <tag> <owner/repo> <assets-dir>
//   [target-branch] [packaged-commit]
//   GITCODE_TOKEN env var is required (GitCode personal access token).
// Idempotent: an existing release is reused and already-present asset
// names are skipped.

import { createReadStream, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const ASSET_EXTENSIONS = new Set(['.hap', '.app', '.so', '.zip', '.gz']);

const [rawTag, repository, assetsDir, targetBranch, packagedCommit] = process.argv.slice(2);
const token = process.env.GITCODE_TOKEN;

if (!rawTag || !repository || !assetsDir) {
  console.error(
    'Usage: publish-gitcode-release.mjs <tag> <owner/repo> <assets-dir> [target-branch] [packaged-commit] (GITCODE_TOKEN required)',
  );
  process.exit(2);
}
if (!token) {
  console.error('GITCODE_TOKEN is required to publish a GitCode release.');
  process.exit(2);
}

// Keep existing styles (oh_v1.0.0 / v1.0.0) as-is; prefix bare versions.
const tag = /^(oh_)?v/.test(rawTag) ? rawTag : `v${rawTag}`;
const repositoryParts = repository.split('/');
if (repositoryParts.length !== 2 || repositoryParts.some((part) => !part)) {
  throw new Error(`Invalid GitCode repository: ${repository}`);
}

const [owner, repo] = repositoryParts.map(encodeURIComponent);
const apiRoot = `https://gitcode.com/api/v5/repos/${owner}/${repo}`;
const releaseStatus = tag.includes('-') ? 'pre' : 'latest';
const releaseName = tag;
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
      name: releaseName,
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
    name: releaseName,
    body: releaseBody,
    release_status: releaseStatus,
  };
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
  throw new Error(`No .hap/.so artifacts found in ${assetsDir}`);
}
const existingNames = new Set(
  (release?.assets ?? []).map((asset) => asset.name).filter(Boolean),
);
for (const asset of assets) {
  await uploadAsset(asset, existingNames);
}
