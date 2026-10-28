// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { ExternalHookImportSnapshot, ExternalHookSource } from '@/infrastructure/api/service-api/ExternalHooksAPI';
import { persistHookScan, readPersistedHookScan } from './ecosystemHookScanStorage';

const scope = JSON.stringify([undefined, 'workspace-id']);

function source(ecosystemId = 'codex'): ExternalHookSource {
  return {
    key: { providerId: `${ecosystemId}.hooks`, sourceId: 'user-settings' },
    ecosystemId,
    displayName: `${ecosystemId} user Hooks`,
    sourceKind: 'settings',
    scope: 'user_global',
    locationHint: `/home/${ecosystemId}/settings.json`,
    health: 'available',
    contentVersion: 'v1',
    diagnostics: [],
  };
}

function snapshot(overrides: Partial<ExternalHookImportSnapshot> = {}): ExternalHookImportSnapshot {
  const hookSource = source();
  return {
    schemaVersion: 1,
    revision: 'sha256:revision-1',
    imports: [{
      importId: 'copy-1',
      source: hookSource,
      enabled: true,
      behaviorVersion: 'sha256:behavior',
      state: 'current',
    }],
    diagnostics: [],
    catalog: {
      schemaVersion: 1,
      discoveryPending: false,
      providers: [{ providerId: hookSource.key.providerId, ecosystemId: 'codex', displayName: 'codex' }],
      sources: [hookSource],
      entries: [{
        stableKey: 'codex:stop',
        source: hookSource.key,
        nativeEvent: 'Stop',
        matcher: { kind: 'any' },
        handlerKind: 'command',
        projectionStatus: 'native_only',
        nativeActivation: 'unknown',
        contentVersion: 'v1',
      }],
      staleProviderIds: [],
      failedProviderIds: [],
      diagnostics: [],
    },
    ...overrides,
  };
}

describe('ecosystem Hook scan memory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps discovery facts and never stores an imported copy as proof', () => {
    persistHookScan(scope, snapshot());
    const restored = readPersistedHookScan(scope)!;

    expect(restored.catalog.sources.map((item) => item.displayName)).toEqual(['codex user Hooks']);
    expect(restored.catalog.entries.map((item) => item.stableKey)).toEqual(['codex:stop']);
    expect(restored.imports).toEqual([]);
    // An empty revision must never match an owner acknowledgement.
    expect(restored.revision).toBe('');
    expect(restored.catalog.discoveryPending).toBe(false);
  });

  it('does not remember a read whose scan is still pending', () => {
    persistHookScan(scope, snapshot({ catalog: { ...snapshot().catalog, discoveryPending: true } }));
    expect(readPersistedHookScan(scope)).toBeNull();
  });

  it('forgets the last read when a later read finds no Hook source', () => {
    persistHookScan(scope, snapshot());
    persistHookScan(scope, snapshot({ catalog: { ...snapshot().catalog, sources: [], entries: [] } }));
    expect(readPersistedHookScan(scope)).toBeNull();
    expect(localStorage.getItem(`bitfun:ecosystem-hook-scan:v1:${scope}`)).not.toBeNull();
  });

  it('keeps scopes, unknown versions, and unreadable records apart', () => {
    const other = JSON.stringify([undefined, 'other-workspace']);
    persistHookScan(scope, snapshot());
    persistHookScan(other, snapshot({ catalog: { ...snapshot().catalog, sources: [source('claude-code')] } }));
    expect(readPersistedHookScan(scope)?.catalog.sources[0]?.ecosystemId).toBe('codex');
    expect(readPersistedHookScan(other)?.catalog.sources[0]?.ecosystemId).toBe('claude-code');

    const key = `bitfun:ecosystem-hook-scan:v1:${scope}`;
    const newer = JSON.stringify({ schemaVersion: 2, capturedAt: 1, sources: [source()], entries: [] });
    localStorage.setItem(key, newer);
    expect(readPersistedHookScan(scope)).toBeNull();
    // A record written by a newer build stays readable for that build.
    persistHookScan(scope, snapshot());
    expect(localStorage.getItem(key)).toBe(newer);

    localStorage.setItem(key, '{');
    expect(readPersistedHookScan(scope)).toBeNull();
    expect(localStorage.getItem(key)).toBe('{');
  });

  it('bounds how many scopes keep a stored result', () => {
    for (let index = 0; index < 9; index += 1) {
      persistHookScan(JSON.stringify([undefined, `workspace-${index}`]), snapshot());
    }
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!)
      .filter((key) => key.startsWith('bitfun:ecosystem-hook-scan:v1:'));
    expect(keys.length).toBeLessThanOrEqual(6);
    expect(readPersistedHookScan(JSON.stringify([undefined, 'workspace-8']))).not.toBeNull();
  });
});
