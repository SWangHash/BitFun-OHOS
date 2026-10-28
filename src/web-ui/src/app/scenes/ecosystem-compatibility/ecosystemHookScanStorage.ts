import type {
  ExternalHookCatalogEntry,
  ExternalHookImportSnapshot,
  ExternalHookMatcher,
  ExternalHookSource,
} from '@/infrastructure/api/service-api/ExternalHooksAPI';

/**
 * Last successful Hook discovery, kept only so a paused panel can show what the
 * user already saw.
 *
 * With automatic discovery off the host is never asked to read Hook sources
 * again until the user asks, and the in-memory discovery cache dies with the
 * process. Without a durable copy every restart fell back to "not scanned" and
 * lost confirmed content.
 *
 * This record carries discovery facts only. Imported copies stay owner facts:
 * a stored import would claim a native copy nothing verified, so `imports` is
 * always empty here and the panel keeps showing content as last known instead
 * of offering import actions until a live read lands.
 *
 * Only local surfaces write it. A peer device's or remote workspace's content
 * must never enter the controller's storage.
 */
const KEY_PREFIX = 'bitfun:ecosystem-hook-scan:v1:';
const MAX_RECORDS = 6;
const MAX_SOURCES = 64;
const MAX_ENTRIES = 256;
const MAX_TEXT = 2048;

interface StoredHookScan {
  schemaVersion: 1;
  capturedAt: number;
  sources: ExternalHookSource[];
  entries: ExternalHookCatalogEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value: unknown, maxLength = MAX_TEXT): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : null;
}

function sourceKeyOf(value: unknown): ExternalHookSource['key'] | null {
  if (!isRecord(value)) return null;
  const providerId = boundedText(value.providerId, 160);
  const sourceId = boundedText(value.sourceId, 160);
  return providerId && sourceId ? { providerId, sourceId } : null;
}

function hookSourceOf(value: unknown): ExternalHookSource | null {
  if (!isRecord(value)) return null;
  const key = sourceKeyOf(value.key);
  const ecosystemId = boundedText(value.ecosystemId, 160);
  const displayName = boundedText(value.displayName);
  const locationHint = boundedText(value.locationHint, 4096);
  const contentVersion = boundedText(value.contentVersion, 160);
  const sourceKind = value.sourceKind;
  const scope = value.scope;
  const health = value.health;
  if (!key || !ecosystemId || !displayName || !locationHint || !contentVersion) return null;
  if (!['settings', 'plugin_file', 'package_declaration', 'hooks_file', 'inline_configuration'].includes(String(sourceKind))) return null;
  if (!['user_global', 'project', 'workspace_local', 'remote_user', 'remote_project'].includes(String(scope))) return null;
  if (!['available', 'partial', 'degraded', 'unavailable'].includes(String(health))) return null;
  return {
    key,
    ecosystemId,
    displayName,
    sourceKind: sourceKind as ExternalHookSource['sourceKind'],
    scope: scope as ExternalHookSource['scope'],
    locationHint,
    health: health as ExternalHookSource['health'],
    contentVersion,
    diagnostics: [],
  };
}

function matcherOf(value: unknown): ExternalHookMatcher | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'pattern') {
    const display = boundedText(value.display);
    return display ? { kind: 'pattern', display } : null;
  }
  return value.kind === 'any' || value.kind === 'dynamic' || value.kind === 'unavailable'
    ? { kind: value.kind }
    : null;
}

function hookEntryOf(value: unknown): ExternalHookCatalogEntry | null {
  if (!isRecord(value)) return null;
  const stableKey = boundedText(value.stableKey, 160);
  const source = sourceKeyOf(value.source);
  const nativeEvent = boundedText(value.nativeEvent, 160);
  const contentVersion = boundedText(value.contentVersion, 160);
  const matcher = matcherOf(value.matcher);
  const handlerKind = value.handlerKind;
  const projectionStatus = value.projectionStatus;
  const nativeActivation = value.nativeActivation;
  if (!stableKey || !source || !nativeEvent || !contentVersion || !matcher) return null;
  if (!['function', 'command', 'http', 'mcp_tool', 'prompt', 'agent'].includes(String(handlerKind))) return null;
  if (!['mapped', 'native_only', 'opaque'].includes(String(projectionStatus))) return null;
  if (!['disabled', 'unsupported', 'unknown'].includes(String(nativeActivation))) return null;
  const hookPoint = isRecord(value.mapping) ? value.mapping.hookPoint : undefined;
  const mapping = hookPoint === 'tool_before' || hookPoint === 'tool_after'
    ? { hookPoint } as const
    : undefined;
  return {
    stableKey,
    source,
    nativeEvent,
    matcher,
    handlerKind: handlerKind as ExternalHookCatalogEntry['handlerKind'],
    projectionStatus: projectionStatus as ExternalHookCatalogEntry['projectionStatus'],
    nativeActivation: nativeActivation as ExternalHookCatalogEntry['nativeActivation'],
    ...(mapping && projectionStatus === 'mapped' ? { mapping } : {}),
    contentVersion,
  };
}

function scanKey(scope: string): string {
  return `${KEY_PREFIX}${scope}`;
}

/** Discovery facts of the last successful read, or null when nothing verified is stored. */
export function readPersistedHookScan(scope: string): ExternalHookImportSnapshot | null {
  try {
    const raw = localStorage.getItem(scanKey(scope));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.schemaVersion !== 1) return null;
    const sources: ExternalHookSource[] = [];
    const entries: ExternalHookCatalogEntry[] = [];
    for (const item of Array.isArray(value.sources) ? value.sources : []) {
      const parsed = hookSourceOf(item);
      if (parsed && sources.length < MAX_SOURCES) sources.push(parsed);
    }
    if (sources.length === 0) return null;
    for (const item of Array.isArray(value.entries) ? value.entries : []) {
      const parsed = hookEntryOf(item);
      if (parsed && entries.length < MAX_ENTRIES) entries.push(parsed);
    }
    return {
      schemaVersion: 1,
      // An empty revision never matches an owner acknowledgement, so a live
      // change still rereads instead of being ignored as already applied.
      revision: '',
      imports: [],
      diagnostics: [],
      catalog: {
        schemaVersion: 1,
        discoveryPending: false,
        providers: [],
        sources,
        entries,
        staleProviderIds: [],
        failedProviderIds: [],
        diagnostics: [],
      },
    };
  } catch {
    // Unreadable storage stays untouched; the panel simply has no memory to show.
    return null;
  }
}

/** Keep the last successful read of this scope; a paused panel has no other memory. */
export function persistHookScan(scope: string, snapshot: ExternalHookImportSnapshot): void {
  const catalog = snapshot.catalog;
  if (catalog.discoveryPending) return;
  const record: StoredHookScan = {
    schemaVersion: 1,
    capturedAt: Date.now(),
    sources: catalog.sources.slice(0, MAX_SOURCES),
    entries: catalog.entries.slice(0, MAX_ENTRIES),
  };
  const key = scanKey(scope);
  try {
    // An unknown version belongs to a newer build; keep it readable for that build.
    const existing = localStorage.getItem(key);
    if (existing && JSON.parse(existing)?.schemaVersion !== 1) return;
    localStorage.setItem(key, JSON.stringify(record));
    pruneOtherScopes(key);
  } catch {
    // Storage being unavailable only means the next restart shows "not scanned" again.
  }
}

function pruneOtherScopes(keep: string) {
  const others: Array<{ key: string; capturedAt: number }> = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(KEY_PREFIX) || key === keep) continue;
    let capturedAt = 0;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? 'null');
      capturedAt = isRecord(parsed) && typeof parsed.capturedAt === 'number' ? parsed.capturedAt : 0;
    } catch {
      capturedAt = 0;
    }
    others.push({ key, capturedAt });
  }
  others.sort((left, right) => left.capturedAt - right.capturedAt);
  for (const stale of others.slice(0, Math.max(0, others.length - (MAX_RECORDS - 1)))) {
    localStorage.removeItem(stale.key);
  }
}
