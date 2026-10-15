#!/usr/bin/env node

const [repository, runId] = process.argv.slice(2);
const token = process.env.GITCODE_TOKEN;

if (!repository || !runId || !token) {
  console.error(
    'Usage: delete-gitcode-workflow-artifacts.mjs <owner/repo> <run-id> (GITCODE_TOKEN required)',
  );
  process.exit(2);
}

const repositoryParts = repository.split('/');
if (repositoryParts.length !== 2 || repositoryParts.some((part) => !part)) {
  throw new Error(`Invalid GitCode repository: ${repository}`);
}

const [owner, repo] = repositoryParts.map(encodeURIComponent);
// GitCode's Actions artifact endpoints are documented under API v8 on the
// api.gitcode.com host (gitcode.com/api/v8 does not expose them). The
// workflow-run scoped list endpoint is important here: it prevents cleanup
// from touching artifacts belonging to another run with a similar name.
const apiRoot = `https://api.gitcode.com/api/v8/repos/${owner}/${repo}`;

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

function artifactRunId(artifact) {
  return artifact.workflow_run_id
    ?? artifact.run_id
    ?? artifact.workflow_run?.id
    ?? artifact.workflowRun?.id;
}

async function listArtifacts() {
  const artifacts = [];
  for (let page = 1; page <= 100; page += 1) {
    const value = await responseValue(
      await fetch(apiUrl(`/actions/runs/${encodeURIComponent(runId)}/artifacts`, {
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
  await responseValue(
    await fetch(apiUrl(`/actions/artifacts/${encodeURIComponent(artifact.id)}`), {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    }),
    `Delete artifact ${artifact.id}`,
  );
  console.log(`Deleted workflow artifact ${artifact.name ?? artifact.id}.`);
}

console.log(`Deleted ${artifacts.length} artifact(s) for workflow run ${runId}.`);
