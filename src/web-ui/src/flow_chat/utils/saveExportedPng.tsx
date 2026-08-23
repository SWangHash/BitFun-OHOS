import { isTauriRuntime, isOpenHarmonyRuntime } from '@/infrastructure/runtime';
import { workspaceAPI } from '@/infrastructure/api';
import { i18nService } from '@/infrastructure/i18n';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('saveExportedPng');

export interface SavePngResult {
  /** Resolved filesystem path when saved through the native (Tauri) path. */
  filePath?: string;
  /** True when the blob was handed to the webview/browser download delegate. */
  downloaded: boolean;
}

function downloadBlobInBrowser(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const comma = dataUrl.indexOf(',');
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Persist a PNG blob for the chat-image export.
 *
 * Runtime order matters: `isTauriRuntime()` is also true on the HarmonyOS host
 * (it exposes `__TAURI_INTERNALS__` for invoke routing), but the Tauri path/fs
 * plugins are not wired there, so `downloadDir()`/`writeFile()` would throw
 * "unknown path". Check the OpenHarmony runtime FIRST and route through the
 * native `save_file_to_downloads_ohos` ArkTS function (writes to the Download
 * directory, returns the path); on failure it degrades to a browser download.
 * Plain Tauri desktop writes directly into the downloads dir; a plain browser
 * uses the anchor-download fallback.
 */
export async function savePngBlob(blob: Blob, fileName: string): Promise<SavePngResult> {
  if (isOpenHarmonyRuntime()) {
    try {
      const dataBase64 = await blobToBase64(blob);
      const filePath = await workspaceAPI.saveFileToDownloadsOhos(fileName, dataBase64);
      return { filePath, downloaded: false };
    } catch (error) {
      log.warn('OHOS native save failed; falling back to browser download', { error });
    }
    downloadBlobInBrowser(blob, fileName);
    return { downloaded: true };
  }

  if (isTauriRuntime()) {
    const [{ downloadDir, join }, { writeFile }] = await Promise.all([
      import('@tauri-apps/api/path'),
      import('@tauri-apps/plugin-fs'),
    ]);
    const downloadsPath = await downloadDir();
    const filePath = await join(downloadsPath, fileName);
    const arrayBuffer = await blob.arrayBuffer();
    await writeFile(filePath, new Uint8Array(arrayBuffer));
    return { filePath, downloaded: false };
  }

  downloadBlobInBrowser(blob, fileName);
  return { downloaded: true };
}

/** Reveal a saved file in the platform file manager (Tauri desktop and OHOS). */
export async function revealExportedFile(filePath: string): Promise<void> {
  // The browser-download path never produces a filePath, so this is only
  // reached when a native save returned a path. Errors are swallowed so a
  // failed reveal never breaks the success notification.
  try {
    await workspaceAPI.revealInExplorer(filePath);
  } catch (error) {
    log.error('Failed to reveal export path in file manager', { filePath, error });
  }
}

/** Surface the export success notification appropriate for the save result. */
export function notifyPngExportSuccess(result: SavePngResult): void {
  const filePath = result.filePath;
  if (filePath) {
    const plainSuccessMessage = i18nService.t('flow-chat:exportImage.exportSuccess', { filePath });
    const successPrefix = i18nService.t('flow-chat:exportImage.exportSuccessPrefix');
    notificationService.success(plainSuccessMessage, {
      messageNode: (
        <>
          {successPrefix}
          <button
            type="button"
            className="notification-item__path-link"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void revealExportedFile(filePath);
            }}
          >
            {filePath}
          </button>
        </>
      ),
    });
    return;
  }

  // Browser/webview download: the runtime managed the destination, so surface
  // a download-complete message without a revealable filesystem path.
  notificationService.success(i18nService.t('flow-chat:exportImage.exportDownloaded'));
}
