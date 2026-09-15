/**
 * Peer-aware workspace directory picker.
 * - Local (desktop): native `@tauri-apps/plugin-dialog`
 * - OpenHarmony: native `DocumentViewPicker` via the ArkTS bridge
 *   (`WorkspaceAPI.open_oh_file_dialog`); the Tauri dialog plugin has no
 *   runtime on the OHOS host, so the desktop dialog cannot open there.
 * - Peer Device Mode: in-app browser listing the peer filesystem via HostInvoke
 */

import { isPeerDeviceModeActive } from './peerModeFlag';
import { usePeerDirectoryPickerStore } from './peerDirectoryPickerStore';
import { isOpenHarmonyRuntime } from '@/infrastructure/runtime';
import { workspaceAPI } from '@/infrastructure/api';

export interface PickWorkspaceDirectoryOptions {
  title: string;
  defaultPath?: string;
}

export async function pickWorkspaceDirectory(
  options: PickWorkspaceDirectoryOptions,
): Promise<string | null> {
  if (isPeerDeviceModeActive()) {
    return usePeerDirectoryPickerStore.getState().show(options);
  }

  if (isOpenHarmonyRuntime()) {
    // OpenHarmony renders inside the native ArkWeb host, where the Tauri dialog
    // plugin is unavailable. Route to the ArkTS bridge (DocumentViewPicker on
    // @ohos.file.picker) instead; it accepts the same option subset.
    const selected = await workspaceAPI.open_oh_file_dialog({
      directory: true,
      multiple: false,
      title: options.title,
      defaultPath: options.defaultPath,
    });
    return typeof selected === 'string' && selected.length > 0 ? selected : null;
  }

  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    directory: true,
    multiple: false,
    title: options.title,
    defaultPath: options.defaultPath,
  });
  return typeof selected === 'string' && selected.length > 0 ? selected : null;
}
