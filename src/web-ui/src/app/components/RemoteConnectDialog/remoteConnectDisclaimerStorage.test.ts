import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/infrastructure/api', () => ({
  configAPI: {
    getConfig: vi.fn(async () => undefined),
    setConfig: vi.fn(async () => undefined),
  },
}));

describe('remote connect disclaimer storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('persists agreement through localStorage when available', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    });
    const storage = await import('./remoteConnectDisclaimerStorage');

    expect(storage.getRemoteConnectDisclaimerAgreed()).toBe(false);
    storage.setRemoteConnectDisclaimerAgreed();
    expect(store.get('bitfun:remote-connect:disclaimer-agreed:v1')).toBe('true');
    expect(storage.getRemoteConnectDisclaimerAgreed()).toBe(true);
  });

  it('keeps the agreement for the session when localStorage throws', async () => {
    // Simulate the OHOS host: ArkWeb DOM storage is disabled, so every
    // localStorage access throws.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError: DOM storage is disabled');
      },
      setItem: () => {
        throw new Error('SecurityError: DOM storage is disabled');
      },
    });
    const storage = await import('./remoteConnectDisclaimerStorage');

    expect(storage.getRemoteConnectDisclaimerAgreed()).toBe(false);
    storage.setRemoteConnectDisclaimerAgreed();
    expect(storage.getRemoteConnectDisclaimerAgreed()).toBe(true);
  });

  it('writes the agreement to app config so it survives restarts', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError: DOM storage is disabled');
      },
      setItem: () => {
        throw new Error('SecurityError: DOM storage is disabled');
      },
    });
    const { configAPI } = await import('@/infrastructure/api');
    const setConfigSpy = vi.spyOn(configAPI, 'setConfig').mockResolvedValue(undefined);
    const storage = await import('./remoteConnectDisclaimerStorage');

    storage.setRemoteConnectDisclaimerAgreed();
    await vi.waitFor(() => {
      expect(setConfigSpy).toHaveBeenCalledWith('remote_connect_disclaimer', expect.objectContaining({
        agreedAt: expect.any(String),
      }));
    });
  });

  it('restores the persisted agreement from app config on hosts without localStorage', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError: DOM storage is disabled');
      },
      setItem: () => {
        throw new Error('SecurityError: DOM storage is disabled');
      },
    });
    const { configAPI } = await import('@/infrastructure/api');
    vi.spyOn(configAPI, 'getConfig').mockResolvedValue({ agreedAt: '2026-10-21T00:00:00.000Z' });
    const storage = await import('./remoteConnectDisclaimerStorage');

    await storage.hydrateRemoteConnectDisclaimerAgreed();
    expect(storage.getRemoteConnectDisclaimerAgreed()).toBe(true);
  });

  it('stays unagreed when the config value is absent', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError: DOM storage is disabled');
      },
      setItem: () => {
        throw new Error('SecurityError: DOM storage is disabled');
      },
    });
    const { configAPI } = await import('@/infrastructure/api');
    vi.spyOn(configAPI, 'getConfig').mockResolvedValue(undefined);
    const storage = await import('./remoteConnectDisclaimerStorage');

    await storage.hydrateRemoteConnectDisclaimerAgreed();
    expect(storage.getRemoteConnectDisclaimerAgreed()).toBe(false);
  });
});
