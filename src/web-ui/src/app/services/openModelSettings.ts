export async function openModelSettings(): Promise<void> {
  const openSettingsScene = (): void => {
    window.dispatchEvent(new CustomEvent('scene:open', { detail: { sceneId: 'settings' } }));
  };

  try {
    // Resolve the target and warm the lazy settings chunk before mounting the
    // scene. This keeps the model-create focus from racing scene rendering in
    // WebViews with slower dynamic-import scheduling.
    const [{ useSettingsStore }, { preloadSettingsTabContent }] = await Promise.all([
      import('@/app/scenes/settings/settingsStore'),
      import('@/app/scenes/settings/settingsContentRegistry'),
    ]);
    useSettingsStore.getState().openTab('models', 'model-create');
    await preloadSettingsTabContent('models');
  } catch {
    // The scene remains a useful fallback if a lazy settings resource cannot
    // be loaded; its normal tab content still provides the model entry point.
  }

  openSettingsScene();
}
