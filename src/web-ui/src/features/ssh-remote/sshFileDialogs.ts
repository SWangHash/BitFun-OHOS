import { workspaceAPI } from '@/infrastructure/api/service-api/WorkspaceAPI';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import { isOpenHarmonyRuntime, isTauriRuntime } from '@/infrastructure/runtime';
import { getActiveSurfaceScope, isLocalSurface } from '@/infrastructure/peer-device/deviceSurface';

/** Picker paths belong to this device, which must also own the SSH connection. */
export function captureSshLocalFileHost() {
  const surface = getActiveSurfaceScope();
  if (!isLocalSurface(surface.surfaceId)) {
    throw new Error('Local SSH file selection is not supported on a peer host.');
  }
  return surface;
}

export async function sshDownloadDestinationExists(path: string): Promise<boolean> {
  // An explicit empty connection ID selects local IO even when a remote
  // workspace has a matching path. The destination belongs to this device.
  return api.invoke<boolean>('check_path_exists', { request: { path, remoteConnectionId: '' } });
}

export function supportsSshFileDialogs(): boolean {
  return isTauriRuntime() || isOpenHarmonyRuntime();
}

export async function pickSshUploadPaths(title: string): Promise<string[]> {
  const selected = await workspaceAPI.openFileOrDirectoryDialog({
    title,
    multiple: true,
    directory: false,
  });
  return selected === null ? [] : Array.isArray(selected) ? selected : [selected];
}

export async function pickSshDownloadPath(fileName: string, title: string): Promise<string | null> {
  if (isOpenHarmonyRuntime()) {
    // HarmonyOS exposes a document folder picker, rather than Tauri's save
    // dialog. Keep the existing binary transfer and the remote file's name.
    // Require one POSIX path component; backslashes and colons are valid names.
    if (!fileName || fileName === '.' || fileName === '..' || fileName.includes('/') || fileName.includes('\0')) {
      throw new Error(`Remote entry name cannot be represented as a local path component: ${JSON.stringify(fileName)}`);
    }
    const folder = await workspaceAPI.openFileOrDirectoryDialog({
      title,
      directory: true,
      multiple: false,
    });
    return typeof folder === 'string' ? `${folder.replace(/\/+$/, '')}/${fileName}` : null;
  }
  const { save } = await import('@tauri-apps/plugin-dialog');
  return save({ title, defaultPath: fileName });
}
