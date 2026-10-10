import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { TauriCommandError } from '@/infrastructure/api/errors/TauriCommandError';

const mocks = vi.hoisted(() => ({
  workspace: { id: 'workspace-1', rootPath: '/repo' },
  listener: undefined as undefined | ((event: any) => Promise<void>),
  refresh: vi.fn(),
  invalidateCache: vi.fn(),
  trust: vi.fn(),
}));
vi.mock('@/infrastructure/services/business/workspaceManager', () => ({
  workspaceManager: {
    addEventListener: (listener: typeof mocks.listener) => {
      mocks.listener = listener;
      return () => { mocks.listener = undefined; };
    },
    getState: () => ({ currentWorkspace: mocks.workspace }),
  },
}));
vi.mock('../state/GitStateManager', () => ({ gitStateManager: mocks }));
vi.mock('@/shared/services/gitTrustService', () => ({ requestGitRepositoryTrust: mocks.trust }));
import { workspaceGitInitializer } from './WorkspaceGitInitializer';

function ownershipError() {
  return new TauriCommandError('Command failed', {
    command: 'git_repository_basic',
    originalError: 'git_repository_untrusted: /repo',
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace = { id: 'workspace-1', rootPath: '/repo' };
  mocks.refresh.mockResolvedValue(undefined);
});
afterEach(() => workspaceGitInitializer.stop());

describe('WorkspaceGitInitializer', () => {
  it('refreshes only basic Git facts for the active workspace on startup', async () => {
    workspaceGitInitializer.start();
    expect(mocks.refresh).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', repositoryPath: '/repo' },
      { layers: ['basic'], reason: 'mount', force: true, source: 'workspace_git_initializer' },
    );
  });

  it('offers trust after an ownership failure and refreshes after approval', async () => {
    mocks.refresh.mockRejectedValueOnce(ownershipError());
    mocks.trust.mockResolvedValue(true);
    workspaceGitInitializer.start();
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
    expect(mocks.trust).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', repositoryPath: '/repo' },
      { isCurrent: expect.any(Function) },
    );
    expect(mocks.refresh.mock.calls[1][1].layers).toEqual(['basic', 'status']);
  });

  it('does not replay when trust is declined', async () => {
    mocks.refresh.mockRejectedValueOnce(ownershipError());
    mocks.trust.mockResolvedValue(false);
    workspaceGitInitializer.start();
    await vi.waitFor(() => expect(mocks.trust).toHaveBeenCalledTimes(1));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not mistake a missing Git executable for an ownership failure', async () => {
    mocks.refresh.mockRejectedValueOnce(new Error('git ENOENT'));
    workspaceGitInitializer.start();
    await Promise.resolve();
    expect(mocks.trust).not.toHaveBeenCalled();
  });

  it('ignores an ownership failure after switching workspaces', async () => {
    let reject!: (error: unknown) => void;
    mocks.refresh.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    workspaceGitInitializer.start();
    mocks.workspace = { id: 'workspace-2', rootPath: '/other' };
    await mocks.listener?.({ type: 'workspace:switched', workspace: mocks.workspace });
    reject(ownershipError());
    await Promise.resolve();
    expect(mocks.trust).not.toHaveBeenCalled();
  });

  it('invalidates the trust callback when the initializer stops', async () => {
    mocks.refresh.mockRejectedValueOnce(ownershipError());
    mocks.trust.mockResolvedValue(false);
    workspaceGitInitializer.start();
    await vi.waitFor(() => expect(mocks.trust).toHaveBeenCalledTimes(1));
    const { isCurrent } = mocks.trust.mock.calls[0][1];
    expect(isCurrent()).toBe(true);
    workspaceGitInitializer.stop();
    expect(isCurrent()).toBe(false);
  });
});
