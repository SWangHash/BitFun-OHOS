#!/usr/bin/env node
import {
  artifactRunId,
  artifactsFrom,
  createArtifactsApi,
  parseRepository,
} from './gitcode-artifacts-api.mjs';

const [repository, runId] = process.argv.slice(2);
const token = process.env.GITCODE_TOKEN;

if (!repository || !runId || !token) {
  console.error(
    'Usage: delete-gitcode-workflow-artifacts.mjs <owner/repo> <run-id> (GITCODE_TOKEN required)',
  );
  process.exit(2);
}

const [owner, repo] = parseRepository(repository);
const api = createArtifactsApi(token, owner, repo);
// The workflow-run scoped list endpoint is important here: it prevents
// cleanup from touching artifacts belonging to another run with a similar
// name.

async function listArtifacts() {
  const artifacts = [];
  for (let page = 1; page <= 100; page += 1) {
    const value = await api.value(
      await fetch(api.url(`/actions/runs/${encodeURIComponent(runId)}/artifacts`, {
        per_page: 100,
        page,
      }), { headers: { Accept: 'application/json' } }),
      `List artifacts for workflow run ${runId}`,
    );
    const pageArtifacts = artifactsFrom(value);
    artifacts.push(...pageArtifacts);
    if (pageArtifacts.length < 100) break;
  }
  return artifacts;
}

const artifacts = (await listArtifacts()).filter((artifact) => {
  const id = artifactRunId(artifact);
  return id !== undefined && String(id) === String(runId) && artifact.id !== undefined;
});

if (artifacts.length === 0) {
  console.log(`No artifacts found for workflow run ${runId}.`);
  process.exit(0);
}

for (const artifact of artifacts) {
  await api.value(
    await fetch(api.url(`/actions/artifacts/${encodeURIComponent(artifact.id)}`), {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    }),
    `Delete artifact ${artifact.id}`,
  );
  console.log(`Deleted workflow artifact ${artifact.name ?? artifact.id}.`);
}

console.log(`Deleted ${artifacts.length} artifact(s) for workflow run ${runId}.`);
