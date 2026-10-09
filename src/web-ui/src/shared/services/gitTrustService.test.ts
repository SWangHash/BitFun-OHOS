import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateSurface } from '@/infrastructure/peer-device/deviceSurface';
import { TauriCommandError } from '@/infrastructure/api/errors/TauriCommandError';
import {
  describeGitTrustFailure,
  requestGitRepositoryTrust,
  resetGitTrustDecisions,
  withGitRepositoryTrustRecovery,
} from './gitTrustService';

const confirmWarningMock = vi.hoisted(() => vi.fn());
const trustRepositoryMock = vi.hoisted(() => vi.fn());
const getRepositoryTrustMock = vi.hoisted(() => vi.fn());
const warningMock = vi.hoisted(() => vi.fn());
const successMock = vi.hoisted(() => vi.fn());
const isPeerDeviceModeActiveMock = vi.hoisted(() => vi.fn(() => false));

vi.mock('@/infrastructure/confirm-dialog', () => ({
  confirmWarning: confirmWarningMock,
}));

vi.mock('@/infrastructure/api', () => ({
  gitAPI: {
    trustRepository: trustRepositoryMock,
    getRepositoryTrust: getRepositoryTrustMock,
  },
}));

vi.mock('@/infrastructure/peer-device/peerModeFlag', () => ({
  isPeerDeviceModeActive: isPeerDeviceModeActiveMock,
}));

vi.mock('@/infrastructure/i18n', () => ({
  i18nService: {
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}|${JSON.stringify(options)}` : key,
  },
}));

vi.mock('@/shared/notification-system', () => ({
  notificationService: {
    warning: warningMock,
    success: successMock,
  },
}));

const REPOSITORY_PATH = 'D:/workspace/project/BitFun';
const WORKSPACE = { workspaceId: 'workspace-1', repositoryPath: REPOSITORY_PATH };

function untrustedError(repositoryPath = REPOSITORY_PATH): TauriCommandError {
  return new TauriCommandError('Command failed', {
    command: 'git_get_status',
    originalError: `git_repository_untrusted: ${repositoryPath}`,
  });
}

function grantedOutcome() {
  return {
    state: 'trusted',
    repositoryPath: REPOSITORY_PATH,
    alreadyTrusted: false,
    addedEntries: [REPOSITORY_PATH],
    detail: null,
    manualCommand: null,
  };
}

function trustRequiredReport() {
  return {
    state: 'trust_required' as const,
    repositoryPath: REPOSITORY_PATH,
    detail: 'detected dubious ownership',
    manualCommand: `git config --global --add safe.directory "${REPOSITORY_PATH}"`,
    grantSupported: true,
  };
}

beforeEach(() => {
  activateSurface('local');
  resetGitTrustDecisions();
  confirmWarningMock.mockReset();
  trustRepositoryMock.mockReset();
  getRepositoryTrustMock.mockReset();
  getRepositoryTrustMock.mockResolvedValue(trustRequiredReport());
  warningMock.mockReset();
  successMock.mockReset();
  isPeerDeviceModeActiveMock.mockReset();
  isPeerDeviceModeActiveMock.mockReturnValue(false);
});

describe('describeGitTrustFailure', () => {
  it('turns the stable repository trust code into localized copy', () => {
    expect(describeGitTrustFailure(untrustedError())).toBe(
      `panels/git:trust.required|${JSON.stringify({ path: REPOSITORY_PATH })}`,
    );
  });

  it('leaves unrelated failures to the calling surface', () => {
    expect(describeGitTrustFailure(new Error('provider unavailable'))).toBeUndefined();
  });
});

describe('requestGitRepositoryTrust', () => {
  it('grants trust only after the user confirms', async () => {
    confirmWarningMock.mockResolvedValue(true);
    trustRepositoryMock.mockResolvedValue(grantedOutcome());

    await expect(requestGitRepositoryTrust(WORKSPACE)).resolves.toBe(true);
    expect(trustRepositoryMock).toHaveBeenCalledWith(WORKSPACE);
  });

  it('writes nothing when the user declines', async () => {
    confirmWarningMock.mockResolvedValue(false);

    await expect(requestGitRepositoryTrust(WORKSPACE)).resolves.toBe(false);
    expect(trustRepositoryMock).not.toHaveBeenCalled();
  });

  it('asks once for a burst of callers on the same repository', async () => {
    let resolveConfirm!: (value: boolean) => void;
    confirmWarningMock.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveConfirm = resolve;
      }),
    );
    trustRepositoryMock.mockResolvedValue(grantedOutcome());

    const first = requestGitRepositoryTrust(WORKSPACE);
    const second = requestGitRepositoryTrust(WORKSPACE);
    await vi.waitFor(() => expect(confirmWarningMock).toHaveBeenCalledTimes(1));
    resolveConfirm(true);

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(confirmWarningMock).toHaveBeenCalledTimes(1);
    expect(trustRepositoryMock).toHaveBeenCalledTimes(1);
  });

  it('does not ask again in the quiet period after a decline', async () => {
    confirmWarningMock.mockResolvedValue(false);

    await requestGitRepositoryTrust(WORKSPACE);
    await expect(requestGitRepositoryTrust(WORKSPACE)).resolves.toBe(false);

    expect(confirmWarningMock).toHaveBeenCalledTimes(1);
  });

  it('does not ask again in the quiet period after a failed grant', async () => {
    confirmWarningMock.mockResolvedValue(true);
    trustRepositoryMock.mockRejectedValue(new Error('config is read-only'));

    await requestGitRepositoryTrust(WORKSPACE);
    await expect(requestGitRepositoryTrust(WORKSPACE)).resolves.toBe(false);

    expect(confirmWarningMock).toHaveBeenCalledTimes(1);
    expect(trustRepositoryMock).toHaveBeenCalledTimes(1);
  });

  // The Trust button is visible and enabled after a failure. Returning false
  // without a dialog would read as a dead button, and would strand a user who
  // just fixed safe.directory in a terminal or reconnected a remote host.
  it('answers an explicit user request during the quiet period', async () => {
    confirmWarningMock.mockResolvedValue(true);
    trustRepositoryMock.mockRejectedValueOnce(new Error('config is read-only'));

    await requestGitRepositoryTrust(WORKSPACE);
    expect(confirmWarningMock).toHaveBeenCalledTimes(1);

    trustRepositoryMock.mockResolvedValueOnce(grantedOutcome());
    await expect(
      requestGitRepositoryTrust(WORKSPACE, { userInitiated: true }),
    ).resolves.toBe(true);
    expect(confirmWarningMock).toHaveBeenCalledTimes(2);
  });

  it('still absorbs the automatic burst that follows a user request', async () => {
    confirmWarningMock.mockResolvedValue(false);

    await requestGitRepositoryTrust(WORKSPACE, { userInitiated: true });
    await expect(requestGitRepositoryTrust(WORKSPACE)).resolves.toBe(false);

    expect(confirmWarningMock).toHaveBeenCalledTimes(1);
  });

  it('dedupes display path aliases by workspace identity', async () => {
    let resolveConfirm!: (value: boolean) => void;
    confirmWarningMock.mockReturnValue(new Promise<boolean>(resolve => { resolveConfirm = resolve; }));
    trustRepositoryMock.mockResolvedValue(grantedOutcome());
    const first = requestGitRepositoryTrust(WORKSPACE);
    const second = requestGitRepositoryTrust({ ...WORKSPACE, repositoryPath: '/alias/repo' });
    await vi.waitFor(() => expect(confirmWarningMock).toHaveBeenCalledTimes(1));
    resolveConfirm(true);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(trustRepositoryMock).toHaveBeenCalledTimes(1);
  });

  it('keeps different workspace identities apart', async () => {
    confirmWarningMock.mockResolvedValue(false);
    await requestGitRepositoryTrust(WORKSPACE);
    await requestGitRepositoryTrust({ ...WORKSPACE, workspaceId: 'workspace-2' });
    expect(confirmWarningMock).toHaveBeenCalledTimes(2);
  });

  it('does not prompt or write trust when Git cannot be probed', async () => {
    getRepositoryTrustMock.mockRejectedValue(new Error('git executable missing'));
    await expect(requestGitRepositoryTrust(WORKSPACE)).resolves.toBe(false);
    expect(confirmWarningMock).not.toHaveBeenCalled();
    expect(trustRepositoryMock).not.toHaveBeenCalled();
    expect(warningMock).toHaveBeenCalledTimes(1);
  });

  it.each(['workspace', 'surface'])('does not write trust after the requesting %s expires', async kind => {
    let current = true;
    let resolveConfirm!: (value: boolean) => void;
    confirmWarningMock.mockReturnValue(new Promise<boolean>(resolve => { resolveConfirm = resolve; }));
    const pending = requestGitRepositoryTrust(WORKSPACE, { isCurrent: () => current });
    await vi.waitFor(() => expect(confirmWarningMock).toHaveBeenCalledTimes(1));
    if (kind === 'surface') activateSurface('peer-1');
    else current = false;
    resolveConfirm(true);
    await expect(pending).resolves.toBe(false);
    expect(trustRepositoryMock).not.toHaveBeenCalled();
  });

  it('lets a fresh activation recover while the expired prompt is still settling', async () => {
    let current = true;
    let resolveOld!: (value: boolean) => void;
    let resolveNew!: (value: boolean) => void;
    confirmWarningMock
      .mockReturnValueOnce(new Promise<boolean>(resolve => { resolveOld = resolve; }))
      .mockReturnValueOnce(new Promise<boolean>(resolve => { resolveNew = resolve; }));
    trustRepositoryMock.mockResolvedValue(grantedOutcome());
    const oldRequest = requestGitRepositoryTrust(WORKSPACE, { isCurrent: () => current });
    await vi.waitFor(() => expect(confirmWarningMock).toHaveBeenCalledTimes(1));
    current = false;
    const newRequest = requestGitRepositoryTrust(WORKSPACE);
    await vi.waitFor(() => expect(confirmWarningMock).toHaveBeenCalledTimes(2));
    resolveOld(true);
    await expect(oldRequest).resolves.toBe(false);
    const joinedRequest = requestGitRepositoryTrust(WORKSPACE);
    resolveNew(true);
    await expect(Promise.all([newRequest, joinedRequest])).resolves.toEqual([true, true]);
    expect(confirmWarningMock).toHaveBeenCalledTimes(2);
    expect(trustRepositoryMock).toHaveBeenCalledTimes(1);
  });

  it('hands over the manual command when trust could not be applied', async () => {
    confirmWarningMock.mockResolvedValue(true);
    trustRepositoryMock.mockResolvedValue({
      state: 'trust_required',
      repositoryPath: REPOSITORY_PATH,
      alreadyTrusted: false,
      addedEntries: [],
      detail: 'detected dubious ownership',
      manualCommand: `git config --global --add safe.directory "${REPOSITORY_PATH}"`,
    });

    await expect(requestGitRepositoryTrust(WORKSPACE)).resolves.toBe(false);
    expect(warningMock).toHaveBeenCalledTimes(1);
    expect(warningMock.mock.calls[0][0]).toContain('trust.unavailableWithCommand');
    expect(warningMock.mock.calls[0][0]).toContain('safe.directory');
  });

  it('reports a failed trust command instead of claiming success', async () => {
    confirmWarningMock.mockResolvedValue(true);
    trustRepositoryMock.mockRejectedValue(new Error('config is read-only'));

    await expect(requestGitRepositoryTrust(WORKSPACE)).resolves.toBe(false);
    expect(warningMock).toHaveBeenCalledTimes(1);
  });

  // A peer host denies granting on purpose. The read-only probe still answers
  // there, so the controller must end up showing the command instead of a
  // dead end.
  it('falls back to the read-only probe for the command when granting is refused', async () => {
    getRepositoryTrustMock.mockResolvedValue({
      state: 'trust_required',
      repositoryPath: REPOSITORY_PATH,
      detail: 'detected dubious ownership',
      manualCommand: `git config --global --add safe.directory "${REPOSITORY_PATH}"`,
      grantSupported: false,
    });

    await expect(requestGitRepositoryTrust(WORKSPACE)).resolves.toBe(false);
    expect(getRepositoryTrustMock).toHaveBeenCalledWith(WORKSPACE);
    expect(confirmWarningMock).not.toHaveBeenCalled();
    expect(trustRepositoryMock).not.toHaveBeenCalled();
    expect(warningMock.mock.calls[0][0]).toContain('trust.unavailableWithCommand');
    expect(warningMock.mock.calls[0][0]).toContain('safe.directory');
  });

  it('shows the manual path before confirmation in peer mode with an older host', async () => {
    isPeerDeviceModeActiveMock.mockReturnValue(true);
    getRepositoryTrustMock.mockResolvedValue({
      state: 'trust_required',
      repositoryPath: REPOSITORY_PATH,
      detail: 'detected dubious ownership',
      manualCommand: `git config --global --add safe.directory "${REPOSITORY_PATH}"`,
    });

    await expect(requestGitRepositoryTrust(WORKSPACE)).resolves.toBe(false);
    expect(confirmWarningMock).not.toHaveBeenCalled();
    expect(trustRepositoryMock).not.toHaveBeenCalled();
    expect(warningMock.mock.calls[0][0]).toContain('safe.directory');
  });

  // The manual command exists to be run. Once the user (or the owner of the
  // repository) has run it, the wall is down — reporting "could not be granted"
  // and answering `false` would strand a repository that already works.
  it('treats a repository fixed outside the product as recovered', async () => {
    confirmWarningMock.mockResolvedValue(true);
    trustRepositoryMock.mockRejectedValue(
      new Error("command 'git_trust_repository' is local-only and cannot run on peer"),
    );
    getRepositoryTrustMock
      .mockResolvedValueOnce(trustRequiredReport())
      .mockResolvedValueOnce({
        state: 'trusted',
        repositoryPath: REPOSITORY_PATH,
        detail: null,
        manualCommand: null,
      });

    await expect(requestGitRepositoryTrust(WORKSPACE)).resolves.toBe(true);
    expect(warningMock).not.toHaveBeenCalled();
    expect(successMock).toHaveBeenCalledTimes(1);
    expect(successMock.mock.calls[0][0]).toContain('trust.alreadyTrusted');
  });

  // ...and the recovery it reports must be a real one: the next automatic call
  // gets a fresh prompt rather than the quiet period a failure would have set.
  it('does not silence the next caller after recovering outside the product', async () => {
    confirmWarningMock.mockResolvedValue(true);
    trustRepositoryMock.mockRejectedValueOnce(new Error('config is read-only'));
    getRepositoryTrustMock
      .mockResolvedValueOnce(trustRequiredReport())
      .mockResolvedValueOnce({
        state: 'trusted',
        repositoryPath: REPOSITORY_PATH,
        detail: null,
        manualCommand: null,
      })
      .mockResolvedValueOnce(trustRequiredReport());

    await expect(requestGitRepositoryTrust(WORKSPACE)).resolves.toBe(true);

    trustRepositoryMock.mockResolvedValueOnce(grantedOutcome());
    await expect(requestGitRepositoryTrust(WORKSPACE)).resolves.toBe(true);
    expect(confirmWarningMock).toHaveBeenCalledTimes(2);
  });

  it('still reports the wall when the host is too old to answer the probe', async () => {
    confirmWarningMock.mockResolvedValue(true);
    trustRepositoryMock.mockRejectedValue(new Error('unknown command'));
    getRepositoryTrustMock.mockRejectedValue(new Error('unknown command'));

    await expect(requestGitRepositoryTrust(WORKSPACE)).resolves.toBe(false);
    expect(warningMock).toHaveBeenCalledTimes(1);
    expect(warningMock.mock.calls[0][0]).toContain('trust.unavailable');
  });
});

describe('withGitRepositoryTrustRecovery', () => {
  it('replays the operation once after trust is granted', async () => {
    confirmWarningMock.mockResolvedValue(true);
    trustRepositoryMock.mockResolvedValue(grantedOutcome());
    const operation = vi
      .fn()
      .mockRejectedValueOnce(untrustedError())
      .mockResolvedValueOnce('status');

    await expect(withGitRepositoryTrustRecovery(operation, WORKSPACE)).resolves.toBe('status');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('surfaces the original error when the user declines', async () => {
    confirmWarningMock.mockResolvedValue(false);
    const error = untrustedError();
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withGitRepositoryTrustRecovery(operation, WORKSPACE)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('does not loop when the repository stays untrusted after a grant', async () => {
    confirmWarningMock.mockResolvedValue(true);
    trustRepositoryMock.mockResolvedValue(grantedOutcome());
    const error = untrustedError();
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withGitRepositoryTrustRecovery(operation, WORKSPACE)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  // The quiet period absorbs a burst of automatic Git reads. It must not answer
  // a deliberate launch with a silent refusal plus an error telling the user to
  // trust the folder "when prompted".
  it('still prompts a user-initiated recovery during the quiet period', async () => {
    confirmWarningMock.mockResolvedValue(false);
    await requestGitRepositoryTrust(WORKSPACE);
    expect(confirmWarningMock).toHaveBeenCalledTimes(1);

    confirmWarningMock.mockResolvedValue(true);
    trustRepositoryMock.mockResolvedValue(grantedOutcome());
    const operation = vi
      .fn()
      .mockRejectedValueOnce(untrustedError())
      .mockResolvedValueOnce('status');

    await expect(
      withGitRepositoryTrustRecovery(operation, WORKSPACE, { userInitiated: true }),
    ).resolves.toBe('status');
    expect(confirmWarningMock).toHaveBeenCalledTimes(2);
  });

  it('stays quiet for an automatic recovery during the quiet period', async () => {
    confirmWarningMock.mockResolvedValue(false);
    await requestGitRepositoryTrust(WORKSPACE);

    const error = untrustedError();
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withGitRepositoryTrustRecovery(operation, WORKSPACE)).rejects.toBe(error);
    expect(confirmWarningMock).toHaveBeenCalledTimes(1);
  });

  // The whole point of handing over a manual command on a host that cannot
  // grant: the user runs it, comes back, and the operation goes through.
  it('replays after the user fixed trust in a terminal', async () => {
    confirmWarningMock.mockResolvedValue(true);
    trustRepositoryMock.mockRejectedValue(new Error('config is read-only'));
    getRepositoryTrustMock.mockResolvedValue({
      state: 'trusted',
      repositoryPath: REPOSITORY_PATH,
      detail: null,
      manualCommand: null,
    });
    const operation = vi
      .fn()
      .mockRejectedValueOnce(untrustedError())
      .mockResolvedValueOnce('status');

    await expect(withGitRepositoryTrustRecovery(operation, WORKSPACE)).resolves.toBe('status');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('leaves every other failure untouched', async () => {
    const error = new Error('not a git repository');
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withGitRepositoryTrustRecovery(operation, WORKSPACE)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(confirmWarningMock).not.toHaveBeenCalled();
  });
});
