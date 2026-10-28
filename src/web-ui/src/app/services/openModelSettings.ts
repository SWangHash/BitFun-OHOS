export async function openModelSettings(): Promise<void> {
  try {
    // Model configuration lives at the canonical ai.models settings page;
    // the bare 'models' id is a legacy destination and renders no page.
    const { useSettingsStore } = await import('@/app/scenes/settings/settingsStore');
    useSettingsStore.getState().openPage('ai.models');
  } catch {
    // Opening the scene still gives the user a path to repair model settings.
  }

  window.dispatchEvent(new CustomEvent('scene:open', { detail: { sceneId: 'settings' } }));
}
