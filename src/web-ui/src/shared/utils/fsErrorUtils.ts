/**
 * Heuristic detection of "file not found" from API/FS errors (local + remote).
 */

export function isLikelyFileNotFoundError(err: unknown): boolean {
  const s = String(err).toLowerCase();
  return (
    s.includes('no such file') ||
    s.includes('does not exist') ||
    s.includes('not found') ||
    s.includes('os error 2') ||
    s.includes('enoent') ||
    s.includes('path not found')
  );
}

export function isFilePermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /permission denied|operation not permitted|access denied|eacces|eperm|os error (?:1|5|13)\b/i.test(message);
}

/** Metadata from get_file_metadata uses camelCase fields from desktop commands. */
export function isFileMissingFromMetadata(fileInfo: unknown): boolean {
  if (!fileInfo || typeof fileInfo !== 'object') {
    return true;
  }
  const metadata = fileInfo as { isFile?: unknown };
  return metadata.isFile !== true;
}
