/**
 * Loads the qt-harmonyos-migration ledgers and keeps a per-root snapshot fresh.
 *
 * Refresh sources (all funnel into a debounced `scheduleRefresh`):
 *  - backend file watcher (local roots outside watcher-excluded directories);
 *  - metadata polling (2 s without watcher, 5 s safety net with watcher);
 *  - migration tool events from the flow-chat tool pipeline.
 *
 * Existence checks go through `check_path_exists` so probing for ledgers that
 * do not exist yet stays silent in the logs.
 *
 * Files are re-read only when their `modified`/`size` metadata changed.
 * A failed refresh keeps the previous snapshot and records the error.
 */

import { systemAPI, workspaceAPI } from '@/infrastructure/api';
import { tauriExplorerFileSystemProvider } from '@/tools/file-explorer/provider/TauriExplorerFileSystemProvider';
import { createLogger } from '@/shared/utils/logger';
import {
  LEDGER_DIR_SEGMENTS,
  LEDGER_DOCUMENT_FILES,
  LEDGER_TSV_FILES,
  LEDGER_TSV_HEADERS,
  ALL_LEDGER_FILES,
  isSkillAssetPath,
} from '../model/ledgerSchema';
import type { LedgerDocument, MigrationLedgerInput, ParsedTsv } from '../model/types';
import { parseTsv } from '../parsers/parseTsv';
import { parseStateMd } from '../parsers/parseStateMd';
import { ACTIVE_WRITE_WINDOW_MS, deriveSnapshot, getAppRoot } from './deriveSnapshot';
import { featureRows } from './deriveExternalFeatures';
import { FeaturePackageReader, createFeatureFileSystem } from './featurePackages';
import { gatesForRoot, useMigrationProgressStore } from '../store/useMigrationProgressStore';

const log = createLogger('MigrationProgressService');

export const POLL_INTERVAL_MS = 2_000;
export const WATCH_SAFETY_POLL_MS = 5_000;
export const REFRESH_DEBOUNCE_MS = 300;
const SEARCH_MAX_DEPTH = 2;
const SEARCH_MAX_DIRS = 120;

/** Directories ignored by the backend file watcher and by the ledger search. */
const WATCH_EXCLUDED_DIRS = new Set(['build', 'out', 'bin', 'dist', 'target', 'env', 'vendor', 'node_modules', '.git']);
const SEARCH_SKIPPED_DIRS = new Set([...WATCH_EXCLUDED_DIRS, '.bitfun', '.idea', '.vscode', '.venv', 'venv', '__pycache__']);

// ---------------------------------------------------------------- path utils

function separatorOf(path: string): string {
  return path.includes('\\') && !path.includes('/') ? '\\' : '/';
}

export function joinSegments(base: string, ...segments: string[]): string {
  const sep = separatorOf(base);
  const parts = segments.flatMap((segment) => segment.split(/[\\/]+/)).filter(Boolean);
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep);
}

function isAbsolute(path: string): boolean {
  return /^([A-Za-z]:[\\/]|\/|\\\\|~)/.test(path);
}

export function normalizeRootKey(path: string): string {
  return path.replace(/[\\/]+$/, '');
}

export function isLedgerRootPath(path: string): boolean {
  return /(^|[\\/])migration[\\/]ohos$/i.test(normalizeRootKey(path));
}

/**
 * Turn a command path hint (ledger root or app root, maybe relative) into a
 * ledger root. Relative hints resolve against `basePath` (the command's working
 * directory, else the workspace). Paths inside the skill are rejected.
 */
export function ledgerRootFromHint(hint: string, basePath?: string): string | null {
  let candidate = hint.trim();
  if (!candidate) return null;
  if (!isAbsolute(candidate)) {
    if (!basePath) return null;
    candidate = candidate === '.' ? basePath : joinSegments(basePath, candidate.replace(/^\.[\\/]/, ''));
  }
  candidate = normalizeRootKey(candidate);
  const root = isLedgerRootPath(candidate) ? candidate : joinSegments(candidate, ...LEDGER_DIR_SEGMENTS);
  return isSkillAssetPath(root) ? null : root;
}

/** Absolute feature-package root from a command hint; relative hints resolve against `basePath`. */
export function featuresRootFromHint(hint: string, basePath?: string): string | null {
  const candidate = hint.trim();
  if (!candidate) return null;
  if (isAbsolute(candidate)) return normalizeRootKey(candidate);
  if (!basePath) return null;
  return normalizeRootKey(candidate === '.' ? basePath : joinSegments(basePath, candidate.replace(/^\.[\\/]/, '')));
}

function comparableKey(path: string): string {
  return normalizeRootKey(path).replace(/\\/g, '/').toLowerCase();
}

/**
 * Preference of a ledger root for a workspace: 0 = `<workspace>/migration/ohos`,
 * 1 = elsewhere inside the workspace, 2 = outside, 3 = skill-internal (never used).
 */
export function rankLedgerRoot(root: string, workspacePath?: string): number {
  if (isSkillAssetPath(root)) return 3;
  if (!workspacePath) return 2;
  const key = comparableKey(root);
  const workspaceKey = comparableKey(workspacePath);
  if (key === comparableKey(joinSegments(workspacePath, ...LEDGER_DIR_SEGMENTS))) return 0;
  return key.startsWith(`${workspaceKey}/`) ? 1 : 2;
}

/** Display form of a ledger root: relative to the workspace when inside it. */
export function displayLedgerRoot(root: string, workspacePath?: string): string {
  if (!workspacePath) return root;
  const normalizedRoot = normalizeRootKey(root);
  const workspace = normalizeRootKey(workspacePath);
  if (comparableKey(normalizedRoot).startsWith(`${comparableKey(workspace)}/`)) {
    return normalizedRoot.slice(workspace.length + 1).replace(/\\/g, '/');
  }
  return normalizedRoot;
}

function underWatchExcludedDir(path: string): boolean {
  return path.split(/[\\/]+/).some((segment) => WATCH_EXCLUDED_DIRS.has(segment.toLowerCase()));
}

// ------------------------------------------------------------ ledger lookup

/**
 * Silent existence check. `get_file_metadata` logs an ERROR for every missing
 * path, which floods the log while the panel probes for a ledger that does not
 * exist yet; `check_path_exists` simply answers `false`.
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    return await systemAPI.checkPathExists(path);
  } catch {
    try {
      const metadata = await workspaceAPI.getFileMetadata(path);
      return metadata.isFile || metadata.isDir;
    } catch {
      return false;
    }
  }
}

export async function ledgerRootHasState(root: string): Promise<boolean> {
  if (isSkillAssetPath(root)) return false;
  return pathExists(joinSegments(root, 'STATE.md'));
}

/**
 * Find `<app>/migration/ohos/STATE.md` inside the workspace: first at the
 * workspace root, then the hinted roots inside the workspace (roots of other
 * workspaces and skill-internal templates never count), then breadth-first up
 * to depth 2 (skipping build/vendor directories, capped). Returns the ledger
 * root or `null`.
 */
export async function resolveLedgerRoot(
  workspacePath: string,
  remoteConnectionId?: string,
  hintedRoots: string[] = [],
  options: { deep?: boolean } = {},
): Promise<string | null> {
  const direct = joinSegments(workspacePath, ...LEDGER_DIR_SEGMENTS);
  if (await ledgerRootHasState(direct)) return direct;

  const ranked = hintedRoots
    .filter((hint) => !isSkillAssetPath(hint))
    .map((hint, order) => ({ hint, order, rank: rankLedgerRoot(hint, workspacePath) }))
    .filter((entry) => entry.rank <= 1)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((entry) => entry.hint);
  for (const hint of ranked) {
    if (await ledgerRootHasState(hint)) {
      return hint;
    }
  }
  if (options.deep === false) return null;

  const queue: Array<{ path: string; depth: number }> = [{ path: workspacePath, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited < SEARCH_MAX_DIRS) {
    const { path, depth } = queue.shift()!;
    visited += 1;
    let children;
    try {
      children = await workspaceAPI.getDirectoryChildren(path, remoteConnectionId ?? '');
    } catch {
      continue;
    }
    for (const child of children) {
      if (!child.isDirectory) continue;
      const name = child.name.toLowerCase();
      if (depth > 0 && name === 'migration') {
        const candidate = joinSegments(child.path, 'ohos');
        if (await ledgerRootHasState(candidate)) return candidate;
      }
      if (depth < SEARCH_MAX_DEPTH && !SEARCH_SKIPPED_DIRS.has(name) && !name.startsWith('.')) {
        queue.push({ path: child.path, depth: depth + 1 });
      }
    }
  }
  return null;
}

// ------------------------------------------------------------ ledger loading

interface CachedFile {
  modified: number;
  size: number;
  text: string;
}

function toMillis(value: number): number {
  // Local metadata is in ms; some remote backends report seconds.
  return value > 0 && value < 1e11 ? value * 1000 : value;
}

/** Files that mark a HarmonyOS (hvigor) project directory. */
const OHOS_PROJECT_MARKERS = [['AppScope', 'app.json5'], ['hvigorfile.ts']];

export class LedgerReader {
  private cache = new Map<string, CachedFile>();
  /** Sticky once true: the template may be copied into the app root later. */
  private appRootIsOhosProject = false;
  private readonly features: FeaturePackageReader;

  constructor(private readonly root: string, private readonly remoteConnectionId?: string) {
    // Feature packages belong to the locally installed skill; work directories sit next to the ledgers.
    this.features = new FeaturePackageReader(createFeatureFileSystem(pathExists, remoteConnectionId));
  }

  /** Returns `null` when STATE.md does not exist. */
  async read(): Promise<{ input: MigrationLedgerInput; changed: boolean } | null> {
    let changed = false;
    let lastWriteAt = 0;
    const texts = new Map<string, LedgerDocument>();

    await Promise.all(ALL_LEDGER_FILES.map(async (file) => {
      const path = joinSegments(this.root, file);
      let metadata;
      try {
        // Files not seen before are checked silently first (most optional
        // ledgers do not exist for a long time).
        metadata = this.cache.has(file) || await pathExists(path)
          ? await workspaceAPI.getFileMetadata(path, this.remoteConnectionId)
          : null;
      } catch {
        metadata = null;
      }
      if (!metadata || !metadata.isFile) {
        if (this.cache.delete(file)) changed = true;
        texts.set(file, { path, exists: false });
        return;
      }
      const modified = toMillis(metadata.modified);
      lastWriteAt = Math.max(lastWriteAt, modified);
      const cached = this.cache.get(file);
      if (cached && cached.modified === modified && cached.size === metadata.size) {
        texts.set(file, { path, exists: true, text: cached.text, modified, size: metadata.size });
        return;
      }
      const text = await workspaceAPI.readFileContent(path, undefined, this.remoteConnectionId);
      this.cache.set(file, { modified, size: metadata.size, text });
      changed = true;
      texts.set(file, { path, exists: true, text, modified, size: metadata.size });
    }));

    const state = texts.get('STATE.md');
    if (!state?.exists) return null;

    if (!this.appRootIsOhosProject) {
      const appRoot = getAppRoot(this.root);
      for (const marker of OHOS_PROJECT_MARKERS) {
        if (await pathExists(joinSegments(appRoot, ...marker))) {
          this.appRootIsOhosProject = true;
          changed = true;
          break;
        }
      }
    }

    const tsv: Partial<Record<string, ParsedTsv>> = {};
    for (const file of LEDGER_TSV_FILES) {
      const doc = texts.get(file);
      if (doc?.exists) tsv[file] = parseTsv(doc.text, LEDGER_TSV_HEADERS[file]);
    }
    const documents: Record<string, LedgerDocument> = {};
    for (const file of LEDGER_DOCUMENT_FILES) {
      const doc = texts.get(file);
      if (doc) documents[file] = doc;
    }

    const partial: MigrationLedgerInput = { ledgerRoot: this.root, tsv, documents };
    let features;
    try {
      features = await this.features.read(
        this.root,
        featureRows(partial),
        useMigrationProgressStore.getState().featuresRoots,
      );
      if (features.changed) changed = true;
    } catch (error) {
      log.debug('Failed to read external feature packages', { root: this.root, error });
    }

    return {
      changed,
      input: {
        ledgerRoot: this.root,
        state: parseStateMd(state.text),
        tsv,
        documents,
        lastWriteAt: lastWriteAt || undefined,
        appRootIsOhosProject: this.appRootIsOhosProject,
        featurePackages: features?.packages,
        featureWorkdirs: features?.workdirs,
      },
    };
  }
}

// ---------------------------------------------------------------- controller

class LedgerController {
  private refCount = 0;
  private reader: LedgerReader;
  private unwatch: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshing = false;
  private refreshQueued = false;
  private lastInput: MigrationLedgerInput | null = null;

  constructor(readonly root: string, readonly remoteConnectionId?: string) {
    this.reader = new LedgerReader(root, remoteConnectionId);
  }

  acquire(): void {
    this.refCount += 1;
    if (this.refCount === 1) this.start();
  }

  /** Returns `true` when the controller became idle. */
  release(): boolean {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount === 0) {
      this.stop();
      return true;
    }
    return false;
  }

  private start(): void {
    const canWatch = !this.remoteConnectionId && !underWatchExcludedDir(this.root);
    if (canWatch) {
      try {
        this.unwatch = tauriExplorerFileSystemProvider.watch(
          this.root,
          () => this.scheduleRefresh(),
          { recursive: false },
        );
      } catch (error) {
        log.debug('Ledger watcher unavailable, falling back to polling', { root: this.root, error });
        this.unwatch = null;
      }
    }
    const mode = this.unwatch ? 'watch' : 'poll';
    useMigrationProgressStore.getState().patchRoot(this.root, { mode });
    this.pollTimer = setInterval(
      () => void this.refresh(),
      this.unwatch ? WATCH_SAFETY_POLL_MS : POLL_INTERVAL_MS,
    );
    void this.refresh();
  }

  private stop(): void {
    this.unwatch?.();
    this.unwatch = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  scheduleRefresh(): void {
    if (this.refCount === 0) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  /** Re-derive from the cached input (e.g. when the active action changes). */
  rederive(): void {
    if (this.lastInput) this.publish(this.lastInput);
  }

  private publish(input: MigrationLedgerInput): void {
    const store = useMigrationProgressStore.getState();
    const snapshot = deriveSnapshot({
      ...input,
      activeAction: store.activeAction?.script,
      skillInvoked: store.skillInvoked,
      sessionRunning: store.sessionRunning,
      gates: gatesForRoot(store.gatesByRoot, this.root),
      now: Date.now(),
    });
    store.patchRoot(this.root, { snapshot, exists: true, error: undefined, loading: false, lastRefreshAt: Date.now() });
  }

  async refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshQueued = true;
      return;
    }
    this.refreshing = true;
    const store = useMigrationProgressStore.getState();
    if (!store.byRoot[this.root]?.snapshot) store.patchRoot(this.root, { loading: true });
    try {
      const result = await this.reader.read();
      if (!result) {
        this.lastInput = null;
        useMigrationProgressStore.getState().patchRoot(this.root, {
          snapshot: undefined,
          exists: false,
          loading: false,
          error: undefined,
          lastRefreshAt: Date.now(),
        });
      } else {
        const previous = this.lastInput;
        this.lastInput = result.input;
        // Re-publish when files changed, or while the "active" write window is closing.
        const wasRecent = previous?.lastWriteAt !== undefined && Date.now() - previous.lastWriteAt < ACTIVE_WRITE_WINDOW_MS + POLL_INTERVAL_MS * 3;
        if (result.changed || !previous || wasRecent) {
          this.publish(result.input);
        } else {
          useMigrationProgressStore.getState().patchRoot(this.root, { loading: false, lastRefreshAt: Date.now() });
        }
      }
    } catch (error) {
      log.warn('Failed to refresh migration ledgers', { root: this.root, error });
      useMigrationProgressStore.getState().patchRoot(this.root, {
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.refreshing = false;
      if (this.refreshQueued) {
        this.refreshQueued = false;
        void this.refresh();
      }
    }
  }
}

const controllers = new Map<string, LedgerController>();

/** Start watching a ledger root. Returns the release function. */
export function acquireLedgerRoot(root: string, remoteConnectionId?: string): () => void {
  const key = normalizeRootKey(root);
  let controller = controllers.get(key);
  if (!controller) {
    controller = new LedgerController(key, remoteConnectionId);
    controllers.set(key, controller);
  }
  controller.acquire();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (controller!.release()) controllers.delete(key);
  };
}

export function refreshLedgerRoot(root: string): void {
  void controllers.get(normalizeRootKey(root))?.refresh();
}

export function scheduleRefreshAll(): void {
  controllers.forEach((controller) => controller.scheduleRefresh());
}

export function rederiveAll(): void {
  controllers.forEach((controller) => controller.rederive());
}
