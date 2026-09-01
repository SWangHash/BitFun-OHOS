import { isTauriRuntime, isOpenHarmonyRuntime } from '@/infrastructure/runtime';
import { workspaceAPI } from '@/infrastructure/api';
import { i18nService } from '@/infrastructure/i18n';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import {
  describeShareStatus,
  isFileShareSupported,
  shareLocalFile,
  type FileShareMode,
} from '../services/fileShare';

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

/**
 * Share an exported local file with a nearby HarmonyOS device through the
 * system Share Kit. Surfaces a notification that matches the share outcome:
 * `dismissed`/`ok` → success, `pending_knock` → info ("tap your device…"),
 * `unsupported` → warning, anything else → error. No-op on non-OHOS hosts
 * (`shareLocalFile` returns `unsupported` there).
 *
 * Exported so the Markdown/session transcript export path can share the same
 * UX without duplicating the result-to-notification mapping.
 */
export async function shareExportedFile(filePath: string, mode: FileShareMode): Promise<void> {
  if (!isFileShareSupported()) {
    notificationService.warning(i18nService.t('flow-chat:fileShare.unsupported'));
    return;
  }
  const result = await shareLocalFile(filePath, mode);
  const status = describeShareStatus(result);
  if (status === 'ok' || status === 'dismissed') {
    notificationService.success(i18nService.t('flow-chat:fileShare.dismissed'));
    return;
  }
  if (status === 'pending_knock') {
    notificationService.info(i18nService.t('flow-chat:fileShare.pendingKnock'));
    return;
  }
  if (status === 'unsupported') {
    notificationService.warning(i18nService.t('flow-chat:fileShare.unsupported'));
    return;
  }
  log.error('Share failed', { filePath, mode, error: result.error });
  notificationService.error(i18nService.t('flow-chat:fileShare.failed'));
}

/** Whether the share-to-nearby button should be rendered in export toasts. */
export function shouldShowShareButton(): boolean {
  return isFileShareSupported();
}

/** Surface the export success notification appropriate for the save result. */
export function notifyPngExportSuccess(result: SavePngResult): void {
  const filePath = result.filePath;
  if (filePath) {
    notifyExportSuccessWithActions(
      filePath,
      i18nService.t('flow-chat:exportImage.exportSuccess', { filePath }),
      i18nService.t('flow-chat:exportImage.exportSuccessPrefix'),
    );
    return;
  }

  // Browser/webview download: the runtime managed the destination, so surface
  // a download-complete message without a revealable filesystem path.
  notificationService.success(i18nService.t('flow-chat:exportImage.exportDownloaded'));
}

/**
 * Surface an export-success toast with a Reveal-in-Explorer action and, when
 * the runtime supports Share-to-nearby (OpenHarmony host), a Share action.
 * Shared by the PNG image export and the Markdown transcript export so both
 * paths surface the same affordance set without duplicating the JSX.
 *
 * `plainMessage` is the full success string shown when message nodes are not
 * supported by the toast host; `prefix` is the leading text placed before the
 * path button. The path button itself and the optional share link are added
 * here.
 */
export function notifyExportSuccessWithActions(
  filePath: string,
  plainMessage: string,
  prefix: string,
): void {
  const shareLabel = i18nService.t('flow-chat:fileShare.button');
  notificationService.success(plainMessage, {
    messageNode: (
      <>
        {prefix}
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
        {shouldShowShareButton() && (
          <>
            {' · '}
            <button
              type="button"
              className="notification-item__path-link"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void shareExportedFile(filePath, 'discover');
              }}
            >
              {shareLabel}
            </button>
          </>
        )}
      </>
    ),
  });
}
