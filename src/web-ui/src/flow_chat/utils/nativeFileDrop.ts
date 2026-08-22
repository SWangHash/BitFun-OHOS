import type { ContextItem } from '@/shared/types/context';
import { getMimeTypeFromFilename, isImageFile } from './imageUtils';

interface DroppedPathMetadata {
  size: number;
  isFile: boolean;
  isDir: boolean;
}

export type DroppedPathMetadataResolver = (path: string) => Promise<DroppedPathMetadata>;

function droppedPathName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

export async function resolveNativeDroppedPaths(
  paths: string[],
  getMetadata: DroppedPathMetadataResolver,
  onInspectError?: (filePath: string, error: unknown) => void,
): Promise<ContextItem[]> {
  const items: ContextItem[] = [];
  for (const [index, filePath] of paths.entries()) {
    try {
      const metadata = await getMetadata(filePath);
      const fileName = droppedPathName(filePath);
      const idSuffix = `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 11)}`;

      if (metadata.isDir) {
        items.push({
          id: `directory-${idSuffix}`,
          type: 'directory',
          directoryPath: filePath,
          directoryName: fileName,
          recursive: false,
          timestamp: Date.now(),
        });
        continue;
      }
      if (!metadata.isFile) continue;
      if (isImageFile(fileName)) {
        items.push({
          id: `image-${idSuffix}`,
          type: 'image',
          imagePath: filePath,
          imageName: fileName,
          fileSize: metadata.size,
          mimeType: getMimeTypeFromFilename(fileName),
          source: 'file',
          isLocal: true,
          timestamp: Date.now(),
          metadata: {},
        });
      } else {
        items.push({
          id: `file-${idSuffix}`,
          type: 'file',
          filePath,
          fileName,
          fileSize: metadata.size,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      onInspectError?.(filePath, error);
    }
  }
  return items;
}
