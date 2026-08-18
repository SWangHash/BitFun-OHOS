export async function openModelSettings(): Promise<void> {
  const { quickActions } = await import('@/shared/services/ide-control');
  // Open the model settings surface directly in the provider/model creation
  // flow instead of leaving the user on the general model overview page.
  quickActions.openSettings('models:create');
}
