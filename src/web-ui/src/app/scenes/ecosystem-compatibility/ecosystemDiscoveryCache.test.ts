import { beforeEach, describe, expect, it } from 'vitest';
import type { AcpClientInfo } from '@/infrastructure/api/service-api/ACPClientAPI';
import type { ExternalSourceCatalogSnapshot } from '@/infrastructure/api/service-api/ExternalSourcesAPI';
import type { SkillInfo } from '@/infrastructure/config/types';
import { buildEcosystemImportItems, buildEcosystemProductRuntimes, catalogDiscoveryState } from './ecosystemCompatibilityModel';
import { clearEcosystemDiscoveryCache, ecosystemDiscoveryCache, rememberEcosystemCatalog, rememberEcosystemSkills } from './ecosystemDiscoveryCache';

function catalog(): ExternalSourceCatalogSnapshot {
  return { generation: 1, preferenceRevision: 1, discoveryPending: false, commands: [],
    discovery: { enabled: true, canChange: true, hasScanned: true, preferenceRevision: 1 },
    sources: [{ stableKey: 'codex', lifecycle: 'available', record: { ecosystemId: 'codex', health: 'available',
      key: { providerId: 'codex.mcp', sourceId: 'user' }, diagnostics: [] } }],
    mcpServers: [{ candidateId: 'docs', definition: { name: 'Docs', id: { source: { providerId: 'codex.mcp', sourceId: 'user' } } } }],
    integrationPolicy: { status: 'compatible', effective: { enabled: false, ecosystems: {} }, registeredEcosystems: [] },
  } as unknown as ExternalSourceCatalogSnapshot;
}

describe('ecosystem recognition and scoped discovery results', () => {
  beforeEach(clearEcosystemDiscoveryCache);

  it('classifies a built-in preset under more apps and a user configuration under identified', () => {
    const preset = { id: 'codex', readonly: true, enabled: true, status: 'configured' } as AcpClientInfo;
    const group = (clients: AcpClientInfo[]) => buildEcosystemProductRuntimes(null, clients).find((runtime) => runtime.spec.id === 'codex')!.group;
    expect(group([preset])).toBe('more');
    expect(group([{ ...preset, readonly: false, enabled: false }])).toBe('identified');
    expect(group([{ ...preset, status: 'running' }])).toBe('identified');
    expect(buildEcosystemProductRuntimes(catalog(), [preset]).find((runtime) => runtime.spec.id === 'codex')!.group).toBe('identified');
  });

  it('retains recognition during failed scans and clears it after a successful empty scan', () => {
    rememberEcosystemCatalog('local:/project', catalog());
    const empty = { ...catalog(), sources: [], mcpServers: [] };
    const failed = rememberEcosystemCatalog('local:/project', { ...empty, diagnostics: [{ severity: 'warning', code: 'external_mcp.discovery_overloaded', message: 'Busy' }] });
    expect(failed.mcpServers).toHaveLength(1);
    expect(catalogDiscoveryState(failed, 'codex', 'mcp')).toBe('discoveryUnavailable');
    expect(ecosystemDiscoveryCache('local:/project').identified.has('codex')).toBe(true);
    rememberEcosystemCatalog('local:/project', empty);
    expect(ecosystemDiscoveryCache('local:/project').identified.has('codex')).toBe(false);
  });

  it('keeps paused results when a host cache expires without sharing them with another host or workspace', () => {
    rememberEcosystemCatalog('local:/project', catalog());
    const next = catalog();
    next.discovery = { enabled: false, canChange: true, hasScanned: false, preferenceRevision: 2 };
    next.preferenceRevision = 2;
    next.sources = []; next.mcpServers = [];
    const retained = rememberEcosystemCatalog('local:/project', next);
    expect(retained.mcpServers).toHaveLength(1);
    expect(retained.discovery?.enabled).toBe(false);
    expect(ecosystemDiscoveryCache('peer:/project').catalog).toBeUndefined();
    expect(ecosystemDiscoveryCache('local:/other').catalog).toBeUndefined();
    expect(rememberEcosystemCatalog('local:/project', catalog()).discovery?.enabled).toBe(false);
  });

  it('keeps only failed external Skill results and removes them after a confirmed successful scan', () => {
    const cache = ecosystemDiscoveryCache('local:/project');
    const skill = { key: 'codex::one', sourceId: 'codex', sourceSlot: 'codex', path: '/codex/one' } as SkillInfo;
    rememberEcosystemSkills(cache, [skill], []);
    expect(rememberEcosystemSkills(cache, [], [{ sourceId: 'codex', path: '/codex', message: 'Read failed' }])).toEqual([skill]);
    expect(cache.staleSkillKeys?.has(skill.key)).toBe(true);
    expect(rememberEcosystemSkills(cache, [], [])).toEqual([]);
  });

  it('distinguishes policy exclusions from successful empty discovery and never claims runtime availability', () => {
    const value = catalog();
    value.discovery!.discoverableCapabilities = { codex: ['mcp'] };
    expect(catalogDiscoveryState(value, 'codex', 'mcp')).toBe('notDetected');
    expect(catalogDiscoveryState(value, 'codex', 'subagent')).toBe('notScanned');
    value.commands = [{ definition: { id: { source: value.sources[0].record.key, localId: 'review' }, name: 'review', availability: { state: 'available' } } }] as ExternalSourceCatalogSnapshot['commands'];
    const runtime = buildEcosystemProductRuntimes(value, []).find((item) => item.spec.id === 'codex')!;
    expect(buildEcosystemImportItems(value, runtime).find((item) => item.kind === 'command')?.usageState).toBe('unknown');
  });
});
