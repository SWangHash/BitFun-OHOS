/**
 * Platform-dispatched file pickers for SSH authentication files.
 */

import { workspaceAPI } from '@/infrastructure/api/service-api/WorkspaceAPI';
import { isOpenHarmonyRuntime, isTauriRuntime } from '@/infrastructure/runtime';
import { createLogger } from '@/shared/utils/logger';
import { captureSshLocalFileHost } from './sshFileDialogs';

const log = createLogger('pickSshAuthFilePath');

async function pickSshAuthFilePath(
  kind: 'private key' | 'certificate',
  options: { title?: string } = {},
): Promise<string | null> {
  try {
    const surface = captureSshLocalFileHost();
    let defaultPath: string | undefined;
    if (isTauriRuntime() && !isOpenHarmonyRuntime()) {
      const { homeDir, join } = await import('@tauri-apps/api/path');
      defaultPath = await join(await homeDir(), '.ssh');
    }
    const selected = await workspaceAPI.openFileOrDirectoryDialog({
      multiple: false,
      directory: false,
      defaultPath,
      title: options.title,
    });
    surface.assertCurrent('SSH authentication file selection');
    return typeof selected === 'string' ? selected : null;
  } catch (e) {
    log.error(`SSH ${kind} file picker failed`, e);
    throw e;
  }
}

export function pickSshPrivateKeyPath(options: { title?: string } = {}): Promise<string | null> {
  return pickSshAuthFilePath('private key', options);
}

export function pickSshCertificatePath(options: { title?: string } = {}): Promise<string | null> {
  return pickSshAuthFilePath('certificate', options);
}
