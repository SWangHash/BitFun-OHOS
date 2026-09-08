import { afterEach, describe, expect, it, vi } from 'vitest';

describe('remote connect disclaimer storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
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
});
