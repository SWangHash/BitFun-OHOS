import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('./ApiClient', () => ({ api: mocks }));
vi.mock('@/infrastructure/runtime', () => ({ isTauriRuntime: () => true }));

describe('market image leases', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.resetModules();
    mocks.invoke.mockReset();
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => 'blob:cached-market-image');
      static revokeObjectURL = vi.fn();
    });
  });

  it('deduplicates concurrent thumbnails and reuses decoded-source URLs on reopen', async () => {
    const { acquireMarketImage } = await import('./MarketImageCache');
    mocks.invoke.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    const source = `https://market.test/screenshots/${'a'.repeat(64)}`;
    const first = acquireMarketImage(source, 'compact-v1');
    const second = acquireMarketImage(source, 'compact-v1');
    expect(await first.url).toBe(await second.url);
    first.release(); second.release();
    const reopened = acquireMarketImage(source, 'compact-v1');
    expect(reopened.readyUrl).toBe('blob:cached-market-image');
    expect(mocks.invoke).toHaveBeenCalledOnce();
    reopened.release();
  });

  it('fetches changed content and resolutions independently, then caches both', async () => {
    const { acquireMarketImage } = await import('./MarketImageCache');
    mocks.invoke.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const source = `https://market.test/screenshots/${'a'.repeat(64)}`;
    for (const [url, variant] of [[source, 'compact-v1'], [source, 'large-v1'],
      [source.replace('a'.repeat(64), 'b'.repeat(64)), 'compact-v1']] as const) {
      const image = acquireMarketImage(url, variant);
      await image.url; image.release();
      const reused = acquireMarketImage(url, variant);
      await reused.url; reused.release();
    }
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
  });

  it('does not turn a failed request into a permanent cached failure', async () => {
    const { acquireMarketImage } = await import('./MarketImageCache');
    const source = `https://market.test/screenshots/${'a'.repeat(64)}`;
    mocks.invoke.mockRejectedValueOnce(new Error('offline'));
    const first = acquireMarketImage(source, 'compact-v1');
    await expect(first.url).rejects.toThrow('offline'); first.release();
    mocks.invoke.mockResolvedValueOnce(new ArrayBuffer(4));
    const retry = acquireMarketImage(source, 'compact-v1');
    await expect(retry.url).resolves.toBe('blob:cached-market-image'); retry.release();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });
});
