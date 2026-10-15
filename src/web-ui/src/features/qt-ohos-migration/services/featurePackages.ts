/**
 * Reads the display metadata of external feature packages and the private
 * work directories of activated features.
 *
 * Feature packages live in the skill's `features/` directory (registry.tsv +
 * `<package>/hook.json`). The directory is found from, in order: the
 * `--features-root` / script paths of recent skill commands, then the
 * installed `qt-harmonyos-migration` skill reported by the skill config API.
 * Everything here is best effort: a feature is still rendered from its
 * ledger row when its package cannot be read.
 */

import { configAPI, workspaceAPI } from '@/infrastructure/api';
import { createLogger } from '@/shared/utils/logger';
import {
  FEATURE_HOOK_FILE,
  FEATURE_REGISTRY_FILE,
  FEATURE_WORKDIR_SEGMENT,
  MIGRATION_SKILL_NAME,
} from '../model/ledgerSchema';
import type {
  FeaturePackageInfo,
  FeatureWorkdirFile,
  FeatureWorkdirInfo,
  LedgerRow,
} from '../model/types';
import { parseTsv } from '../parsers/parseTsv';
import { packageKey } from './deriveExternalFeatures';

const log = createLogger('MigrationFeaturePackages');

export const FEATURE_REGISTRY_HEADER = ['feature_id', 'title', 'kind', 'hook_phase', 'status', 'package_path', 'owner', 'summary'];
const SKILL_LOOKUP_RETRY_MS = 30_000;
const MAX_WORKDIR_FILES = 40;

// ---------------------------------------------------------------- parsing

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function joinPath(base: string, ...segments: string[]): string {
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  const parts = segments.flatMap((segment) => segment.split(/[\\/]+/)).filter(Boolean);
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep);
}

/** Display fields of a `hook.json` (schema `qt-ohos-feature/1`); unknown fields are ignored. */
export function parseFeatureHook(text: string | undefined, packagePath?: string): Partial<FeaturePackageInfo> {
  if (!text) return {};
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {};
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const hook = data as Record<string, unknown>;
  const exit = hook.exit && typeof hook.exit === 'object' ? hook.exit as Record<string, unknown> : {};
  const host = hook.hook && typeof hook.hook === 'object' ? hook.hook as Record<string, unknown> : {};
  const maxAttempts = typeof exit.max_attempts === 'number' && exit.max_attempts > 0 ? Math.floor(exit.max_attempts) : undefined;
  const playbook = stringOf(hook.playbook);
  return {
    featureId: stringOf(hook.feature_id),
    title: stringOf(hook.title),
    kind: stringOf(hook.kind),
    version: stringOf(hook.version),
    hookPhase: stringOf(host.phase),
    milestones: Array.isArray(hook.milestones)
      ? hook.milestones.map((entry) => stringOf(entry)).filter((entry): entry is string => !!entry)
      : [],
    maxAttempts,
    playbookPath: playbook && packagePath ? joinPath(packagePath, playbook) : undefined,
  };
}

/** Registry rows by feature_id. */
export function parseFeatureRegistry(text: string | undefined): Map<string, LedgerRow> {
  const registry = new Map<string, LedgerRow>();
  if (!text) return registry;
  for (const row of parseTsv(text, FEATURE_REGISTRY_HEADER).rows) {
    const id = (row.feature_id ?? '').trim();
    if (id) registry.set(id, row);
  }
  return registry;
}

// ---------------------------------------------------------------- file access

interface CachedText {
  stamp: string;
  text: string;
}

export interface FeatureFileSystem {
  exists: (path: string) => Promise<boolean>;
  /** `modified:size` of a file, or `null` when it is not a file. */
  stamp: (path: string) => Promise<string | null>;
  readText: (path: string) => Promise<string>;
  list: (path: string) => Promise<Array<{ name: string; path: string; isDirectory: boolean; stamp?: string }>>;
  /** Directories of the installed migration skill, preferred first. */
  installedSkillDirs: () => Promise<string[]>;
}

function dirOfSkillPath(path: string): string {
  return /[\\/]SKILL\.md$/i.test(path) ? path.replace(/[\\/]SKILL\.md$/i, '') : path.replace(/[\\/]+$/, '');
}

export function createFeatureFileSystem(
  pathExists: (path: string) => Promise<boolean>,
  remoteConnectionId?: string,
): FeatureFileSystem {
  let skillDirs: Promise<string[]> | null = null;
  let skillLookupFailedAt = 0;
  return {
    exists: pathExists,
    stamp: async (path) => {
      try {
        const metadata = await workspaceAPI.getFileMetadata(path, remoteConnectionId);
        return metadata.isFile ? `${metadata.modified}:${metadata.size}` : null;
      } catch {
        return null;
      }
    },
    readText: (path) => workspaceAPI.readFileContent(path, undefined, remoteConnectionId),
    list: async (path) => (await workspaceAPI.getDirectoryChildren(path, remoteConnectionId ?? '')).map((child) => ({
      name: child.name,
      path: child.path,
      isDirectory: child.isDirectory,
      stamp: `${child.lastModified ?? ''}:${child.size ?? ''}`,
    })),
    installedSkillDirs: () => {
      if (!skillDirs && Date.now() - skillLookupFailedAt > SKILL_LOOKUP_RETRY_MS) {
        skillDirs = configAPI.getSkillConfigs().then((skills) => skills
          .filter((skill) => skill.name === MIGRATION_SKILL_NAME || skill.dirName === MIGRATION_SKILL_NAME)
          .sort((left, right) => Number(!!left.isShadowed) - Number(!!right.isShadowed))
          .map((skill) => dirOfSkillPath(skill.path))
          .filter(Boolean))
          .catch((error) => {
            log.debug('Skill lookup for feature packages failed', { error });
            skillLookupFailedAt = Date.now();
            skillDirs = null;
            return [];
          });
      }
      return skillDirs ?? Promise.resolve([]);
    },
  };
}

// ---------------------------------------------------------------- reader

export interface FeatureReadResult {
  featuresRoot?: string;
  packages: Record<string, FeaturePackageInfo>;
  workdirs: Record<string, FeatureWorkdirInfo>;
  /** Packages or work directories differ from the previous read. */
  changed: boolean;
}

export class FeaturePackageReader {
  private cache = new Map<string, CachedText>();
  private signature = '';

  constructor(private readonly fs: FeatureFileSystem) {}

  private async readCached(path: string): Promise<string | undefined> {
    const stamp = await this.fs.stamp(path);
    if (!stamp) {
      this.cache.delete(path);
      return undefined;
    }
    const cached = this.cache.get(path);
    if (cached && cached.stamp === stamp) return cached.text;
    try {
      const text = await this.fs.readText(path);
      this.cache.set(path, { stamp, text });
      return text;
    } catch {
      return undefined;
    }
  }

  private async resolveFeaturesRoot(hints: string[]): Promise<string | undefined> {
    const installed = (await this.fs.installedSkillDirs()).map((dir) => joinPath(dir, 'features'));
    for (const candidate of [...hints, ...installed]) {
      if (await this.fs.exists(joinPath(candidate, FEATURE_REGISTRY_FILE))) return candidate;
    }
    return undefined;
  }

  private async readPackages(featuresRoot: string, rows: LedgerRow[]): Promise<Record<string, FeaturePackageInfo>> {
    const registry = parseFeatureRegistry(await this.readCached(joinPath(featuresRoot, FEATURE_REGISTRY_FILE)));
    const wanted = new Map<string, { relative: string; featureId?: string }>();
    for (const row of rows) {
      const featureId = (row.feature_id ?? '').trim();
      const relative = (row.package_path ?? '').trim() || (registry.get(featureId)?.package_path ?? '').trim();
      if (relative) wanted.set(packageKey(relative), { relative, featureId: featureId || undefined });
    }
    const packages: Record<string, FeaturePackageInfo> = {};
    await Promise.all([...wanted.entries()].map(async ([key, { relative, featureId }]) => {
      const path = joinPath(featuresRoot, relative);
      const hook = parseFeatureHook(await this.readCached(joinPath(path, FEATURE_HOOK_FILE)), path);
      const id = hook.featureId ?? featureId;
      const registered = id ? registry.get(id) : undefined;
      if (!hook.featureId && !registered) return;
      packages[key] = {
        featureId: id,
        path,
        title: hook.title ?? stringOf(registered?.title),
        summary: stringOf(registered?.summary),
        kind: hook.kind ?? stringOf(registered?.kind),
        version: hook.version,
        hookPhase: hook.hookPhase ?? stringOf(registered?.hook_phase),
        milestones: hook.milestones ?? [],
        maxAttempts: hook.maxAttempts,
        playbookPath: hook.playbookPath,
      };
    }));
    return packages;
  }

  private async readWorkdirs(ledgerRoot: string, rows: LedgerRow[]): Promise<{
    workdirs: Record<string, FeatureWorkdirInfo>;
    stamps: string[];
  }> {
    const workdirs: Record<string, FeatureWorkdirInfo> = {};
    const stamps: string[] = [];
    const base = joinPath(ledgerRoot, FEATURE_WORKDIR_SEGMENT);
    const ids = new Set(rows.map((row) => (row.id ?? '').trim()).filter(Boolean));
    if (ids.size === 0 || !(await this.fs.exists(base))) return { workdirs, stamps };
    let children;
    try {
      children = await this.fs.list(base);
    } catch {
      return { workdirs, stamps };
    }
    await Promise.all(children.filter((child) => child.isDirectory && ids.has(child.name)).map(async (child) => {
      let entries;
      try {
        entries = await this.fs.list(child.path);
      } catch {
        return;
      }
      const files: FeatureWorkdirFile[] = entries
        .filter((entry) => !entry.isDirectory && !entry.name.startsWith('.'))
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, MAX_WORKDIR_FILES)
        .map((entry) => {
          stamps.push(`${child.name}/${entry.name}@${entry.stamp ?? ''}`);
          return { name: entry.name, path: entry.path };
        });
      workdirs[child.name] = { path: child.path, files };
    }));
    stamps.sort();
    return { workdirs, stamps };
  }

  async read(ledgerRoot: string, rows: LedgerRow[], hints: string[]): Promise<FeatureReadResult> {
    if (rows.length === 0) {
      const changed = this.signature !== '';
      this.signature = '';
      return { packages: {}, workdirs: {}, changed };
    }
    const featuresRoot = await this.resolveFeaturesRoot(hints);
    const packages = featuresRoot ? await this.readPackages(featuresRoot, rows) : {};
    const { workdirs, stamps } = await this.readWorkdirs(ledgerRoot, rows);
    const signature = JSON.stringify([featuresRoot ?? '', packages, stamps]);
    const changed = signature !== this.signature;
    this.signature = signature;
    return { featuresRoot, packages, workdirs, changed };
  }
}
