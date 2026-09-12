/** Public browse snapshots only. Installed state and account details stay live. */
import { createLogger } from '@/shared/utils/logger';

const STORAGE_KEY = 'openbitfun:market-catalog:v1';
const MAX_PAGES = 12;
const MAX_BYTES = 1024 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const log = createLogger('MarketCatalogCache');

interface CatalogPage<T> {
  items: T[];
  nextCursor?: string;
}

interface Snapshot {
  key: string;
  savedAt: number;
  page: CatalogPage<unknown>;
}

function readSnapshots(): Snapshot[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw || raw.length > MAX_BYTES) return [];
    const stored = JSON.parse(raw);
    if (stored.version !== 1 || !Array.isArray(stored.pages)) return [];
    return stored.pages.filter((entry: Snapshot) => (
      entry && typeof entry.key === 'string' && Number.isFinite(entry.savedAt)
      && Date.now() - entry.savedAt <= MAX_AGE_MS
      && entry.page && Array.isArray(entry.page.items)
      && (entry.page.nextCursor === undefined || typeof entry.page.nextCursor === 'string')
    ));
  } catch {
    // Unavailable storage, older versions and malformed cache entries all use
    // the existing network path. Never reset any application/user storage.
    return [];
  }
}

export function readMarketCatalog<T>(
  key: string,
  isItem: (value: unknown) => value is T,
): CatalogPage<T> | undefined {
  const snapshot = readSnapshots().find(entry => entry.key === key);
  if (!snapshot || !snapshot.page.items.every(isItem)) return undefined;
  return snapshot.page as CatalogPage<T>;
}

export function writeMarketCatalog<T>(key: string, page: CatalogPage<T>): void {
  try {
    const pages = [
      { key, savedAt: Date.now(), page },
      ...readSnapshots().filter(entry => entry.key !== key),
    ].slice(0, MAX_PAGES);
    let value = JSON.stringify({ version: 1, pages });
    while (value.length > MAX_BYTES && pages.length > 1) {
      pages.pop();
      value = JSON.stringify({ version: 1, pages });
    }
    if (value.length <= MAX_BYTES) globalThis.localStorage?.setItem(STORAGE_KEY, value);
  } catch (error) {
    log.warn('Failed to persist public marketplace catalog', { error });
  }
}

/** Guards the fields used during a cached card's first render. */
export function isMarketSummary(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const owner = item.owner as Record<string, unknown> | undefined;
  return ['listingId', 'slug', 'name', 'description', 'minOpenBitFunVersion']
    .every(key => typeof item[key] === 'string')
    && ['latestRelease', 'downloadCount', 'publishedAt'].every(key => Number.isFinite(item[key]))
    && Boolean(owner && typeof owner.login === 'string' && typeof owner.githubId === 'number');
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}
