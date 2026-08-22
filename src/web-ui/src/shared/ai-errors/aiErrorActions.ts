export function openModelSettings(): void {
  const openSettingsScene = (): void => {
    window.dispatchEvent(new CustomEvent('scene:open', { detail: { sceneId: 'settings' } }));
  };

  void import('@/app/scenes/settings/settingsStore')
    .then(({ useSettingsStore }) => {
      // Set the tab before opening the scene so SettingsScene mounts directly on
      // the models panel instead of flashing the default (basics) tab first.
      useSettingsStore.getState().setActiveTab('models');
      openSettingsScene();
    })
    .catch(() => {
      // Opening the scene still gives the user a path to repair model settings.
      openSettingsScene();
    });
}
