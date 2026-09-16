import fs from '@ohos.file.fs';
import picker from '@ohos.file.picker';
import { FileInfo, RuntimeFileLocation } from '../model/RemoteModels';
import { RemoteI18n } from '../i18n/RemoteI18n';
import { ConnectionErrorPolicy } from './ConnectionErrorPolicy';
import { RemoteWorkspaceFileClient } from './RemoteWorkspaceFileClient';
import { RemoteUiState } from './RemoteUiState';
import { RemoteLogger } from './RemoteLogger';

export interface RemoteFileDownloadClient extends RemoteWorkspaceFileClient {}

export interface RemoteFileDownloadScheduler {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timerId: number): void;
}

export interface RemoteFileSaver {
  begin(name: string): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  finish(): Promise<string>;
  abort(): Promise<void>;
}

class SystemRemoteFileDownloadScheduler implements RemoteFileDownloadScheduler {
  setTimeout(callback: () => void, delayMs: number): number {
    return setTimeout(callback, delayMs);
  }

  clearTimeout(timerId: number): void {
    clearTimeout(timerId);
  }
}

class SystemRemoteFileSaver implements RemoteFileSaver {
  private file?: fs.File;
  private uri: string = '';
  async begin(name: string): Promise<void> {
    const options = new picker.DocumentSaveOptions(); options.newFileNames = [name];
    const uris = await new picker.DocumentViewPicker().save(options);
    if (!uris.length) throw new Error('No destination file was selected.');
    const file = await fs.open(uris[0], fs.OpenMode.WRITE_ONLY | fs.OpenMode.CREATE);
    let size = 0;
    try { size = (await fs.stat(file.fd)).size; } catch (error) { await fs.close(file); throw error as Error; }
    // Document providers do not promise atomic replace. Preserve existing user
    // content and only stream into the empty new destination chosen by picker.
    if (size !== 0) { await fs.close(file); throw new Error('Choose a new destination file to preserve existing content.'); }
    this.file = file; this.uri = uris[0];
  }
  async write(bytes: Uint8Array): Promise<void> {
    if (!this.file) throw new Error('Download destination is not open.');
    let offset = 0;
    while (offset < bytes.length) {
      const buffer = bytes.slice(offset).buffer;
      const count = await fs.write(this.file.fd, buffer);
      if (count <= 0) throw new Error('Download destination write was incomplete.');
      offset += count;
    }
  }
  async finish(): Promise<string> {
    if (!this.file) throw new Error('Download destination is not open.');
    await fs.fsync(this.file.fd); await fs.close(this.file); this.file = undefined;
    const uri = this.uri; this.uri = ''; return uri;
  }
  async abort(): Promise<void> {
    const file = this.file; const uri = this.uri; this.file = undefined; this.uri = '';
    try { if (file) await fs.close(file); } finally { if (uri) await fs.unlink(uri); }
  }
}

export class RemoteFileDownloadController {
  private readonly client: RemoteFileDownloadClient;
  private readonly onDownloadStatus: (downloadingFilePath: string, downloadedFilePath: string, fileDownloadStatus: string) => void;
  private readonly onClearDownloadingFilePath: () => void;
  private readonly onStatusText: (statusText: string) => void;
  private readonly onBusy: (isBusy: boolean) => void;
  private readonly clearDelayMs: number;
  private readonly scheduler: RemoteFileDownloadScheduler;
  private readonly fileSaver: RemoteFileSaver;
  private downloadingFilePath: string = '';
  private downloadedFilePath: string = '';
  private fileDownloadStatus: string = '';
  private clearTimerId: number = 0;
  private generation: number = 0;
  private running: boolean = false;

  constructor(
    client: RemoteFileDownloadClient,
    onDownloadStatus: (downloadingFilePath: string, downloadedFilePath: string, fileDownloadStatus: string) => void,
    onClearDownloadingFilePath: () => void,
    onStatusText: (statusText: string) => void,
    onBusy: (isBusy: boolean) => void,
    clearDelayMs: number = 2500,
    scheduler: RemoteFileDownloadScheduler = new SystemRemoteFileDownloadScheduler(),
    fileSaver: RemoteFileSaver = new SystemRemoteFileSaver()
  ) {
    this.client = client;
    this.onDownloadStatus = onDownloadStatus;
    this.onClearDownloadingFilePath = onClearDownloadingFilePath;
    this.onStatusText = onStatusText;
    this.onBusy = onBusy;
    this.clearDelayMs = clearDelayMs;
    this.scheduler = scheduler;
    this.fileSaver = fileSaver;
  }

  async download(path: string, sessionId: string, isBusy: boolean, remoteAvailable: boolean, location?: RuntimeFileLocation): Promise<void> {
    const remotePath = RemoteUiState.normalizeRemoteFilePath(path);
    if ((!sessionId && !location?.path) || remotePath.length === 0 || isBusy || this.running || !remoteAvailable) {
      return;
    }
    this.cancelClearTimer();
    const generation = ++this.generation;
    this.running = true;
    try {
      RemoteLogger.info(`file_download start session=${sessionId.length > 0 ? 'set' : 'none'}`);
      this.onBusy(true);
      this.setDownloadStatus(path, '', RemoteI18n.t('status.fileInfo'));
      let opened = false;
      const result = await this.client.streamFile(remotePath, sessionId || undefined, async (bytes: Uint8Array, info: FileInfo): Promise<void> => {
        if (generation !== this.generation) throw new Error('File download cancelled.');
        if (!opened) { await this.fileSaver.begin(info.name); opened = true; }
        if (generation !== this.generation) throw new Error('File download cancelled.');
        await this.fileSaver.write(bytes);
      }, (downloaded: number, total: number) => {
        this.setDownloadStatus(path, '', `${RemoteUiState.formatBytes(downloaded)} / ${RemoteUiState.formatBytes(total)}`);
      }, location);
      if (generation !== this.generation) throw new Error('File download cancelled.');
      await this.fileSaver.finish();
      this.setDownloadStatus(
        path,
        path,
        RemoteI18n.f2('status.downloadDone', result.name, RemoteUiState.formatBytes(result.size))
      );
      this.onStatusText(this.fileDownloadStatus);
    } catch (err) {
      try { await this.fileSaver.abort(); } catch (cleanupError) { RemoteLogger.error(`file_download cleanup_failed message=${String(cleanupError)}`); }
      const errorText = ConnectionErrorPolicy.errorText(err);
      RemoteLogger.error(`file_download failed message=${errorText}`);
      this.setDownloadStatus(this.downloadingFilePath, this.downloadedFilePath, errorText);
      this.onStatusText(this.fileDownloadStatus);
    } finally {
      this.running = false;
      this.onBusy(false);
      this.scheduleClearDownloadingFilePath();
    }
  }

  clear(): void {
    this.generation++;
    this.cancelClearTimer();
    this.setDownloadStatus('', '', '');
  }

  cancel(): void {
    this.generation++;
    this.cancelClearTimer();
  }

  isClearPending(): boolean {
    return this.clearTimerId !== 0;
  }

  currentStatusText(): string {
    return this.fileDownloadStatus;
  }

  private setDownloadStatus(downloadingFilePath: string, downloadedFilePath: string, fileDownloadStatus: string): void {
    this.downloadingFilePath = downloadingFilePath;
    this.downloadedFilePath = downloadedFilePath;
    this.fileDownloadStatus = fileDownloadStatus;
    this.onDownloadStatus(downloadingFilePath, downloadedFilePath, fileDownloadStatus);
  }

  private scheduleClearDownloadingFilePath(): void {
    this.cancelClearTimer();
    this.clearTimerId = this.scheduler.setTimeout(() => {
      this.clearTimerId = 0;
      this.downloadingFilePath = '';
      this.onClearDownloadingFilePath();
    }, this.clearDelayMs);
  }

  private cancelClearTimer(): void {
    if (this.clearTimerId !== 0) {
      this.scheduler.clearTimeout(this.clearTimerId);
      this.clearTimerId = 0;
    }
  }
}
