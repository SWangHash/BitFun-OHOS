import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitAPI, gitWorkspaceKey } from './GitAPI';
import { activateSurface, isSurfaceChangedError } from '@/infrastructure/peer-device/deviceSurface';

const workspace = { workspaceId: 'workspace-1' };

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('./ApiClient', () => ({
  api: {
    invoke: invokeMock,
  },
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// The repository path travels as a display/evidence projection only; identity
// is the workspace ID, so this scope carries both the way call sites do.
const WORKSPACE = { workspaceId: 'ws-1', repositoryPath: 'D:/workspace/BitFun' };

describe('GitAPI repository probe cache', () => {
  let gitAPI: GitAPI;

  beforeEach(() => {
    activateSurface('local');
    gitAPI = new GitAPI();
    invokeMock.mockReset();
  });

  it('does not dispatch a repository probe after its device changes during preparation', async () => {
    invokeMock.mockResolvedValue(true);
    const pending = gitAPI.isGitRepository(workspace);
    const rejection = expect(pending).rejects.toSatisfy(isSurfaceChangedError);
    activateSurface('peer-b');
    await rejection;
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('starts a fresh probe after returning to the same device while an old probe is pending', async () => {
    const deferred = createDeferred<boolean>();
    invokeMock.mockReturnValueOnce(deferred.promise).mockResolvedValue(true);
    const first = gitAPI.isGitRepository(workspace);
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    activateSurface('peer-b');
    activateSurface('local');
    const second = gitAPI.isGitRepository(workspace);
    const results = Promise.allSettled([first, second]);
    deferred.resolve(false);
    const [old, current] = await results;
    expect(old.status).toBe('rejected');
    if (old.status === 'rejected') expect(isSurfaceChangedError(old.reason)).toBe(true);
    expect(current).toEqual({ status: 'fulfilled', value: true });
    expect(invokeMock).toHaveBeenCalledTimes(2);
    await expect(gitAPI.isGitRepository(workspace)).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent repository probes for the same path', async () => {
    const deferred = createDeferred<boolean>();
    invokeMock.mockReturnValueOnce(deferred.promise);

    const first = gitAPI.isGitRepository(workspace);
    const second = gitAPI.isGitRepository(workspace);

    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledWith('git_is_repository', {
      request: { workspaceId: 'workspace-1' },
    });

    deferred.resolve(true);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  it('isolates two workspace IDs with the same filesystem path', async () => {
    invokeMock.mockResolvedValue(true);
    await gitAPI.isGitRepository({ workspaceId: 'first', repositoryPath: '/same/root' });
    await gitAPI.isGitRepository({ workspaceId: 'second', repositoryPath: '/same/root' });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('reuses a recent repository probe result for the same path', async () => {
    invokeMock.mockResolvedValueOnce(true);

    await expect(gitAPI.isGitRepository(workspace)).resolves.toBe(true);
    await expect(gitAPI.isGitRepository(workspace)).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a scope with no workspace ID instead of probing a path', () => {
    expect(() => gitWorkspaceKey({ workspaceId: '', repositoryPath: 'D:/workspace/BitFun' }))
      .toThrow(/workspace ID/i);
  });

  it('drops a cached probe result once ownership trust is granted', async () => {
    invokeMock.mockResolvedValueOnce(false);
    await expect(gitAPI.isGitRepository(workspace)).resolves.toBe(false);

    invokeMock.mockResolvedValueOnce({
      state: 'trusted',
      repositoryPath: 'D:/workspace/BitFun',
      alreadyTrusted: false,
      addedEntries: ['D:/workspace/BitFun'],
      detail: null,
      manualCommand: null,
    });
    await gitAPI.trustRepository(workspace);

    invokeMock.mockResolvedValueOnce(true);
    await expect(gitAPI.isGitRepository(workspace)).resolves.toBe(true);
  });

  it('keeps stale or mirror display paths out of workspace routing and cache keys', async () => {
    invokeMock.mockResolvedValueOnce(false);
    await expect(gitAPI.isGitRepository(workspace)).resolves.toBe(false);
    const staleProjection = { ...workspace, repositoryPath: '/local/hidden/remote-session-store' };
    await expect(gitAPI.isGitRepository(staleProjection)).resolves.toBe(false);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenLastCalledWith('git_is_repository', {
      request: { workspaceId: 'workspace-1' },
    });
    invokeMock.mockResolvedValueOnce({ state: 'trusted' });
    await gitAPI.trustRepository(staleProjection);
    expect(invokeMock).toHaveBeenLastCalledWith('git_trust_repository', {
      request: { workspaceId: 'workspace-1' },
    });
    invokeMock.mockResolvedValueOnce(true);
    await expect(gitAPI.isGitRepository(workspace)).resolves.toBe(true);
  });

  // The user runs the manual command in a terminal, or the repository's owner
  // fixes ownership. Nothing in this process granted anything, so the read-only
  // probe is the only place that learns — and the stale `false` it leaves behind
  // fails the very retry the recovery just decided was worth making.
  it('drops a cached probe result once the read-only probe reports trust', async () => {
    invokeMock.mockResolvedValueOnce(false);
    await expect(gitAPI.isGitRepository(workspace)).resolves.toBe(false);

    invokeMock.mockResolvedValueOnce({
      state: 'trusted',
      repositoryPath: 'D:/workspace/BitFun',
      detail: null,
      manualCommand: null,
    });
    await gitAPI.getRepositoryTrust(workspace);

    invokeMock.mockResolvedValueOnce(true);
    await expect(gitAPI.isGitRepository(workspace)).resolves.toBe(true);
  });

  it('keeps the cached probe result while the probe still reports the wall', async () => {
    invokeMock.mockResolvedValueOnce(false);
    await expect(gitAPI.isGitRepository(workspace)).resolves.toBe(false);

    invokeMock.mockResolvedValueOnce({
      state: 'trust_required',
      repositoryPath: 'D:/workspace/BitFun',
      detail: 'detected dubious ownership',
      manualCommand: "git config --global --add safe.directory 'D:/workspace/BitFun'",
    });
    await gitAPI.getRepositoryTrust(workspace);

    await expect(gitAPI.isGitRepository(workspace)).resolves.toBe(false);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the cached probe result when trust was not granted', async () => {
    invokeMock.mockResolvedValueOnce(false);
    await expect(gitAPI.isGitRepository(workspace)).resolves.toBe(false);

    invokeMock.mockResolvedValueOnce({
      state: 'trust_required',
      repositoryPath: 'D:/workspace/BitFun',
      alreadyTrusted: false,
      addedEntries: [],
      detail: 'detected dubious ownership',
      manualCommand: 'git config --global --add safe.directory "D:/workspace/BitFun"',
    });
    await gitAPI.trustRepository(workspace);

    await expect(gitAPI.isGitRepository(workspace)).resolves.toBe(false);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  // Every Git command in one scene has to resolve its target the same way; a
  // command still sending a path would be routed by a different rule than the
  // probe that decided the panel is looking at a repository at all.
  it('scopes every Git command by workspace ID', async () => {
    const calls: Array<[string, unknown]> = [];
    invokeMock.mockImplementation((command: string, payload: unknown) => {
      calls.push([command, payload]);
      return Promise.resolve(command === 'git_get_graph' ? { nodes: [], maxLane: 0 } : []);
    });

    await gitAPI.getStatus(WORKSPACE);
    await gitAPI.getBranches(WORKSPACE, true);
    await gitAPI.getEnhancedBranches(WORKSPACE, true);
    await gitAPI.getCommits(WORKSPACE, { maxCount: 5 });
    await gitAPI.addFiles(WORKSPACE, { files: ['a.txt'] });
    await gitAPI.commit(WORKSPACE, { message: 'chore: commit' });
    await gitAPI.push(WORKSPACE, {});
    await gitAPI.pull(WORKSPACE, {});
    await gitAPI.checkoutBranch(WORKSPACE, 'main');
    await gitAPI.createBranch(WORKSPACE, 'feature');
    await gitAPI.deleteBranch(WORKSPACE, 'feature');
    await gitAPI.resetToCommit(WORKSPACE, 'abc1234');
    await gitAPI.getDiff(WORKSPACE, { staged: true });
    await gitAPI.getChangedFiles(WORKSPACE, { staged: true });
    await gitAPI.resetFiles(WORKSPACE, ['a.txt']);
    await gitAPI.getFileContent(WORKSPACE, 'a.txt');
    await gitAPI.resolveRevision(WORKSPACE, 'HEAD');
    await gitAPI.cherryPick(WORKSPACE, 'abc1234');
    await gitAPI.cherryPickAbort(WORKSPACE);
    await gitAPI.cherryPickContinue(WORKSPACE);
    await gitAPI.listWorktrees(WORKSPACE);
    await gitAPI.addWorktree(WORKSPACE, 'feature');
    await gitAPI.removeWorktree(WORKSPACE, 'D:/workspace/BitFun-wt');
    await gitAPI.getRepository(WORKSPACE);
    await gitAPI.getRepositoryBasic(WORKSPACE);
    await gitAPI.getGraph(WORKSPACE, 10);

    expect(calls.length).toBe(26);
    for (const [command, payload] of calls) {
      // `git_get_graph` spreads its scope; the rest nest it under `request`.
      const scoped = (payload as { request?: Record<string, unknown> }).request
        ?? (payload as Record<string, unknown>);
      expect(scoped, command).toMatchObject({ workspaceId: 'ws-1' });
      expect(scoped, command).not.toHaveProperty('repositoryPath');
    }
  });
});