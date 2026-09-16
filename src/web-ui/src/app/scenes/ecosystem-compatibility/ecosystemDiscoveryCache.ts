import type { ExternalSourceCatalogSnapshot } from '@/infrastructure/api/service-api/ExternalSourcesAPI';
import type { ExternalHookImportSnapshot } from '@/infrastructure/api/service-api/ExternalHooksAPI';
import type { SkillInfo, SkillScanDiagnostic } from '@/infrastructure/config/types';
import type { AcpClientInfo } from '@/infrastructure/api/service-api/ACPClientAPI';
import { getSkillSourceId, isOpenBitFunManagedSkill } from '@/infrastructure/config/skillSourcePresentation';

interface DiscoveryCache {
  catalog?: ExternalSourceCatalogSnapshot;
  clients?: AcpClientInfo[];
  identified: Set<string>;
  skills?: SkillInfo[];
  skillDiagnostics?: SkillScanDiagnostic[];
  skillImportVersion?: number;
  staleSkillKeys?: Set<string>;
  hooks?: ExternalHookImportSnapshot;
}

// View-only memory, scoped to the execution host and workspace. Never persisted
// on the controller and never used as proof of import or execution permission.
const caches = new Map<string, DiscoveryCache>();

export function ecosystemDiscoveryCache(scope: string): DiscoveryCache {
  let cache = caches.get(scope);
  if (!cache) {
    cache = { identified: new Set() };
    caches.set(scope, cache);
    if (caches.size > 32) caches.delete(caches.keys().next().value!);
  }
  return cache;
}

export function rememberEcosystemCatalog(scope: string, catalog: ExternalSourceCatalogSnapshot): ExternalSourceCatalogSnapshot {
  const cache = ecosystemDiscoveryCache(scope);
  if ((cache.catalog?.preferenceRevision ?? -1) > (catalog.preferenceRevision ?? -1)) return cache.catalog!;
  if (cache.catalog && catalog.discovery && !catalog.discovery.hasScanned) {
    // A retired host service has no scan yet. Keep this scope's last result
    // until a completed scan can replace it; current policy metadata still wins.
    const previous = cache.catalog;
    catalog = { ...previous, ...catalog, sources: previous.sources, commands: previous.commands,
      tools: previous.tools, subagents: previous.subagents, mcpServers: previous.mcpServers,
      discovery: { ...catalog.discovery, hasScanned: previous.discovery?.hasScanned ?? true } };
  }
  const complete = !catalog.discoveryPending && (catalog.discovery?.hasScanned ?? true);
  const failed = catalog.sources.some((source) => ['unavailable', 'degraded'].includes(source.record.health))
    || (catalog.diagnostics?.length ?? 0) > 0;
  if (cache.catalog && catalog.discovery && failed) {
    const previous = cache.catalog;
    const retainedKinds: string[] = [];
    const withdrawn = new Set(catalog.sources.filter((source) => ['removed', 'suppressed'].includes(source.lifecycle))
      .map((source) => JSON.stringify(source.record.key)));
    const keepSource = (source: { providerId: string; sourceId: string }) => !withdrawn.has(JSON.stringify(source));
    const merge = <T,>(kind: string, current: T[] | undefined, prior: T[] | undefined, key: (entry: T) => string, keep: (entry: T) => boolean = () => true): T[] => {
      const keys = new Set(current?.map(key));
      const retained = prior?.filter((entry) => !keys.has(key(entry)) && keep(entry)) ?? [];
      if (retained.length) retainedKinds.push(kind);
      return [...current ?? [], ...retained];
    };
    catalog = { ...catalog,
      sources: merge('source', catalog.sources, previous.sources, (entry) => entry.stableKey),
      commands: merge('command', catalog.commands, previous.commands, (entry) => JSON.stringify(entry.definition.id), (entry) => keepSource(entry.definition.id.source)),
      tools: merge('tool', catalog.tools, previous.tools, (entry) => JSON.stringify(entry.definition.id), (entry) => keepSource(entry.definition.id.target.source)),
      subagents: merge('subagent', catalog.subagents, previous.subagents, (entry) => entry.candidateId, (entry) => entry.sourceKeys.some(keepSource)),
      mcpServers: merge('mcp', catalog.mcpServers, previous.mcpServers, (entry) => entry.candidateId, (entry) => keepSource(entry.definition.id.source)),
      discovery: { ...catalog.discovery, retainedKinds },
    };
  }
  if (complete && !failed) cache.identified.clear();
  for (const source of catalog.sources) {
    if (source.lifecycle !== 'removed' && ['available', 'partial'].includes(source.record.health)) {
      cache.identified.add(source.record.ecosystemId);
    }
  }
  cache.catalog = catalog;
  return catalog;
}

export function clearEcosystemDiscoveryCache(): void {
  caches.clear();
}

export function rememberEcosystemSkills(cache: DiscoveryCache, skills: SkillInfo[], diagnostics: SkillScanDiagnostic[]): SkillInfo[] {
  const failedSources = new Set(diagnostics.map((entry) => entry.sourceId));
  const current = new Set(skills.map((skill) => skill.key));
  const retained = cache.skills?.filter((skill) => !isOpenBitFunManagedSkill(skill)
    && failedSources.has(getSkillSourceId(skill)) && !current.has(skill.key)) ?? [];
  cache.staleSkillKeys = new Set(retained.map((skill) => skill.key));
  cache.skills = [...skills, ...retained];
  cache.skillDiagnostics = diagnostics;
  return cache.skills;
}

export function rememberEcosystemHooks(cache: DiscoveryCache, snapshot: ExternalHookImportSnapshot): ExternalHookImportSnapshot {
  const failed = new Set(snapshot.catalog.failedProviderIds);
  const knownSources = new Set(snapshot.catalog.sources.map((source) => JSON.stringify(source.key)));
  const knownEntries = new Set(snapshot.catalog.entries.map((entry) => entry.stableKey));
  cache.hooks = {
    ...snapshot,
    catalog: {
      ...snapshot.catalog,
      sources: [...snapshot.catalog.sources, ...cache.hooks?.catalog.sources.filter((source) =>
        failed.has(source.key.providerId) && !knownSources.has(JSON.stringify(source.key))) ?? []],
      entries: [...snapshot.catalog.entries, ...cache.hooks?.catalog.entries.filter((entry) =>
        failed.has(entry.source.providerId) && !knownEntries.has(entry.stableKey)) ?? []],
    },
  };
  return cache.hooks;
}
