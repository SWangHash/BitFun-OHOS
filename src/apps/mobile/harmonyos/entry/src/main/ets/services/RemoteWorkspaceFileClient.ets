import { RuntimeFileLocation, FileInfo, ReadFileChunkResult, ReadFileResult } from '../model/RemoteModels';

/** Stable mobile-side port for files owned by the active remote workspace. */
export interface RemoteWorkspaceFileClient {
  getFileInfo(path: string, sessionId?: string): Promise<FileInfo>;
  readFileChunk(path: string, offset: number, limit: number, sessionId?: string): Promise<ReadFileChunkResult>;
  streamFile(path: string, sessionId: string | undefined, onChunk: (bytes: Uint8Array, info: FileInfo) => Promise<void>, onProgress?: (downloaded: number, total: number) => void, location?: RuntimeFileLocation): Promise<FileInfo>;
  readFile(
    path: string,
    sessionId?: string,
    onProgress?: (downloaded: number, total: number) => void,
    maxBytes?: number
  ): Promise<ReadFileResult>;
}
