import { bundleManager } from "@kit.AbilityKit";
import hilog from "@ohos.hilog";
import filePicker from '@ohos.file.picker';
import fs from '@ohos.file.fs';
import fileUri from "@ohos.file.fileuri";
import pasteboard from '@ohos.pasteboard';
import { util } from '@kit.ArkTS';
import { Err, Ok, Result } from "./Result";

export class CommonUtils {
  static getBundleName(): string {
    let bundleName = "";
    try {
      bundleName = bundleManager.getBundleInfoForSelfSync(bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT).name;
    } catch (e) {
      hilog.warn(0x0000, 'vnext', 'getBundleName failed' + e);
    }
    return bundleName;
  }

  static async open_file_dialog(arg: string): Promise<string> {
    // Options JSON shape (aligned with @tauri-apps/plugin-dialog OpenDialogOptions):
    //   { multiple?: boolean, directory?: boolean, filters?: { name: string, extensions: string[] }[] }
    // `directory` is tri-state: true→FOLDER, false→FILE, undefined→MIXED (legacy default).
    // `filters[].extensions` are dot-less; OHOS `fileSuffixFilters` wants a leading dot.
    // Multi-filter groups are flattened into a single suffix array (OHOS has no group UI).
    // Returns JSON: { paths: string[] } on success, { paths: [] } on cancel, { error: string } on failure.
    let opts: PickerOptions = {};
    try {
      if (arg && arg.length > 0) {
        opts = JSON.parse(arg) as PickerOptions;
      }
    } catch (e) {
      hilog.warn(0x0000, 'vnext', 'open_file_dialog: invalid options json, fallback to defaults: ' + e);
    }

    const multiple: boolean = opts.multiple === true;
    // tri-state: true→FOLDER, false→FILE, undefined→MIXED
    const selectMode: number = opts.directory === true
      ? filePicker.DocumentSelectMode.FOLDER
      : opts.directory === false
        ? filePicker.DocumentSelectMode.FILE
        : filePicker.DocumentSelectMode.MIXED;

    try {
      hilog.info(0x0000, 'vnext', `open_file_dialog: multiple=${multiple}, mode=${selectMode}`);
      const documentOptions = new filePicker.DocumentSelectOptions;
      // Mirror reveal_in_explorer path→URI conversion so the picker opens at the
      // caller-supplied path (e.g. the parent directory shown in NewProjectDialog)
      // instead of the hardcoded default. Fallback keeps legacy behavior.
      const defaultPathRaw: string = (opts.defaultPath ?? '').trim();
      let defaultUri: string = 'file://docs/storage/Users/currentUser';
      if (defaultPathRaw.length > 0) {
        if (defaultPathRaw.startsWith('file://')) {
          defaultUri = defaultPathRaw;
        } else if (defaultPathRaw.startsWith('/data/storage/')) {
          defaultUri = fileUri.getUriFromPath(defaultPathRaw);
        } else {
          defaultUri = 'file://docs' + defaultPathRaw;
        }
      }
      documentOptions.defaultFilePathUri = defaultUri;
      documentOptions.selectMode = selectMode;
      documentOptions.maxSelectNumber = multiple ? 500 : 1;

      // File-type filters only apply when not in FOLDER mode. Flatten all filter groups
      // into one suffix list, each with a leading dot.
      if (selectMode !== filePicker.DocumentSelectMode.FOLDER && opts.filters && opts.filters.length > 0) {
        const suffixes: string[] = [];
        for (const f of opts.filters) {
          const exts = f?.extensions ?? [];
          for (const ext of exts) {
            const normalized = ext.startsWith('.') ? ext : '.' + ext;
            if (suffixes.indexOf(normalized) < 0) {
              suffixes.push(normalized);
            }
          }
        }
        if (suffixes.length > 0) {
          documentOptions.fileSuffixFilters = suffixes;
        }
      }

      const documentPicker = new filePicker.DocumentViewPicker();
      hilog.info(0x0000, 'vnext', 'open filePicker success');
      const select: string[] = await documentPicker.select(documentOptions);
      if (!select || select.length === 0) {
        // user cancelled
        return JSON.stringify({ paths: [] });
      }
      const paths = select.map((uri: string) => {
        const fileUrl = new fileUri.FileUri(uri);
        return fileUrl.path
      });
      return JSON.stringify({ paths });
    } catch (e) {
      return JSON.stringify({ error: 'open file or folder failed: ' + e });
    }
  }

  static async save_text_file_dialog(arg: string): Promise<string> {
    let opts: SaveTextFileOptions;
    try {
      opts = JSON.parse(arg) as SaveTextFileOptions;
    } catch (e) {
      return JSON.stringify({ status: 'failed', error: 'Invalid save text file request: ' + e });
    }

    const defaultFileName = (opts.defaultFileName ?? '').trim();
    if (defaultFileName.length === 0) {
      return JSON.stringify({ status: 'failed', error: 'Missing default file name.' });
    }

    let file: fs.File | undefined = undefined;
    try {
      const saveOptions = new filePicker.DocumentSaveOptions();
      saveOptions.newFileNames = [defaultFileName];
      const uris = await new filePicker.DocumentViewPicker().save(saveOptions);
      if (!uris || uris.length === 0) {
        return JSON.stringify({ status: 'cancelled' });
      }

      const uri = uris[0];
      file = fs.openSync(uri, fs.OpenMode.WRITE_ONLY | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
      const content = new util.TextEncoder().encodeInto(opts.content ?? '');
      fs.writeSync(file.fd, content.buffer);
      return JSON.stringify({ status: 'saved', filePath: uri });
    } catch (e) {
      return JSON.stringify({ status: 'failed', error: 'Failed to save text file: ' + e });
    } finally {
      if (file) {
        fs.closeSync(file);
      }
    }
  }

  /// Normalize a docs:// (or file://) URI from the picker / pasteboard into the
  /// sandbox-relative path the Rust side expects. Mirrors the two-step
  /// normalization that originally lived inline in `open_file_dialog`:
  ///   1. `fileUri.FileUri(uri).path` — strip the `file://docs/...` prefix.
  ///   2. remap appdata → /data/storage, and the bundle name → `base`.
  /// Extracted so the picker and the clipboard reader stay in sync.
  static normalizeFileUri(uri: string): string {
    const fileUrl = new fileUri.FileUri(uri);
    const bundleName = CommonUtils.getBundleName();
    const tmp = fileUrl.path.replace('/storage/Users/currentUser/appdata', '/data/storage');
    return tmp.replace(bundleName, 'base');
  }

  /// Read file paths from the OHOS system pasteboard.
  ///
  /// When the user taps "复制" (copy) in the system file manager, the manager
  /// writes file URIs (docs/file domain) to the system pasteboard. The Rust
  /// side runs inside the app sandbox and CANNOT open those user-domain paths
  /// directly ("Source file does not exist"), so this bridge copies each
  /// clipboard URI into the app cache directory first (`fs.open` on the URI
  /// consumes the pasteboard grant) and returns the sandbox cache paths.
  ///
  /// Iterates every record and collects file URIs from both the legacy `uri` /
  /// `plainText` fields and URI/plain-text MIME entries. Some system file
  /// managers store file lists only in those additional entries. Returns the
  /// same envelope as `open_file_dialog`: `{ paths: string[] }` /
  /// `{ paths: [] }` (no files) / `{ error: string }`.
  static async read_clipboard_files(cacheDir: string): Promise<string> {
    try {
      const systemPasteboard = pasteboard.getSystemPasteboard();
      const hasData = await systemPasteboard.hasData();
      if (!hasData) {
        return JSON.stringify({ paths: [] });
      }

      const data = await systemPasteboard.getData();
      const recordCount = data.getRecordCount();
      const paths: string[] = [];
      const errors: string[] = [];
      const seen = new Set<string>();
      for (let index = 0; index < recordCount; index++) {
        const record = data.getRecord(index);
        const candidates: string[] = [];
        const addStringCandidates = (value: string): void => {
          for (const line of value.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed.length > 0) {
              candidates.push(trimmed);
            }
          }
        };

        addStringCandidates(record.uri || '');
        addStringCandidates(record.plainText || '');

        // File Manager can place URI and plain-text values in additional MIME
        // entries. Those values are only available through getData().
        const supportedTypes = record.getValidTypes([
          pasteboard.MIMETYPE_TEXT_URI,
          pasteboard.MIMETYPE_TEXT_PLAIN
        ]);
        for (const type of supportedTypes) {
          try {
            const value = await record.getData(type);
            if (typeof value === 'string') {
              addStringCandidates(value);
            }
          } catch (e) {
            hilog.warn(0x0000, 'vnext', 'read_clipboard_files: failed to read mime entry ' + type + ': ' + e);
          }
        }
        hilog.info(0x0000, 'vnext',
          'read_clipboard_files: record ' + index + '/' + recordCount
          + ' types=' + JSON.stringify(supportedTypes)
          + ' uri=' + (record.uri ? String(record.uri) : '')
          + ' candidates=' + JSON.stringify(candidates));

        for (const candidate of candidates) {
          if (seen.has(candidate)) {
            continue;
          }
          // Only URIs (file:// / docs://) carry a pasteboard read grant; a
          // copied plain-text snippet that merely looks like a path is not a
          // pasteable file.
          const looksLikeFileUri = candidate.startsWith('file://')
            || candidate.startsWith('docs://');
          if (!looksLikeFileUri) {
            continue;
          }
          seen.add(candidate);
          try {
            const fileName = CommonUtils.fileNameFromClipboardUri(candidate);
            if (fileName.length === 0) {
              hilog.warn(0x0000, 'vnext', 'read_clipboard_files: cannot resolve file name for ' + candidate);
              continue;
            }
            const destPath = (cacheDir.replace(/\/+$/, '')) + '/' + fileName;
            await CommonUtils.copy_pasteboard_entry(candidate, destPath);
            hilog.info(0x0000, 'vnext', 'read_clipboard_files: cached ' + candidate + ' -> ' + destPath);
            paths.push(destPath);
          } catch (e) {
            // Grant-less URIs and unreadable directories land here — surface
            // the reason in the envelope so a paste that silently misses a
            // folder can be diagnosed from the frontend instead of the log.
            hilog.warn(0x0000, 'vnext', 'read_clipboard_files: skip uri ' + candidate + ': ' + e);
            errors.push(candidate + ': ' + e);
          }
        }
      }

      return JSON.stringify({ paths, errors });
    } catch (e) {
      return JSON.stringify({ error: 'read clipboard files failed: ' + e });
    }
  }

  /// Copy one pasteboard URI (file or directory) into the app cache.
  ///
  /// Directories are expanded into the cache: the file manager writes the
  /// folder itself as a single URI record, so the paste needs to materialize
  /// the tree here or the whole folder silently disappears. `fs.copyDir` runs
  /// first — it operates on the granted URI inside the fs layer, so no
  /// per-child URI (and therefore no per-child pasteboard grant) is needed;
  /// the manual walk stays as a fallback for engines where copyDir rejects
  /// URI sources. Any failure surfaces to the caller so the outer
  /// per-candidate handler records the reason instead of skipping silently.
  static async copy_pasteboard_entry(sourceUri: string, destPath: string): Promise<void> {
    let isDirectory = false;
    try {
      const stat = await fs.stat(sourceUri);
      isDirectory = stat.isDirectory();
    } catch (e) {
      // stat on a grant-less or unsupported URI falls through to the file copy
      // attempt, which reproduces the pre-folder behavior for files.
      hilog.warn(0x0000, 'vnext', 'copy_pasteboard_entry: stat failed for ' + sourceUri + ': ' + e);
    }

    // Re-pasting the same entry must not collide with a stale cache copy in
    // either form (directory or file).
    try {
      await fs.rmdir(destPath);
    } catch (e) {
      // Absent, or a stale file — handled by unlink below.
    }
    try {
      await fs.unlink(destPath);
    } catch (e) {
      // Absent, or a stale directory — handled by rmdir above.
    }

    if (isDirectory) {
      // Strategy 1: native recursive copy — operates on the granted URI inside
      // the fs layer, so no per-child URI (and no per-child pasteboard grant)
      // is needed. Some OHOS builds reject URI sources here ("no such file or
      // directory"), which is why the manual walk stays as a fallback.
      await CommonUtils.copy_pasteboard_directory(sourceUri, destPath);
      return;
    }

    try {
      const source = await fs.open(sourceUri, fs.OpenMode.READ_ONLY);
      try {
        await fs.copyFile(source.fd, destPath);
      } finally {
        await fs.close(source.fd);
      }
    } catch (fileError) {
      // Folder URIs that stat cannot classify land here: opening the
      // directory fails with ENOENT while the pasteboard grant is valid for
      // the subtree. Retry the directory strategies before surfacing
      // (issue #473 verification: "no such file or directory").
      hilog.warn(0x0000, 'vnext', 'copy_pasteboard_entry: file copy failed for ' + sourceUri + ', retrying as directory: ' + fileError);
      await CommonUtils.copy_pasteboard_directory(sourceUri, destPath);
    }
  }

  /// Copy a pasteboard URI as a directory: copyDir first, then the manual
  /// walk. Shared by the stat-detected directory path and the file-branch
  /// retry for folder URIs that stat cannot classify.
  private static async copy_pasteboard_directory(sourceUri: string, destPath: string): Promise<void> {
    try {
      await fs.copyDir(sourceUri, destPath);
      return;
    } catch (e) {
      hilog.warn(0x0000, 'vnext', 'copy_pasteboard_directory: copyDir failed for ' + sourceUri + ': ' + e);
    }
    await fs.mkdir(destPath, true);
    const children = await fs.listFile(sourceUri);
    let copied = 0;
    for (const child of children) {
      const childSource = sourceUri.endsWith('/') ? sourceUri + child : sourceUri + '/' + child;
      try {
        await CommonUtils.copy_pasteboard_entry(childSource, destPath + '/' + child);
        copied += 1;
      } catch (e) {
        hilog.warn(0x0000, 'vnext', 'copy_pasteboard_entry: skip child ' + childSource + ': ' + e);
      }
    }
    if (children.length > 0 && copied === 0) {
      throw new Error('no child of ' + sourceUri + ' could be copied into the cache');
    }
  }

  /// Write file paths to the OHOS system pasteboard so external file managers
  /// can paste them.
  ///
  /// Each workspace path is converted to a `file://` URI record plus one
  /// plain-text record with the newline-joined URI list; the latter mirrors
  /// what `read_clipboard_files` accepts from third-party writers. Payload
  /// shape: `{ "paths": string[] }`; envelope: `{ ok: true, count }` or
  /// `{ ok: false, error }`.
  static async write_clipboard_files(payload: string): Promise<string> {
    try {
      const parsed = JSON.parse(payload) as ClipboardWritePayload;
      let rawPaths: string[] = [];
      if (parsed && parsed.paths) {
        rawPaths = parsed.paths;
      }
      const uris: string[] = [];
      for (const path of rawPaths) {
        const trimmed = path.trim();
        if (trimmed.length === 0) {
          continue;
        }
        try {
          uris.push(fileUri.getUriFromPath(trimmed));
        } catch (e) {
          hilog.warn(0x0000, 'vnext', 'write_clipboard_files: cannot resolve uri for ' + trimmed + ': ' + e);
        }
      }
      if (uris.length === 0) {
        return JSON.stringify({ ok: false, error: 'no valid file paths to copy' });
      }

      const data = pasteboard.createData(pasteboard.MIMETYPE_TEXT_URI, uris[0]);
      for (let index = 1; index < uris.length; index++) {
        data.addUriRecord(uris[index]);
      }
      data.addRecord(pasteboard.MIMETYPE_TEXT_PLAIN, uris.join('\n'));
      await pasteboard.getSystemPasteboard().setData(data);
      hilog.info(0x0000, 'vnext', 'write_clipboard_files: wrote ' + uris.length + ' uri record(s)');
      return JSON.stringify({ ok: true, count: uris.length });
    } catch (e) {
      return JSON.stringify({ ok: false, error: 'write clipboard files failed: ' + e });
    }
  }

  /// Resolves a clipboard URI to a plain file name for the cache copy.
  static fileNameFromClipboardUri(uri: string): string {
    try {
      const fileUriObject = new fileUri.FileUri(uri);
      const name: string = fileUriObject.name;
      if (name && name.length > 0) {
        return name;
      }
    } catch (e) {
      hilog.warn(0x0000, 'vnext', 'fileNameFromClipboardUri: FileUri.name failed: ' + e);
    }
    // Fallback: take the last non-empty segment of the URI path.
    const withoutScheme = uri.replace(/^[a-zA-Z]+:\/\//, '');
    const segments = withoutScheme.split('/').filter(s => s.length > 0);
    return segments.length > 0 ? segments[segments.length - 1] : '';
  }
}

interface PickerFilter {
  name: string;
  extensions: string[];
}

/// Payload written by the Rust clipboard bridge for `write_clipboard_files`.
interface ClipboardWritePayload {
  paths?: string[];
}

interface PickerOptions {
  multiple?: boolean;
  directory?: boolean;
  filters?: PickerFilter[];
  defaultPath?: string;
}

interface SaveTextFileOptions {
  defaultFileName?: string;
  content?: string;
}
