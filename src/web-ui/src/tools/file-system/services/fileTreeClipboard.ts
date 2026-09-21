/**
 * In-app clipboard for file-tree copy/cut/paste.
 *
 * The tree's paste previously relied solely on the OS pasteboard, which never
 * receives anything from an in-app copy/cut action — the tree does not write
 * file URIs to the system pasteboard — so pasting right after copying inside
 * the tree always reported "no files in clipboard". This module-level store
 * gives the tree a first-class internal clipboard; the OS pasteboard remains
 * the fallback for files copied in external file managers.
 */

export interface FileTreeClipboardState {
  paths: string[];
  isCut: boolean;
}

let clipboardState: FileTreeClipboardState | null = null;

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
