#!/usr/bin/env node
// Prune stale daily workflow artifacts from the GitCode artifact store.
//
// Usage: prune-daily-artifacts.mjs <owner/repo> <name-prefix>
//   (GITCODE_TOKEN required)
//
// Daily artifacts are named <name-prefix>YYYYMMDD-<platform> by the
// packaging workflow. This deletes every artifact whose embedded date is
// not today (Asia/Shanghai), so a stale day can never hold the 1G quota
// hostage while the new day uploads. Run it BEFORE the daily builds; a
// same-day rerun keeps the current day's artifacts. Names that do not embed
// a parseable date are kept (safe side). Any API failure fails the job
// loudly: retention silently not working would only surface days later as
// quota exhaustion.

import { artifactsFrom, createArtifactsApi, parseRepository } from './gitcode-artifacts-api.mjs';

const [repository, namePrefix] = process.argv.slice(2);
const token = process.env.GITCODE_TOKEN;

if (!repository || !namePrefix || !token) {
  console.error(
    'Usage: prune-daily-artifacts.mjs <owner/repo> <name-prefix> (GITCODE_TOKEN required)',
  );
  process.exit(2);
}

function todayCompact() {
  // en-CA formats as YYYY-MM-DD; strip the dashes for YYYYMMDD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replace(/-/g, '');
}

function embeddedDate(name) {
  if (!name.startsWith(namePrefix)) return null;
  const digits = name.slice(namePrefix.length, namePrefix.length + 8);
  return /^\d{8}$/.test(digits) ? digits : null;
}

try {
  const [owner, repo] = parseRepository(repository);
  const api = createArtifactsApi(token, owner, repo);

  // Page until an EMPTY page: the server may cap the page size below the
  // requested per_page, so a "short page" cannot signal the end.
  const artifacts = [];
  for (let page = 1; page <= 100; page += 1) {
    const value = await api.value(
      await fetch(api.url('/actions/artifacts', { per_page: 100, page }), {
        headers: { Accept: 'application/json' },
      }),
      `List artifacts page ${page}`,
    );
    const pageArtifacts = artifactsFrom(value);
    if (pageArtifacts.length === 0) break;
    artifacts.push(...pageArtifacts);
  }

  const today = todayCompact();
  const stale = [];
  const kept = [];
  let untouched = 0;
  for (const artifact of artifacts) {
    if (typeof artifact.name !== 'string' || artifact.id === undefined) {
      untouched += 1;
      continue;
    }
    const date = embeddedDate(artifact.name);
    if (date === null) {
      untouched += 1;
      continue;
    }
    if (date === today) {
      kept.push(artifact);
    } else {
      stale.push(artifact);
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
    `[prune] ${stale.length} deleted, ${kept.length} kept (today ${today}), ` +
      `${untouched} untouched (other names or unparseable).`,
  );
} catch (error) {
  console.error(`::error::Daily artifact retention failed: ${error.message}`);
  console.error('The 1G artifact quota will fill up if this keeps failing.');
  process.exit(1);
}
