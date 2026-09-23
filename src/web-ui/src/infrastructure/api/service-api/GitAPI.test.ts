import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitAPI, gitWorkspaceKey } from './GitAPI';

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
// is the workspace ID, so these scopes carry both the way call sites do.
const WORKSPACE = { workspaceId: 'ws-1', repositoryPath: 'D:/workspace/BitFun' };
const OTHER_WORKSPACE = { workspaceId: 'ws-2', repositoryPath: 'D:/workspace/BitFun' };

describe('GitAPI repository probe cache', () => {
  let gitAPI: GitAPI;

  beforeEach(() => {
    gitAPI = new GitAPI();
    invokeMock.mockReset();
  });

  // The backend resolves the workspace record itself: it owns the root path and,
  // for a remote workspace, the connection to run on. Sending a path instead is
  // what made every Git command fail in argument deserialization.
  it('sends the workspace ID the backend command expects', async () => {
    const deferred = createDeferred<boolean>();
    invokeMock.mockReturnValueOnce(deferred.promise);

    const first = gitAPI.isGitRepository(WORKSPACE);
    const second = gitAPI.isGitRepository(WORKSPACE);

    deferred.resolve(true);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('git_is_repository', {
      request: { workspaceId: 'ws-1' },
    });
  });

  it('reuses a recent repository probe result for the same workspace', async () => {
    invokeMock.mockResolvedValueOnce(true);

    await expect(gitAPI.isGitRepository(WORKSPACE)).resolves.toBe(true);
    await expect(gitAPI.isGitRepository(WORKSPACE)).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a scope with no workspace ID instead of probing a path', () => {
    expect(() => gitWorkspaceKey({ workspaceId: '', repositoryPath: 'D:/workspace/BitFun' }))
      .toThrow(/workspace ID/i);
  });

  it('drops a cached probe result once ownership trust is granted', async () => {
    invokeMock.mockResolvedValueOnce(false);
    await expect(gitAPI.isGitRepository(WORKSPACE)).resolves.toBe(false);

    invokeMock.mockResolvedValueOnce({
      state: 'trusted',
      repositoryPath: 'D:/workspace/BitFun',
      alreadyTrusted: false,
      addedEntries: ['D:/workspace/BitFun'],
      detail: null,
      manualCommand: null,
    });
    await gitAPI.trustRepository(WORKSPACE);

    invokeMock.mockResolvedValueOnce(true);
    await expect(gitAPI.isGitRepository(WORKSPACE)).resolves.toBe(true);
  });

  // Two workspaces routinely name the same path — a worktree and the repository
  // it came from, or the same checkout opened twice. The record, not the
  // spelling, decides which repository a cached answer belongs to.
  it('keeps two workspaces at the same path as separate cache entries', async () => {
    invokeMock.mockResolvedValueOnce(false);
    await expect(gitAPI.isGitRepository(WORKSPACE)).resolves.toBe(false);

    invokeMock.mockResolvedValueOnce(true);
    await expect(gitAPI.isGitRepository(OTHER_WORKSPACE)).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith('git_is_repository', {
      request: { workspaceId: 'ws-2' },
    });
    // The first workspace still answers from its own entry.
    await expect(gitAPI.isGitRepository(WORKSPACE)).resolves.toBe(false);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  // The user runs the manual command in a terminal, or the repository's owner
  // fixes ownership. Nothing in this process granted anything, so the read-only
  // probe is the only place that learns — and the stale `false` it leaves behind
  // fails the very retry the recovery just decided was worth making.
  it('drops a cached probe result once the read-only probe reports trust', async () => {
    invokeMock.mockResolvedValueOnce(false);
    await expect(gitAPI.isGitRepository(WORKSPACE)).resolves.toBe(false);

    invokeMock.mockResolvedValueOnce({
      state: 'trusted',
      repositoryPath: 'D:/workspace/BitFun',
      detail: null,
      manualCommand: null,
    });
    await gitAPI.getRepositoryTrust(WORKSPACE);

    invokeMock.mockResolvedValueOnce(true);
    await expect(gitAPI.isGitRepository(WORKSPACE)).resolves.toBe(true);
  });

  it('keeps the cached probe result while the probe still reports the wall', async () => {
    invokeMock.mockResolvedValueOnce(false);
    await expect(gitAPI.isGitRepository(WORKSPACE)).resolves.toBe(false);

    invokeMock.mockResolvedValueOnce({
      state: 'trust_required',
      repositoryPath: 'D:/workspace/BitFun',
      detail: 'detected dubious ownership',
      manualCommand: "git config --global --add safe.directory 'D:/workspace/BitFun'",
    });
    await gitAPI.getRepositoryTrust(WORKSPACE);

    await expect(gitAPI.isGitRepository(WORKSPACE)).resolves.toBe(false);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the cached probe result when trust was not granted', async () => {
    invokeMock.mockResolvedValueOnce(false);
    await expect(gitAPI.isGitRepository(WORKSPACE)).resolves.toBe(false);

    invokeMock.mockResolvedValueOnce({
      state: 'trust_required',
      repositoryPath: 'D:/workspace/BitFun',
      alreadyTrusted: false,
      addedEntries: [],
      detail: 'detected dubious ownership',
      manualCommand: 'git config --global --add safe.directory "D:/workspace/BitFun"',
    });
    await gitAPI.trustRepository(WORKSPACE);

    await expect(gitAPI.isGitRepository(WORKSPACE)).resolves.toBe(false);
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
