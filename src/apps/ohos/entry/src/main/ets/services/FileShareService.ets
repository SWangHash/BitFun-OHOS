import { common } from '@kit.AbilityKit';
import { systemShare } from '@kit.ShareKit';
import { uniformTypeDescriptor as utd } from '@kit.ArkData';
import { fileIo, fileUri } from '@kit.CoreFileKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const SHARE_DOMAIN: number = 0x0000;
const SHARE_TAG: string = 'BitFunFileShare';

export type FileShareMode = 'knock' | 'discover';

export interface FileShareRequest {
  path: string;
  mode: FileShareMode;
  title?: string;
  description?: string;
}

export interface FileShareResult {
  ok: boolean;
  error?: string;
  status?: string;
}

export interface PendingShareFile {
  uri: string;
  utdTypeId: string;
  title: string;
  description: string;
}

interface FileShareRecord {
  utd: string;
  uri: string;
  title: string;
  description: string;
}

interface FileShareControllerOptions {
  previewMode: systemShare.SharePreviewMode;
  selectionMode: systemShare.SelectionMode;
}

/**
 * Sends a BitFun-generated/exported local file to a nearby HarmonyOS device
 * through the system Share Kit. Two trigger modes share the same
 * `systemShare.SharedData` + UDMF FILE_URI transport:
 *
 * - `discover` — proactively opens the system share panel via
 *   `systemShare.ShareController.show()`. The system surfaces nearby device
 *   discovery (HarmonyShare / copy / save-as / print, etc.). Resolves when the
 *   panel's `dismiss` callback fires.
 * - `knock` — arms a pending file on this service; the EntryAbility's existing
 *   `harmonyShare.on('knockShare', ...)` listener picks it up the next time two
 *   devices tap. Resolves immediately with `status: 'pending_knock'`.
 *
 * HarmonyOS-private Share Kit fields do not leak out of this adapter: callers
 * only see `FileShareRequest` / `FileShareResult` and an ArkTS bridge function
 * registered in `EntryAbility`. The desktop/non-OHOS Rust bridge returns
 * `unsupported` rather than routing here.
 */
export class FileShareService {
  private static instance: FileShareService | null = null;
  private context: common.UIAbilityContext | null = null;
  private pendingFile: PendingShareFile | null = null;

  private constructor() {}

  static getInstance(): FileShareService {
    if (FileShareService.instance === null) {
      FileShareService.instance = new FileShareService();
    }
    return FileShareService.instance;
  }

  setContext(context: common.UIAbilityContext): void {
    this.context = context;
  }

  /**
   * Take the pending file armed by a `knock` request, if any. Called by
   * EntryAbility's knockShare listener before falling back to the URL share.
   * Returns the pending file and clears the slot, so a missed tap does not
   * leak across invocations.
   */
  takePendingFile(): PendingShareFile | null {
    const file = this.pendingFile;
    this.pendingFile = null;
    return file;
  }

  /** Whether a knock-armed file is waiting for a tap. Drives listener gating. */
  hasPendingFile(): boolean {
    return this.pendingFile !== null;
  }

  /**
   * Build a `systemShare.SharedData` from a pending file. Exposed so the
   * EntryAbility's knockShare listener can hand the file to
   * `SharableTarget.share()` without re-declaring the SharedRecord literal
   * (which would leak HarmonyOS-private record shape across files).
   */
  buildSharedData(pending: PendingShareFile): systemShare.SharedData {
    const record: FileShareRecord = {
      utd: pending.utdTypeId,
      uri: pending.uri,
      title: pending.title,
      description: pending.description,
    };
    return new systemShare.SharedData(record);
  }

  async handle(req: FileShareRequest): Promise<string> {
    if (this.context === null) {
      return this.stringify({ ok: false, error: 'no_context' });
    }
    const context = this.context;

    const pathError = this.validatePath(req.path);
    if (pathError !== null) {
      return this.stringify({ ok: false, error: pathError });
    }

    const ext = this.getExtension(req.path);
    const utdTypeId = this.resolveUtd(ext);
    const title = req.title ?? this.getFileName(req.path);
    const description = req.description ?? '';
    const uri = this.resolveFileUri(req.path);

    if (req.mode === 'knock') {
      return this.handleKnock(uri, utdTypeId, title, description);
    }
    return this.handleDiscover(uri, utdTypeId, title, description, context);
  }

  private async handleKnock(
    uri: string,
    utdTypeId: string,
    title: string,
    description: string,
  ): Promise<string> {
    const pending: PendingShareFile = {
      uri: uri,
      utdTypeId: utdTypeId,
      title: title,
      description: description,
    };
    this.pendingFile = pending;
    hilog.info(
      SHARE_DOMAIN,
      SHARE_TAG,
      `knock armed: uri=${uri}, utd=${utdTypeId}, title=${title}`,
    );
    return this.stringify({ ok: true, status: 'pending_knock' });
  }

  private async handleDiscover(
    uri: string,
    utdTypeId: string,
    title: string,
    description: string,
    context: common.UIAbilityContext,
  ): Promise<string> {
    let shareData: systemShare.SharedData;
    try {
      const record: FileShareRecord = {
        utd: utdTypeId,
        uri: uri,
        title: title,
        description: description,
      };
      shareData = new systemShare.SharedData(record);
    } catch (e) {
      const be = e as BusinessError;
      hilog.error(
        SHARE_DOMAIN,
        SHARE_TAG,
        `SharedData construct failed: code=${be.code}, msg=${be.message}`,
      );
      return this.stringify({ ok: false, error: 'construct_failed: ' + be.message });
    }

    let controller: systemShare.ShareController;
    try {
      controller = new systemShare.ShareController(shareData);
    } catch (e) {
      const be = e as BusinessError;
      hilog.error(
        SHARE_DOMAIN,
        SHARE_TAG,
        `ShareController construct failed: code=${be.code}, msg=${be.message}`,
      );
      return this.stringify({ ok: false, error: 'controller_failed: ' + be.message });
    }

    return new Promise<string>((resolve: (value: string) => void): void => {
      const dismissCallback = (): void => {
        try {
          controller.off('dismiss', dismissCallback);
        } catch (e) {
          const be = e as BusinessError;
          hilog.warn(
            SHARE_DOMAIN,
            SHARE_TAG,
            `off('dismiss') failed: code=${be.code}, msg=${be.message}`,
          );
        }
        resolve(this.stringify({ ok: true, status: 'dismissed' }));
      };
      try {
        controller.on('dismiss', dismissCallback);
      } catch (e) {
        const be = e as BusinessError;
        hilog.warn(
          SHARE_DOMAIN,
          SHARE_TAG,
          `on('dismiss') failed: code=${be.code}, msg=${be.message}`,
        );
      }

      const options: FileShareControllerOptions = {
        previewMode: systemShare.SharePreviewMode.DEFAULT,
        selectionMode: systemShare.SelectionMode.SINGLE,
      };
      controller
        .show(context, options)
        .then((): void => {
          hilog.info(SHARE_DOMAIN, SHARE_TAG, `ShareController show resolved`);
        })
        .catch((error: BusinessError): void => {
          try {
            controller.off('dismiss', dismissCallback);
          } catch (_e) {
            // best-effort cleanup
          }
          hilog.error(
            SHARE_DOMAIN,
            SHARE_TAG,
            `ShareController show failed: code=${error.code}, msg=${error.message}`,
          );
          resolve(
            this.stringify({
              ok: false,
              error: 'show_failed: code=' + error.code + ' msg=' + error.message,
            }),
          );
        });
    });
  }

  private validatePath(path: string): string | null {
    if (path.length === 0) {
      return 'invalid_path: empty';
    }
    try {
      fileIo.accessSync(path, fileIo.AccessModeType.EXIST);
      return null;
    } catch (e) {
      const be = e as BusinessError;
      return 'file_not_found: code=' + be.code;
    }
  }

  private resolveFileUri(path: string): string {
    if (path.startsWith('file://') || path.startsWith('docs://')) {
      return path;
    }
    return fileUri.getUriFromPath(path);
  }

  private getExtension(path: string): string {
    const slash = path.lastIndexOf('/');
    const name = slash >= 0 ? path.slice(slash + 1) : path;
    const dot = name.lastIndexOf('.');
    if (dot <= 0) {
      return '';
    }
    return name.slice(dot);
  }

  private resolveUtd(ext: string): string {
    if (ext.length === 0) {
      return utd.UniformDataType.FILE;
    }
    try {
      return utd.getUniformDataTypeByFilenameExtension(ext, utd.UniformDataType.FILE);
    } catch (e) {
      const be = e as BusinessError;
      hilog.warn(
        SHARE_DOMAIN,
        SHARE_TAG,
        `getUniformDataTypeByFilenameExtension failed for '${ext}': code=${be.code}, msg=${be.message}`,
      );
      return utd.UniformDataType.FILE;
    }
  }

  private getFileName(path: string): string {
    const slash = path.lastIndexOf('/');
    return slash >= 0 ? path.slice(slash + 1) : path;
  }

  private stringify(result: FileShareResult): string {
    return JSON.stringify(result);
  }
}
