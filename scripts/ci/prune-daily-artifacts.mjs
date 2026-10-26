#!/usr/bin/env node
// Prune old daily workflow artifacts from the GitCode artifact store.
//
// Usage: prune-daily-artifacts.mjs <owner/repo> <keep-days> <name-prefix>
//   (GITCODE_TOKEN required)
//
// Lists the repository's workflow artifacts (GitCode API v8) and deletes
// those whose name starts with <name-prefix> and whose creation is older
// than <keep-days> days, keeping nightly artifacts inside the 1G namespace
// quota. Artifacts without a parseable creation date are kept (safe side).
// A 404 from the listing endpoint means the API surface is unavailable on
// this GitCode deployment; the script then warns and exits 0 so the pipeline
// stays green while retention is not enforced. Any other failure is loud.

const [repository, rawKeepDays, namePrefix] = process.argv.slice(2);
const token = process.env.GITCODE_TOKEN;

if (!repository || !rawKeepDays || !namePrefix || !token) {
  console.error(
    'Usage: prune-daily-artifacts.mjs <owner/repo> <keep-days> <name-prefix> (GITCODE_TOKEN required)',
  );
  process.exit(2);
}

const keepDays = Number.parseInt(rawKeepDays, 10);
if (!Number.isFinite(keepDays) || keepDays < 1) {
  console.error(`Invalid keep-days value: ${rawKeepDays}`);
  process.exit(2);
}

const repositoryParts = repository.split('/');
if (repositoryParts.length !== 2 || repositoryParts.some((part) => !part)) {
  throw new Error(`Invalid GitCode repository: ${repository}`);
}

const [owner, repo] = repositoryParts.map(encodeURIComponent);
const apiRoot = `https://gitcode.com/api/v8/repos/${owner}/${repo}`;

function apiUrl(pathname, params = {}) {
  const url = new URL(`${apiRoot}${pathname}`);
  url.searchParams.set('access_token', token);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function responseValue(response, operation) {
  const text = await response.text();
  let value;
  try {
    value = text ? JSON.parse(text) : undefined;
  } catch {
    value = text;
  }
  if (!response.ok) {
    throw new Error(
      `${operation} failed (${response.status}): ${typeof value === 'string' ? value : JSON.stringify(value)}`,
    );
  }
  return value;
}

function artifactsFrom(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.artifacts)) return value.artifacts;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function artifactCreatedMs(artifact) {
  const raw = artifact.created_at ?? artifact.createdAt ?? artifact.updated_at;
  if (typeof raw === 'number') {
    // Epoch seconds or milliseconds.
    return raw > 1e12 ? raw : raw * 1000;
  }
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

let artifacts;
try {
  artifacts = [];
  for (let page = 1; page <= 100; page += 1) {
    const value = await responseValue(
      await fetch(apiUrl('/actions/artifacts', { per_page: 100, page }), {
        headers: { Accept: 'application/json' },
      }),
      `List artifacts page ${page}`,
    );
    const pageArtifacts = artifactsFrom(value);
    artifacts.push(...pageArtifacts);
    if (pageArtifacts.length < 100) break;
  }
} catch (error) {
  if (String(error).includes('(404)')) {
    console.log(
      '[prune] The repository artifact listing endpoint is unavailable (404); ' +
        'retention is not enforced on this GitCode deployment and all artifacts were kept.',
    );
    process.exit(0);
  }
  throw error;
}

const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
const stale = [];
const kept = [];
let untouched = 0;
for (const artifact of artifacts) {
  if (
    typeof artifact.name !== 'string' ||
    !artifact.name.startsWith(namePrefix) ||
    artifact.id === undefined
  ) {
    untouched += 1;
    continue;
  }
  const createdMs = artifactCreatedMs(artifact);
  if (createdMs !== null && createdMs < cutoff) {
    stale.push(artifact);
  } else {
    kept.push(artifact);
  }
}

for (const artifact of stale) {
  await responseValue(
    await fetch(apiUrl(`/actions/artifacts/${encodeURIComponent(artifact.id)}`), {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    }),
    `Delete artifact ${artifact.id}`,
  );
  console.log(`[prune] Deleted ${artifact.name}.`);
}

console.log(
  `[prune] ${stale.length} deleted, ${kept.length} kept inside the ${keepDays}-day window, ` +
    `${untouched} untouched (other names or unparseable).`,
);
