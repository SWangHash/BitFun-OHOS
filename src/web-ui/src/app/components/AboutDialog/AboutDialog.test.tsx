// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AboutDialog } from './AboutDialog';

const mocks = vi.hoisted(() => ({
  checkForUpdatesOhos: vi.fn(),
  getAppVersion: vi.fn(),
  initialize: vi.fn(),
  isOpenHarmony: true,
}));

vi.mock('@/infrastructure/runtime', () => ({
  isOpenHarmonyRuntime: () => mocks.isOpenHarmony,
}));

vi.mock('@/infrastructure/update/tauriEnv', () => ({
  canCheckForAppUpdates: () => true,
  isTauriRuntime: () => true,
}));

vi.mock('@/infrastructure/api', () => ({
  systemAPI: {
    checkForUpdatesOhos: mocks.checkForUpdatesOhos,
    getAppVersion: mocks.getAppVersion,
    openExternal: vi.fn(),
  },
}));

vi.mock('@/infrastructure/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('@/app/components/Privacy/PrivacyContext', () => ({
  usePrivacy: () => ({ status: { enabled: false, hasUnreadUpdate: false } }),
}));

vi.mock('@/infrastructure/update/updateInstallStore', () => {
  const state = {
    error: null,
    initialized: false,
    progress: { downloaded: 0, total: null },
    requestInstall: vi.fn(),
    startInstall: vi.fn(),
    status: 'idle',
    version: null,
  };
  const useUpdateInstallStore = (selector: (value: typeof state) => unknown) => selector(state);
  useUpdateInstallStore.getState = () => ({ initialize: mocks.initialize });
  return { useUpdateInstallStore };
});

vi.mock('@/infrastructure/update/UpdateAvailableDialog', () => ({
  UpdateAvailableDialog: () => null,
}));

vi.mock('@/app/components/Privacy/PrivacyStatementDialog', () => ({
  PrivacyStatementDialog: () => null,
}));

vi.mock('./AboutBrandMark', () => ({ AboutBrandMark: () => null }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  mocks.isOpenHarmony = true;
  mocks.checkForUpdatesOhos.mockReset().mockResolvedValue({ updateAvailable: false });
  mocks.getAppVersion.mockReset().mockResolvedValue('2.0.0');
  mocks.initialize.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<AboutDialog isOpen onClose={() => undefined} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('keeps the HarmonyOS AppGallery check enabled without desktop updater initialization', async () => {
  const button = document.querySelector<HTMLButtonElement>('[data-testid="about-check-updates"]');
  expect(button).not.toBeNull();
  expect(button?.disabled).toBe(false);
  expect(mocks.initialize).not.toHaveBeenCalled();

  await act(async () => button?.click());

  expect(mocks.checkForUpdatesOhos).toHaveBeenCalledOnce();
  expect(button?.textContent).toContain('update.noUpdate');
});
