/**
 * Export a whole session's history to a Markdown file.
 *
 * Turns are read from session persistence (not from the in-memory store) so a
 * partially hydrated history session still exports its full transcript.
 */

import { sessionAPI } from '@/infrastructure/api/service-api/SessionAPI';
import { workspaceAPI } from '@/infrastructure/api';
import { isOpenHarmonyRuntime } from '@/infrastructure/runtime';
import { i18nService } from '@/infrastructure/i18n';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { downloadMarkdownInBrowser } from '@/shared/utils/browserDownload';
import { notifyExportSuccessWithActions } from '../utils/saveExportedPng';
import type { DialogTurnData } from '@/shared/types/session-history';
import {
  collectPersistedTurn,
  formatSessionTranscriptMarkdown,
  hasTranscriptContent,
  type TranscriptExportScope,
  type TranscriptExportTurn,
} from '../utils/dialogTranscriptExport';
import { buildSessionTranscriptMarkdownLabels } from '../utils/transcriptExportLabels';

const log = createLogger('sessionMarkdownExport');

export interface SessionMarkdownExportTarget {
  sessionId: string;
  title: string;
  workspacePath?: string;
  remoteConnectionId?: string | null;
  remoteSshHost?: string | null;
}

export type SessionMarkdownExportResult =
  | { status: 'saved'; filePath?: string }
  | { status: 'cancelled' }
  | { status: 'empty' }
  | { status: 'failed' };

function isTauriDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

const FILE_NAME_RESERVED_CHARS = '\\/:*?"<>|';

/** Filesystem-safe, reasonably short file stem derived from the session title. */
export function buildSessionExportFileName(title: string, sessionId: string, exportedAt: Date): string {
  const safeTitle = Array.from(title)
    .map(char => (char < ' ' || FILE_NAME_RESERVED_CHARS.includes(char) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  const stamp = exportedAt
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  const stem = safeTitle || sessionId;
  return `${stem}_${stamp}.md`;
}

/** Build the Markdown document for already-loaded persisted turns. */
export function buildSessionMarkdown(
  turns: DialogTurnData[],
  scope: TranscriptExportScope,
  meta: { title: string; sessionId: string; exportedAt: Date; workspacePath?: string }
): string {
  const exportTurns: TranscriptExportTurn[] = turns
    .map(collectPersistedTurn)
    .filter(turn => hasTranscriptContent(turn, scope));

  return formatSessionTranscriptMarkdown(
    exportTurns,
    scope,
    meta,
    buildSessionTranscriptMarkdownLabels()
  );
}

/**
 * Load, render, and save a session transcript. Returns the outcome so callers
 * can stay silent on user cancellation.
 */
export async function exportSessionToMarkdown(
  target: SessionMarkdownExportTarget,
  scope: TranscriptExportScope
): Promise<SessionMarkdownExportResult> {
  const exportedAt = new Date();

  try {
    const turns = await sessionAPI.loadSessionTurns(
      target.sessionId,
      target.workspacePath ?? '',
      undefined,
      target.remoteConnectionId ?? undefined,
      target.remoteSshHost ?? undefined
    );

    const exportTurns = (turns ?? [])
      .map(collectPersistedTurn)
      .filter(turn => hasTranscriptContent(turn, scope));

    if (exportTurns.length === 0) {
      notificationService.warning(i18nService.t('flow-chat:transcriptExport.exportEmpty'));
      return { status: 'empty' };
    }

    const markdown = formatSessionTranscriptMarkdown(
      exportTurns,
      scope,
      {
        title: target.title,
        sessionId: target.sessionId,
        exportedAt,
        workspacePath: target.workspacePath,
      },
      buildSessionTranscriptMarkdownLabels()
    );

    const fileName = buildSessionExportFileName(target.title, target.sessionId, exportedAt);

    if (isTauriDesktop()) {
      const [{ save }, { writeFile }] = await Promise.all([
        import('@tauri-apps/plugin-dialog'),
        import('@tauri-apps/plugin-fs'),
      ]);
      const filePath = await save({
        title: i18nService.t('flow-chat:transcriptExport.saveDialogTitle'),
        defaultPath: fileName,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (!filePath) {
        return { status: 'cancelled' };
      }
      await writeFile(filePath, new TextEncoder().encode(markdown));
      notifyExportSuccessWithActions(
        filePath,
        i18nService.t('flow-chat:transcriptExport.exportSuccess', { filePath }),
        i18nService.t('flow-chat:transcriptExport.exportSuccess', { filePath: '' }),
      );
      return { status: 'saved', filePath };
    }

    if (isOpenHarmonyRuntime()) {
      // On OpenHarmony the Tauri dialog/fs plugins are not wired; route
      // through the native `save_file_to_downloads_ohos` ArkTS bridge to
      // write the transcript under <Download>/BitFun/, then surface the
      // same Reveal + Share-to-nearby notification the PNG export uses.
      // Errors degrade to the browser-download path so a failed native save
      // does not block the export entirely.
      try {
        const dataBase64 = bufferToBase64(new TextEncoder().encode(markdown));
        const filePath = await workspaceAPI.saveFileToDownloadsOhos(fileName, dataBase64);
        notifyExportSuccessWithActions(
          filePath,
          i18nService.t('flow-chat:transcriptExport.exportSuccess', { filePath }),
          i18nService.t('flow-chat:transcriptExport.exportSuccess', { filePath: '' }),
        );
        return { status: 'saved', filePath };
      } catch (error) {
        log.warn('OHOS native save failed; falling back to browser download', { error });
      }
    }

    downloadMarkdownInBrowser(fileName, markdown);
    notificationService.success(
      i18nService.t('flow-chat:transcriptExport.exportSuccess', { filePath: fileName }),
      { duration: 4000 }
    );
    return { status: 'saved', filePath: fileName };
  } catch (error) {
    log.error('Failed to export session transcript', {
      sessionId: target.sessionId,
      scope,
      error,
    });
    notificationService.error(i18nService.t('flow-chat:transcriptExport.exportFailed'));
    return { status: 'failed' };
  }
}

/** Encode bytes as a base64 string without pulling in Node Buffer. */
function bufferToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
