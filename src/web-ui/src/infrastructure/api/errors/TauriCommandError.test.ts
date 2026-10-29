import { describe, expect, it } from 'vitest';
import {
  gitRepositoryUntrustedPath,
  isCommandTimeoutError,
  isGitRepositoryNotFoundError,
  isGitRepositoryUntrustedError,
  isNotAvailableError,
  isOutcomeUnknownError,
  isSessionInUseError,
  TauriCommandError,
} from './TauriCommandError';

describe('isCommandTimeoutError', () => {
  it.each([
    ['Request timeout', true],
    [new Error('Request timeout: git_get_status'), true],
    [new Error('Failed to get Git status: Git command failed: Git status timed out after 10s'), true],
    [new Error('Review Git inspection timed out'), true],
    [new Error('JSON-RPC request timed out: git/status'), true],
    [new Error("Peer request 'git_get_status' timed out after 30000ms"), true],
    [new TauriCommandError('Internal error', {
      command: 'git_get_status',
      originalError: { message: 'Internal error', data: 'Git status timed out after 10s' },
    }), true],
    [{ message: 'Host command failed', details: { originalError: 'Request timeout' } }, true],
    [new Error('Failed to get Git status: Permission denied'), false],
    [new Error('Failed to read file /workspace/src/timeout.ts: permission denied'), false],
    [new Error('Failed to get Git status: Permission denied: /home/dev/timeout-app'), false],
    [new Error("fatal: ambiguous argument 'feature/timeout': unknown revision or path"), false],
  ])('recognizes timeout text through transport wrappers: %j', (error, expected) => {
    expect(isCommandTimeoutError(error)).toBe(expected);
  });
});

describe('isGitRepositoryNotFoundError', () => {
  const legacyError = "Failed to get Git status: Repository not found: could not find repository at '/workspace'; class=Repository (6); code=NotFound (-3)";

  it.each([
    legacyError,
    new TauriCommandError(legacyError, {
      command: 'git_get_status',
      originalError: legacyError,
    }),
    { message: 'Host command failed', details: { originalError: legacyError } },
    { message: 'Internal error', data: legacyError },
    JSON.parse(JSON.stringify({ message: 'Internal error', data: legacyError })),
    new Error('fatal: not a git repository (or any of the parent directories): .git'),
  ])('recognizes existing host payloads through transport wrappers: %j', (error) => {
    expect(isGitRepositoryNotFoundError(error)).toBe(true);
  });

  it.each([
    'File not found: /workspace/src/file.ts',
    'Failed to get Git status: Permission denied',
    'git_repository_untrusted: /workspace',
    "fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.",
    'Network connection timed out',
  ])('does not misclassify another failure: %s', (message) => {
    expect(isGitRepositoryNotFoundError(new Error(message))).toBe(false);
  });
});

describe('isSessionInUseError', () => {
  it('recognizes local Tauri command errors without parsing human prose', () => {
    const error = new TauriCommandError('Command failed', {
      command: 'ensure_coordinator_session',
      originalError: new Error(
        'session_in_use: Session is already open for writing: session-1',
      ),
    });

    expect(isSessionInUseError(error)).toBe(true);
  });

  it('recognizes the same stable prefix through Peer error wrapping', () => {
    const error = {
      message: 'Host command failed',
      details: {
        originalError:
          'session_in_use: Session is already open for writing: session-1',
      },
    };

    expect(isSessionInUseError(error)).toBe(true);
  });

  it('does not classify similar human prose as the stable error', () => {
    expect(
      isSessionInUseError(
        new Error('This session seems to be in use by another process'),
      ),
    ).toBe(false);
  });
});

describe('isOutcomeUnknownError', () => {
  it('recognizes the stable rename error through Tauri and Peer wrappers', () => {
    expect(
      isOutcomeUnknownError(
        new TauriCommandError('Command failed', {
          command: 'update_session_title',
          originalError: 'outcome_unknown: inspect authoritative state',
        }),
      ),
    ).toBe(true);
    expect(
      isOutcomeUnknownError({
        message: 'Host command failed',
        details: { originalError: 'outcome_unknown: inspect authoritative state' },
      }),
    ).toBe(true);
  });

  it('does not infer unknown outcomes from human prose', () => {
    expect(isOutcomeUnknownError(new Error('The rename might have worked'))).toBe(false);
  });
});

describe('isNotAvailableError', () => {
  it('recognizes a stable unsupported capability prefix through wrappers', () => {
    expect(
      isNotAvailableError({
        context: { originalError: 'not_available: future profile is unsupported' },
      }),
    ).toBe(true);
  });

  it('does not infer unsupported state from prose', () => {
    expect(isNotAvailableError(new Error('This feature is unavailable'))).toBe(false);
  });
});

describe('isGitRepositoryUntrustedError', () => {
  it('recognizes the ownership rejection through Tauri and Peer wrappers', () => {
    expect(
      isGitRepositoryUntrustedError(
        new TauriCommandError('Command failed', {
          command: 'git_get_status',
          originalError: 'git_repository_untrusted: D:/workspace/project/BitFun',
        }),
      ),
    ).toBe(true);
    expect(
      isGitRepositoryUntrustedError({
        message: 'Host command failed',
        details: { originalError: 'git_repository_untrusted: /srv/repo' },
      }),
    ).toBe(true);
  });

  it('recognizes the JSON-RPC shape web mode receives over the WebSocket transport', () => {
    // `webSocketResponseError` builds this: the protocol phrase is the message
    // and the host's stable code rides in `data`.
    const error = Object.assign(new Error('Invalid params'), {
      code: -32602,
      data: 'git_repository_untrusted: /srv/shared/repo',
    });

    expect(isGitRepositoryUntrustedError(error)).toBe(true);
    expect(gitRepositoryUntrustedPath(error)).toBe('/srv/shared/repo');
  });

  it('does not classify an ordinary Git failure as an ownership rejection', () => {
    expect(
      isGitRepositoryUntrustedError(new Error('Failed to get status: not a git repository')),
    ).toBe(false);
  });

  it('carries the repository path Git rejected', () => {
    const error = new TauriCommandError('Command failed', {
      command: 'git_get_status',
      originalError: 'git_repository_untrusted: D:/workspace/project/BitFun',
    });

    expect(gitRepositoryUntrustedPath(error)).toBe('D:/workspace/project/BitFun');
    expect(gitRepositoryUntrustedPath(new Error('unrelated'))).toBeUndefined();
  });

  it('reports no path when the backend sent the prefix without one', () => {
    expect(
      gitRepositoryUntrustedPath(new Error('git_repository_untrusted:   ')),
    ).toBeUndefined();
  });
});
