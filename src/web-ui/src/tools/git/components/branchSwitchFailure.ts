import type { UseI18nReturn } from '@/infrastructure/i18n';

/** Shares checkout failure reasons between the picker and the Git panel. */
export function getBranchSwitchFailureMessage(
  error: string | undefined,
  branchName: string,
  t: UseI18nReturn['t'],
): string {
  const lowerError = error?.toLowerCase() ?? '';
  if (lowerError.includes('git_branch_diverged:')) {
    return t('quickSwitch.errors.diverged', { branch: branchName });
  }
  if (lowerError.includes('would be overwritten by checkout')) {
    return t('quickSwitch.errors.localChanges');
  }
  if (lowerError.includes('resolve your current index first')) {
    return t('quickSwitch.errors.indexConflict');
  }
  if (lowerError.includes('did not match')) {
    return t('errors.branchNotFound', { branch: branchName });
  }
  return error
    ? t('quickSwitch.errors.switchFailedWithMessage', { error })
    : t('quickSwitch.errors.switchFailed');
}
