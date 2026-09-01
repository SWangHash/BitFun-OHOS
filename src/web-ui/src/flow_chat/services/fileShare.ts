/**
 * Share a BitFun-generated/exported local file with a nearby HarmonyOS device
 * through the system Share Kit. Routes to the `share_file_ohos` Tauri command,
 * which forwards to the ArkTS bridge registered in `EntryAbility.ets`.
 *
 * Two trigger modes share the same `systemShare.SharedData` + UDMF FILE_URI
 * transport (see `src/apps/ohos/entry/src/main/ets/services/FileShareService.ets`):
 *
 * - `discover` — proactively opens the system share panel via
 *   `systemShare.ShareController.show()`. The system surfaces nearby device
 *   discovery (HarmonyShare / copy / save-as / print, etc.). Resolves when
 *   the panel's `dismiss` callback fires.
 * - `knock` — arms a pending file consumed by the existing
 *   `harmonyShare.on('knockShare', ...)` listener the next time two devices
 *   tap, resolving immediately with `status: 'pending_knock'`.
 *
 * Non-OpenHarmony hosts return `unsupported` from the Rust bridge; callers
 * must gate on `isFileShareSupported()` before invoking and avoid silent
 * fallback to local download (per `platform-portability-design.md` §4).
 */

import { isOpenHarmonyRuntime } from '@/infrastructure/runtime';
import { api } from '@/infrastructure/api';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('fileShare');

export type FileShareMode = 'knock' | 'discover';

export interface FileShareResult {
  ok: boolean;
  error?: string;
  status?: string;
}

export interface FileShareOptions {
  title?: string;
  description?: string;
}

/**
 * Whether the current runtime can share files to nearby devices. Returns true
 * only on the OpenHarmony host — the `share_file_ohos` ArkTS bridge is not
 * registered on Tauri desktop or plain browser builds, and routing the call
 * through a desktop fallback would leak local content to a remote controller.
 */
export function isFileShareSupported(): boolean {
  return isOpenHarmonyRuntime();
}

/**
 * Share a local file with a nearby HarmonyOS device. The path is the same
 * sandbox/Download path returned by `save_file_to_downloads_ohos`; the ArkTS
 * side resolves it to a `file://` URI for the Share Kit.
 *
 * Caller responsibilities:
 * - Gate on `isFileShareSupported()` first; on `false`, surface the existing
 *   local-download path and do NOT call this function.
 * - Treat a `!ok` result as a user-visible failure — the underlying adapter
 *   reports `unsupported`, `invalid_path`, `file_not_found`,
 *   `construct_failed`, `controller_failed`, or `show_failed` with a
 *   HarmonyOS error code/message in `error`.
 */
export async function shareLocalFile(
  filePath: string,
  mode: FileShareMode,
  options?: FileShareOptions,
): Promise<FileShareResult> {
  if (!isFileShareSupported()) {
    const result: FileShareResult = { ok: false, error: 'unsupported' };
    log.warn('shareLocalFile called on unsupported runtime', { mode, filePath });
    return result;
  }

  const arg = JSON.stringify({
    path: filePath,
    mode,
    title: options?.title,
    description: options?.description,
  });

  try {
    const raw = await api.invoke<string>('share_file_ohos', { arg });
    return parseShareResult(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('share_file_ohos invoke failed', { mode, filePath, error });
    return { ok: false, error: `invoke_failed: ${message}` };
  }
}

function parseShareResult(raw: string): FileShareResult {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, error: 'empty_response' };
  }
  try {
    const parsed = JSON.parse(raw) as FileShareResult;
    if (typeof parsed?.ok === 'boolean') {
      return parsed;
    }
  } catch (error) {
    log.error('share_file_ohos returned non-JSON envelope', { raw, error });
  }
  return { ok: false, error: 'malformed_response' };
}

/**
 * Classify a `FileShareResult` into a stable status string for i18n. Returns
 * `ok` / `pending_knock` / `dismissed` / `unsupported` / `failed` so callers
 * can map to user-visible copy without re-parsing error text.
 */
export function describeShareStatus(result: FileShareResult): string {
  if (result.ok) {
    return result.status ?? 'ok';
  }
  if (result.error === 'unsupported') {
    return 'unsupported';
  }
  return 'failed';
}
