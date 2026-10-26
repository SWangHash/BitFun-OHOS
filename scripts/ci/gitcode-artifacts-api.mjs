// Shared GitCode Actions artifact API helpers.
//
// GitCode's Actions artifact endpoints are documented under API v8 on the
// api.gitcode.com host (gitcode.com/api/v8 does not expose them). Keep every
// consumer on this one root so the host cannot drift between scripts.

export function parseRepository(repository) {
  const parts = repository.split('/');
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new Error(`Invalid GitCode repository: ${repository}`);
  }
  return parts.map(encodeURIComponent);
}

export function createArtifactsApi(token, owner, repo) {
  const apiRoot = `https://api.gitcode.com/api/v8/repos/${owner}/${repo}`;

  return {
    url(pathname, params = {}) {
      const url = new URL(`${apiRoot}${pathname}`);
      url.searchParams.set('access_token', token);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
      return url;
    },
    async value(response, operation) {
      const text = await response.text();
      let parsed;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = text;
      }
      if (!response.ok) {
        throw new Error(
          `${operation} failed (${response.status}): ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`,
        );
      }
      return parsed;
    },
  };
}

export function artifactsFrom(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.artifacts)) return value.artifacts;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

export function artifactRunId(artifact) {
  return artifact.workflow_run_id
    ?? artifact.run_id
    ?? artifact.workflow_run?.id
    ?? artifact.workflowRun?.id;
}
