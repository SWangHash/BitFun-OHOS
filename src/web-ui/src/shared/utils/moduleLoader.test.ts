import { afterEach, describe, expect, it, vi } from 'vitest';
import { createModuleLoader } from './moduleLoader';

afterEach(() => vi.useRealTimers());

describe('recoverable module loading', () => {
  it('shares preload and render requests, retries a transport failure and caches success', async () => {
    vi.useFakeTimers();
    const module = { default: 'page' };
    const importer = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce(module);
    const load = createModuleLoader(importer);
    const first = load();
    expect(load()).toBe(first);
    await vi.advanceTimersByTimeAsync(250);
    await expect(first).resolves.toBe(module);
    await expect(load()).resolves.toBe(module);
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('allows a fresh attempt after transport retries are exhausted', async () => {
    vi.useFakeTimers();
    const importer = vi.fn().mockRejectedValue(new TypeError('Importing a module script failed'));
    const load = createModuleLoader(importer);
    const outcome = load().catch(error => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await outcome).toBeInstanceOf(TypeError);
    expect(importer).toHaveBeenCalledTimes(3);
    importer.mockResolvedValueOnce('recovered');
    await expect(load()).resolves.toBe('recovered');
  });

  it('does not retry module execution or syntax failures', async () => {
    const error = new SyntaxError('Unexpected token');
    const importer = vi.fn().mockRejectedValue(error);
    await expect(createModuleLoader(importer)()).rejects.toBe(error);
    expect(importer).toHaveBeenCalledTimes(1);
  });
});
