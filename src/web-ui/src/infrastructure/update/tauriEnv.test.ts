import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  canAutoCheckForAppUpdates,
  canCheckForAppUpdates,
  canShowAppUpdateEntry,
} from './tauriEnv';

const HARMONYOS_NAVIGATOR = { userAgent: 'Mozilla/5.0 (OpenHarmony; x86_64)', platform: 'OpenHarmony' };
const WINDOWS_NAVIGATOR = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32' };

describe('app update runtime availability', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('keeps manual update actions available while disabling automatic checks in desktop development', () => {
    vi.stubEnv('DEV', true);
    vi.stubGlobal('window', { __TAURI__: {} });
    vi.stubGlobal('navigator', HARMONYOS_NAVIGATOR);

    expect(canCheckForAppUpdates()).toBe(true);
    expect(canAutoCheckForAppUpdates()).toBe(false);
  });

  it('enables manual and automatic checks in a packaged Tauri runtime', () => {
    vi.stubEnv('DEV', false);
    vi.stubGlobal('window', { __TAURI__: {} });
    vi.stubGlobal('navigator', HARMONYOS_NAVIGATOR);

    expect(canCheckForAppUpdates()).toBe(true);
    expect(canShowAppUpdateEntry()).toBe(true);
    expect(canAutoCheckForAppUpdates()).toBe(true);
  });

  it('keeps the update entry on HarmonyOS only', () => {
    vi.stubGlobal('window', { __TAURI__: {} });
    vi.stubGlobal('navigator', HARMONYOS_NAVIGATOR);
    expect(canShowAppUpdateEntry()).toBe(true);

    vi.stubGlobal('navigator', WINDOWS_NAVIGATOR);
    expect(canCheckForAppUpdates()).toBe(true);
    expect(canShowAppUpdateEntry()).toBe(false);
    expect(canAutoCheckForAppUpdates()).toBe(false);
  });

  it.each([true, false])('omits desktop update actions in a plain browser with DEV=%s', development => {
    vi.stubEnv('DEV', development);
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', HARMONYOS_NAVIGATOR);

    expect(canCheckForAppUpdates()).toBe(false);
    expect(canShowAppUpdateEntry()).toBe(false);
    expect(canAutoCheckForAppUpdates()).toBe(false);
  });
});
