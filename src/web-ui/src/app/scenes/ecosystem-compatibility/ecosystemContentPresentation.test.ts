import { describe, expect, it } from 'vitest';
import { contentUsageState, presentEcosystemContent } from './ecosystemContentPresentation';

const facts = {
  item: { id: 'mcp:docs', kind: 'mcp' as const, name: 'docs', sourceName: 'Codex',
    discoverySupport: 'supported' as const, detection: 'catalog' as const, discovered: true },
  discoveryState: 'notDetected' as const, catalogFailed: false, imported: false,
  localImportSupported: true, skillImportSupported: true, hookImportSupported: false,
  planLoading: false, mcpDisposition: 'eligible' as const,
};

describe('ecosystem discovery, copy and use presentation', () => {
  it('an imported MCP copy does not inherit active status from its external source', () => {
    const result = presentEcosystemContent({ ...facts, item: { ...facts.item, usageState: 'available' },
      mcpDisposition: 'already_imported' });
    expect(result).toEqual({ state: 'imported', canImport: false, descriptionKey: 'content.mcpImportedDescription' });
  });

  it.each(['available', 'approvalRequired', 'disabled', 'conflict', 'runtimeFailed'] as const)(
    'preserves owner usage state %s without offering command copy import', (usageState) => {
      const result = presentEcosystemContent({ ...facts, item: { ...facts.item, kind: 'command', usageState }, mcpDisposition: undefined });
      expect(result).toEqual({ state: usageState, canImport: false, descriptionKey: `content.directUse.${usageState}` });
    },
  );

  it('does not use the local copy gate to infer remote command usability', () => {
    const result = presentEcosystemContent({ ...facts, localImportSupported: false,
      item: { ...facts.item, kind: 'command', usageState: 'available' }, mcpDisposition: undefined });
    expect(result.state).toBe('available');
    expect(result.canImport).toBe(false);
    expect(presentEcosystemContent({ ...facts, localImportSupported: false }).state).toBe('unsupportedContext');
  });

  it.each(['checking', 'discoveryDisabled', 'discoveryUnavailable'] as const)(
    'does not hide %s behind a cached item or eligible import plan', (discoveryState) => {
      expect(presentEcosystemContent({ ...facts, discoveryState })).toMatchObject({ state: discoveryState, canImport: false });
    },
  );

  it('keeps confirmed copies visible when discovery fails', () => {
    expect(presentEcosystemContent({ ...facts, catalogFailed: true, imported: true }).state).toBe('imported');
    expect(presentEcosystemContent({ ...facts, catalogFailed: true })).toMatchObject({ state: 'discoveryUnavailable', canImport: false });
  });

  it('distinguishes missing results from missing page discovery integration', () => {
    expect(presentEcosystemContent({ ...facts, item: { ...facts.item, discovered: false } }).state).toBe('notDetected');
    expect(presentEcosystemContent({ ...facts, item: { ...facts.item, kind: 'plugin', discovered: false,
      discoverySupport: 'unsupported' } }).state).toBe('discoveryUnsupported');
  });

  it('keeps Pi and DSH static hook declarations read-only in every environment', () => {
    for (const localImportSupported of [true, false]) {
      expect(presentEcosystemContent({ ...facts, localImportSupported, mcpDisposition: undefined,
        item: { ...facts.item, kind: 'hook', detection: 'owner' } })).toEqual({
        state: 'discovered', canImport: false, descriptionKey: 'content.hookDiscoveryOnly',
      });
    }
  });

  it('does not treat unknown host status or unsupported skill import format as product incompatibility', () => {
    expect(contentUsageState()).toBe('unknown');
    expect(contentUsageState('new_host_state')).toBe('unknown');
    expect(presentEcosystemContent({ ...facts, mcpDisposition: undefined, item: { ...facts.item, kind: 'tool' } }))
      .toEqual({ state: 'discovered', canImport: false, descriptionKey: 'content.directUse.unknown' });
    expect(presentEcosystemContent({ ...facts, skillImportSupported: false,
      item: { ...facts.item, kind: 'skill', detection: 'owner' } })).toMatchObject({ state: 'importUnsupported', canImport: false });
  });
});
