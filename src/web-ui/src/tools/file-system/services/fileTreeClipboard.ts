/**
 * In-app clipboard for file-tree copy/cut/paste.
 *
 * The tree's paste previously relied solely on the OS pasteboard, which never
 * receives anything from an in-app copy/cut action — the tree does not write
 * file URIs to the system pasteboard — so pasting right after copying inside
 * the tree always reported "no files in clipboard". This module-level store
 * gives the tree a first-class internal clipboard; the OS pasteboard remains
 * the fallback for files copied in external file managers.
 *
 * Because the tree also mirrors its copy/cut into the OS pasteboard (issue
 * #326), a live pasteboard read alone cannot tell "the same files the tree
 * just copied" from "a newer external copy". The panel therefore snapshots
 * the pasteboard right after every tree copy/cut and compares it at paste
 * time: a pasteboard that differs from the snapshot holds a fresh external
 * copy and wins over the internal clipboard.
 */

export interface FileTreeClipboardState {
  paths: string[];
  isCut: boolean;
}

let clipboardState: FileTreeClipboardState | null = null;

let systemSnapshot: string[] | null = null;

export function setFileTreeClipboard(paths: string[], isCut: boolean): void {
  const normalized = paths.map(path => path.trim()).filter(Boolean);
  clipboardState = normalized.length > 0 ? { paths: normalized, isCut } : null;
}

export function getFileTreeClipboard(): FileTreeClipboardState | null {
  return clipboardState;
}

export function clearFileTreeClipboard(): void {
  clipboardState = null;
}

/** Remember the OS pasteboard content observed right after a tree copy/cut. */
export function setFileTreeClipboardSystemSnapshot(paths: string[] | null): void {
  const normalized = paths?.map(path => path.trim()).filter(Boolean) ?? [];
  systemSnapshot = normalized.length > 0 ? normalized : null;
}

export function getFileTreeClipboardSystemSnapshot(): string[] | null {
  return systemSnapshot;
}

/**
 * Whether the pasteboard files differ from the snapshot taken at copy time,
 * i.e. something was copied externally after the tree's own copy/cut. Callers
 * must pass already-normalized paths (same normalization for both inputs).
 */
export function systemClipboardHasExternalCopy(files: string[], snapshot: string[] | null): boolean {
  if (files.length === 0) {
    return false;
  }
  if (!snapshot || files.length !== snapshot.length) {
    return true;
  }
  const sortedFiles = [...files].sort();
  const sortedSnapshot = [...snapshot].sort();
  return sortedFiles.some((path, index) => path !== sortedSnapshot[index]);
}
