import { systemAPI } from '@/infrastructure/api/service-api/SystemAPI';
import { isTauriRuntime } from '@/infrastructure/runtime/environment';
import { downloadTextFileInBrowser } from '@/shared/utils/browserDownload';

export interface SaveTextFileFilter {
  name: string;
  extensions: string[];
}

export interface SaveTextFileWithDialogOptions {
  title: string;
  defaultFileName: string;
  content: string;
  mimeType?: string;
  filter: SaveTextFileFilter;
}

export type SaveTextFileWithDialogResult =
  | { status: 'saved'; filePath: string }
  | { status: 'cancelled'; filePath?: undefined };

/**
 * Save user-visible text without exposing Tauri details to product UI.
 *
 * Desktop and Peer Device Mode use the controller-local host command so the
 * native dialog and destination always stay on the device the person is using.
 * Browser surfaces use an explicit browser download instead.
 */
export async function saveTextFileWithDialog({
  title,
  defaultFileName,
  content,
  mimeType = 'text/plain;charset=utf-8',
  filter,
}: SaveTextFileWithDialogOptions): Promise<SaveTextFileWithDialogResult> {
  if (!isTauriRuntime()) {
    downloadTextFileInBrowser(defaultFileName, content, mimeType);
    return { status: 'saved', filePath: defaultFileName };
  }

  return systemAPI.saveTextFileWithDialog({
    title,
    defaultFileName,
    content,
    filterName: filter.name,
    extensions: filter.extensions,
  });
}
