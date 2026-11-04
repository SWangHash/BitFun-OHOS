import { describe, expect, it, vi } from 'vitest';

import { getBranchSwitchFailureMessage } from './branchSwitchFailure';

describe('getBranchSwitchFailureMessage', () => {
  it.each([
    ['git_branch_diverged: Local and remote branches have diverged', 'quickSwitch.errors.diverged'],
    ['Failed to checkout branch: Git command failed: error: Your local changes to the following files would be overwritten by checkout:', 'quickSwitch.errors.localChanges'],
    ['error: The following untracked working tree files would be overwritten by checkout:', 'quickSwitch.errors.localChanges'],
    ['error: you need to resolve your current index first', 'quickSwitch.errors.indexConflict'],
    ["error: pathspec 'missing' did not match any file(s) known to git", 'errors.branchNotFound'],
  ])('explains checkout rejection: %s', (error, key) => {
    const t = vi.fn((messageKey: string) => messageKey);
    expect(getBranchSwitchFailureMessage(error, 'origin/topic', t)).toBe(key);
  });

  it('includes the selected branch for divergence and preserves unknown diagnostics', () => {
    const t = vi.fn((key: string, options?: Record<string, unknown>) => `${key}:${JSON.stringify(options)}`);
    getBranchSwitchFailureMessage('git_branch_diverged: diverged', 'origin/topic', t);
    expect(t).toHaveBeenLastCalledWith('quickSwitch.errors.diverged', { branch: 'origin/topic' });

    getBranchSwitchFailureMessage('Remote connection unavailable', 'origin/topic', t);
    expect(t).toHaveBeenLastCalledWith('quickSwitch.errors.switchFailedWithMessage', {
      error: 'Remote connection unavailable',
    });
    getBranchSwitchFailureMessage(undefined, 'origin/topic', t);
    expect(t).toHaveBeenLastCalledWith('quickSwitch.errors.switchFailed');
  });
});
