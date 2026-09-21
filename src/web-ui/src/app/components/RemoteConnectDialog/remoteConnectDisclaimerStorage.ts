export const REMOTE_CONNECT_DISCLAIMER_KEY = 'bitfun:remote-connect:disclaimer-agreed:v1';

// The OHOS main-window webview runs with ArkWeb DOM storage disabled: wry's
// OHOS backend never passes `dom_storage_access`, and openharmony-ability
// defaults the ArkWeb `domStorageAccess` attribute to `false`. localStorage
// access therefore throws on that host, and the persisted agreement cannot be
// relied on. Keep a session-scoped fallback so agreeing once per run survives
// RemoteConnectDialog remounts; the persisted value keeps working wherever
// localStorage is available.
let sessionAgreed = false;

export const getRemoteConnectDisclaimerAgreed = (): boolean => {
  if (sessionAgreed) return true;
  try {
    return localStorage.getItem(REMOTE_CONNECT_DISCLAIMER_KEY) === 'true';
  } catch {
    return false;
  }
};

export const setRemoteConnectDisclaimerAgreed = (): void => {
  sessionAgreed = true;
  try {
    localStorage.setItem(REMOTE_CONNECT_DISCLAIMER_KEY, 'true');
  } catch {
    // Ignore storage failures; the session fallback above covers this run.
  }
};
