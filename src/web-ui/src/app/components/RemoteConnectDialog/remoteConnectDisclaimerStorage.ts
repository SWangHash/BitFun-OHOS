import { configAPI } from '@/infrastructure/api';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('RemoteConnectDisclaimerStorage');

export const REMOTE_CONNECT_DISCLAIMER_KEY = 'bitfun:remote-connect:disclaimer-agreed:v1';

// Persisted agreement lives in the app configuration document (not localStorage)
// because the OHOS main-window webview runs with ArkWeb DOM storage disabled:
// wry's OHOS backend never passes `dom_storage_access`, and openharmony-ability
// defaults the ArkWeb `domStorageAccess` attribute to `false`, so localStorage
// access throws on that host. The value rides the typed `GlobalConfig` field
// `remote_connect_disclaimer` (see config-contracts), so it survives restarts
// on every host. localStorage remains a fast path for hosts that have it.
const DISCLAIMER_CONFIG_KEY = 'remote_connect_disclaimer';

interface DisclaimerConfigValue {
  agreedAt: string;
}

let sessionAgreed = false;
let hydrationStarted = false;

export const getRemoteConnectDisclaimerAgreed = (): boolean => {
  if (sessionAgreed) return true;
  try {
    return localStorage.getItem(REMOTE_CONNECT_DISCLAIMER_KEY) === 'true';
  } catch {
    return false;
  }
};

/**
 * Restores the persisted agreement from the app config document. Called once
 * at startup so the gate state is ready before the Remote Connect dialog
 * opens, even on hosts without localStorage.
 */
export const hydrateRemoteConnectDisclaimerAgreed = async (): Promise<void> => {
  hydrationStarted = true;
  if (sessionAgreed) return;
  try {
    const saved = await configAPI.getConfig(DISCLAIMER_CONFIG_KEY, { skipRetryOnNotFound: true }) as DisclaimerConfigValue | undefined;
    if (saved && typeof saved.agreedAt === 'string' && saved.agreedAt.length > 0) {
      sessionAgreed = true;
      log.info('Remote connect disclaimer agreement restored from config');
    }
  } catch (error) {
    log.warn('Failed to read remote connect disclaimer agreement', { error: String(error) });
  }
};

export const setRemoteConnectDisclaimerAgreed = (): void => {
  sessionAgreed = true;
  try {
    localStorage.setItem(REMOTE_CONNECT_DISCLAIMER_KEY, 'true');
  } catch {
    // Ignore storage failures; the config write below covers persistence.
  }
  void configAPI.setConfig(DISCLAIMER_CONFIG_KEY, {
    agreedAt: new Date().toISOString(),
  }).catch((error: unknown) => {
    log.warn('Failed to persist remote connect disclaimer agreement', { error: String(error) });
  });
};

export const isRemoteConnectDisclaimerHydrated = (): boolean => hydrationStarted;
