#!/usr/bin/env node
// Prune old daily workflow artifacts from the GitCode artifact store.
//
// Usage: prune-daily-artifacts.mjs <owner/repo> <keep-days> <name-prefix>
//   (GITCODE_TOKEN required)
//
// Lists the repository's workflow artifacts and deletes those whose name
// starts with <name-prefix> and whose creation is older than <keep-days>
// days, keeping nightly artifacts inside the 1G namespace quota. Artifacts
// without a parseable creation date are kept (safe side). Any API failure
// fails the job loudly: retention silently not working would only surface
// days later as quota exhaustion.

import { artifactsFrom, createArtifactsApi, parseRepository } from './gitcode-artifacts-api.mjs';

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

try {
  const [owner, repo] = parseRepository(repository);
  const api = createArtifactsApi(token, owner, repo);

  const artifacts = [];
  for (let page = 1; page <= 100; page += 1) {
    const value = await api.value(
      await fetch(api.url('/actions/artifacts', { per_page: 100, page }), {
        headers: { Accept: 'application/json' },
      }),
      `List artifacts page ${page}`,
    );
    const pageArtifacts = artifactsFrom(value);
    artifacts.push(...pageArtifacts);
    if (pageArtifacts.length < 100) break;
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
    await api.value(
      await fetch(api.url(`/actions/artifacts/${encodeURIComponent(artifact.id)}`), {
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
} catch (error) {
  console.error(`::error::Daily artifact retention failed: ${error.message}`);
  console.error('The 1G artifact quota will fill up if this keeps failing.');
  process.exit(1);
}
