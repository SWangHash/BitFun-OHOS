import { isTauriRuntime } from '@/infrastructure/runtime';
import { createLogger } from '@/shared/utils/logger';
import { api } from './ApiClient';
import { marketImageUrl, type MarketImageVariant } from './MarketImage';

const log = createLogger('MarketImageCache');
const MAX_IDLE_IMAGES = 48;
const MAX_IDLE_BYTES = 24 * 1024 * 1024;
interface Entry {
  promise: Promise<string>;
  url?: string;
  size: number;
  users: number;
}
const images = new Map<string, Entry>();

export function canCacheMarketImage(source: string): boolean {
  return isTauriRuntime() && /^https?:\/\/[^?#]+\/(?:screenshots|artifacts\/previews)\/[a-f\d]{64}$/i.test(source);
}

/** A local blob lease; the native adapter owns download validation and disk IO. */
export function acquireMarketImage(source: string, variant: MarketImageVariant): {
  readyUrl?: string;
  url: Promise<string>;
  release: () => void;
} {
  const key = marketImageUrl(source, variant);
  let entry = images.get(key);
  if (!entry) {
    const created: Entry = { users: 0, size: 0, promise: Promise.resolve('') };
    created.promise = api.invoke<ArrayBuffer | Uint8Array>('market_image_load', {
      request: { source: key },
    }).then(bytes => {
      const buffer = bytes instanceof ArrayBuffer ? bytes.slice(0) : new Uint8Array(bytes).buffer;
      created.size = buffer.byteLength;
      created.url = URL.createObjectURL(new Blob([buffer], { type: 'image/webp' }));
      return created.url;
    }).catch(error => {
      images.delete(key);
      // Older local hosts may lack this optional acceleration. The existing
      // public image URL remains usable; never substitute a workspace file.
      log.warn('Marketplace image cache unavailable; using public image URL', { error });
      throw error;
    }).finally(() => pruneImages());
    images.set(key, created);
    entry = created;
  }
  images.delete(key);
  images.set(key, entry);
  entry.users += 1;
  let released = false;
  return {
    readyUrl: entry.url,
    url: entry.promise,
    release: () => {
      if (released) return;
      released = true;
      entry.users -= 1;
      pruneImages();
    },
  };
}

function pruneImages(): void {
  const idle = [...images.entries()].filter(([, entry]) => entry.users === 0 && entry.url);
  let bytes = idle.reduce((total, [, entry]) => total + entry.size, 0);
  let count = idle.length;
  for (const [key, entry] of idle) {
    if (count <= MAX_IDLE_IMAGES && bytes <= MAX_IDLE_BYTES) break;
    URL.revokeObjectURL(entry.url!);
    images.delete(key);
    count -= 1;
    bytes -= entry.size;
  }
}
