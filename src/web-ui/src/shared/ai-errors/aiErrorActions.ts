export function openModelSettings(): void {
  const openSettingsScene = (): void => {
    window.dispatchEvent(new CustomEvent('scene:open', { detail: { sceneId: 'settings' } }));
  };

  void Promise.all([
    import('@/app/scenes/settings/settingsStore'),
    import('@/app/scenes/settings/settingsContentRegistry'),
  ])
    .then(([{ useSettingsStore }, { preloadSettingsTabContent }]) => {
      // Set the tab and warm its chunk/i18n before opening the scene. This is
      // important for HarmonyOS WebView, where a lazy chunk can otherwise be
      // evaluated after the scene has already started rendering.
      useSettingsStore.getState().setActiveTab('models');
      return preloadSettingsTabContent('models');
    })
    .then(openSettingsScene)
    .catch(() => {
      // Opening the scene still gives the user a path to repair model settings.
      openSettingsScene();
    });
}
