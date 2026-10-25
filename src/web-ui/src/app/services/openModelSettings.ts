export async function openModelSettings(): Promise<void> {
  const openSettingsScene = (): void => {
    window.dispatchEvent(new CustomEvent('scene:open', { detail: { sceneId: 'settings' } }));
  };

  try {
    // Resolve the target and warm the lazy settings page before mounting the
    // scene. This keeps navigation from racing scene rendering in WebViews
    // with slower dynamic-import scheduling.
    const [{ useSettingsStore }, { preloadSettingsPage }] = await Promise.all([
      import('@/app/scenes/settings/settingsStore'),
      import('@/app/scenes/settings/settingsRegistry'),
    ]);
    useSettingsStore.getState().openPage('ai.models');
    await preloadSettingsPage('ai.models');
  } catch {
    // The scene remains a useful fallback if a lazy settings resource cannot
    // be loaded; its normal tab content still provides the model entry point.
  }

  openSettingsScene();
}
