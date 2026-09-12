// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarketImage } from './MarketImage';

const cache = vi.hoisted(() => ({ acquireMarketImage: vi.fn(), canCacheMarketImage: () => true }));
vi.mock('@/infrastructure/api/service-api/MarketImageCache', () => cache);
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  cache.acquireMarketImage.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('ignores an old download after the server catalog replaces the image hash', async () => {
  let finishOld!: (url: string) => void;
  const releaseOld = vi.fn();
  const releaseNew = vi.fn();
  cache.acquireMarketImage.mockReturnValueOnce({
    url: new Promise<string>(resolve => { finishOld = resolve; }), release: releaseOld,
  }).mockReturnValueOnce({ url: Promise.resolve('blob:new'), release: releaseNew });
  await act(async () => root.render(<MarketImage source="https://market.test/old-hash" loading="eager" />));
  await act(async () => root.render(<MarketImage source="https://market.test/new-hash" loading="eager" />));
  expect(container.querySelector('img')?.src).toBe('blob:new');
  expect(releaseOld).toHaveBeenCalledOnce();
  await act(async () => finishOld('blob:old'));
  expect(container.querySelector('img')?.src).toBe('blob:new');
  await act(async () => root.render(null));
  expect(releaseNew).toHaveBeenCalledOnce();
});

it('keeps a cache hit mounted and revealed when only catalog metadata changes', async () => {
  cache.acquireMarketImage.mockReturnValue({
    readyUrl: 'blob:cached', url: Promise.resolve('blob:cached'), release: vi.fn(),
  });
  await act(async () => root.render(<MarketImage source="https://market.test/hash" alt="before" loading="eager" />));
  const image = container.querySelector('img')!;
  await act(async () => image.dispatchEvent(new Event('load')));
  await act(async () => root.render(<MarketImage source="https://market.test/hash" alt="after" loading="eager" />));
  expect(container.querySelector('img')).toBe(image);
  expect(image.dataset.loaded).toBe('true');
  expect(cache.acquireMarketImage).toHaveBeenCalledOnce();
});
