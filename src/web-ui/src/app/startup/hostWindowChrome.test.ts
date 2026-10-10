// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workspaceAPI = vi.hoisted(() => ({
  setDecorationsOhos: vi.fn(),
}));

vi.mock('@/infrastructure/api/service-api/WorkspaceAPI', () => ({ workspaceAPI }));

import { handOverHostWindowChromeToAppSurface } from './hostWindowChrome';

const originalUserAgent = window.navigator.userAgent;

function setUserAgent(value: string): void {
  Object.defineProperty(window.navigator, 'userAgent', { value, configurable: true });
}

describe('handOverHostWindowChromeToAppSurface', () => {
  beforeEach(() => {
    workspaceAPI.setDecorationsOhos.mockReset();
    workspaceAPI.setDecorationsOhos.mockResolvedValue(undefined);
  });

  afterEach(() => {
    setUserAgent(originalUserAgent);
    vi.useRealTimers();
  });

  it('reveals the host-drawn window chrome on the HarmonyOS host', async () => {
    setUserAgent('Mozilla/5.0 (OpenHarmony)');

    await handOverHostWindowChromeToAppSurface();

    expect(workspaceAPI.setDecorationsOhos).toHaveBeenCalledWith(true);
  });

  it('leaves the window chrome to the app shell on desktop platforms', async () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');

    await handOverHostWindowChromeToAppSurface();

    expect(workspaceAPI.setDecorationsOhos).not.toHaveBeenCalled();
  });

  it('resolves within the bound when the host never answers', async () => {
    vi.useFakeTimers();
    setUserAgent('Mozilla/5.0 (OpenHarmony)');
    workspaceAPI.setDecorationsOhos.mockImplementation(() => new Promise<void>(() => undefined));

    const handover = handOverHostWindowChromeToAppSurface();
    await vi.advanceTimersByTimeAsync(500);

    await expect(handover).resolves.toBeUndefined();
  });

  it('never rejects when the host call fails', async () => {
    setUserAgent('Mozilla/5.0 (OpenHarmony)');
    workspaceAPI.setDecorationsOhos.mockRejectedValue(new Error('host call unavailable'));

    await expect(handOverHostWindowChromeToAppSurface()).resolves.toBeUndefined();
  });
});
