/**
 * File name validation helpers.
 *
 * Shared by the "new file / folder" dialog and file tree rename, aligned with VS Code:
 * empty name / invalid characters / Windows reserved names / sibling duplicates / name too long.
 */

// eslint-disable-next-line no-control-regex -- File name rules explicitly reject ASCII control characters.
const INVALID_CHARS_LOCAL = /^[^<>:"/\\|?*\x00-\x1F]+$/;
// eslint-disable-next-line no-control-regex -- File name rules explicitly reject ASCII control characters.
const INVALID_CHARS_REMOTE = /^[^/\x00-\x1F]+$/;

/**
 * Windows reserved device names (case-insensitive). Matches prefixes like `CON` and `CON.txt`.
 * Only applies to local (Windows) workspaces.
 */
const RESERVED_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;

/** Maximum length of a single path segment name (common NTFS / ext4 limit). */
export const MAX_NAME_LENGTH = 255;

export interface ValidateFileNameContext {
  /** Whether this is a remote workspace (remote relaxes invalid characters and skips Windows reserved names). */
  isRemote: boolean;
  /** Whether the validated entry is a folder, used to pick accurate error copy. */
  isDirectory?: boolean;
  /** Existing sibling names (case-insensitive comparison) used to detect duplicate conflicts. Must exclude the validated entry's own original name. */
  siblings?: string[];
  /** Maximum single path segment name length, defaults to {@link MAX_NAME_LENGTH}. */
  maxLength?: number;
}

/**
 * Validate whether a file or folder name is legal.
 *
 * @param raw Raw input value
 * @param ctx Validation context
 * @returns An i18n key (`validation.*`, relative to `panels/files.json`) on error, or null when valid.
 */
export function validateFileName(raw: string, ctx: ValidateFileNameContext): string | null {
  const trimmed = raw.trim();
  const max = ctx.maxLength ?? MAX_NAME_LENGTH;

  // 1. Empty name (including whitespace-only)
  if (!trimmed) {
    return 'validation.emptyName';
  }

  // 2. Invalid characters
  const validPattern = ctx.isRemote ? INVALID_CHARS_REMOTE : INVALID_CHARS_LOCAL;
  if (!validPattern.test(trimmed)) {
    return ctx.isDirectory
      ? 'validation.invalidFolderName'
      : 'validation.invalidFilename';
  }

  // 3. Windows reserved names (local only)
  if (!ctx.isRemote && RESERVED_NAME.test(trimmed)) {
    return 'validation.reservedName';
  }

  // 4. Sibling duplicates (case-insensitive; original name already excluded by caller)
  if (ctx.siblings && ctx.siblings.length > 0) {
    const lower = trimmed.toLowerCase();
    if (ctx.siblings.some((s) => s.toLowerCase() === lower)) {
      return 'validation.duplicateName';
    }
  }

  // 5. Name too long
  if (trimmed.length > max) {
    return 'validation.nameTooLong';
  }

  return null;
}
