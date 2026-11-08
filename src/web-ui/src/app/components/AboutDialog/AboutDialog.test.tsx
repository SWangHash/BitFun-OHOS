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
  storeState: {
    error: null as string | null,
    initialized: false,
    progress: { downloaded: 0, total: null },
    requestInstall: vi.fn(),
    startInstall: vi.fn(),
    status: 'idle',
    version: null as string | null,
  },
}));

vi.mock('@/infrastructure/runtime', () => ({
  isOpenHarmonyRuntime: () => mocks.isOpenHarmony,
  isTauriRuntime: () => true,
}));

vi.mock('@/infrastructure/update/tauriEnv', () => ({
  canCheckForAppUpdates: () => true,
  canShowAppUpdateEntry: () => true,
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
  const useUpdateInstallStore = (selector: (value: typeof mocks.storeState) => unknown) => selector(mocks.storeState);
  useUpdateInstallStore.getState = () => ({ initialize: mocks.initialize });
  return { useUpdateInstallStore };
});

vi.mock('@/infrastructure/update/UpdateAvailableDialog', () => ({
  UpdateAvailableDialog: () => null,
}));

vi.mock('@/app/components/Privacy/PrivacyStatementDialog', () => ({
  PrivacyStatementDialog: () => null,
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  mocks.isOpenHarmony = true;
  mocks.storeState.error = null;
  mocks.storeState.status = 'idle';
  mocks.storeState.version = null;
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

it('never presents a staged desktop updater error on HarmonyOS', async () => {
  // A stale desktop-store failure (for example an unregistered
  // `get_pending_update` command) must not surface as a HarmonyOS update error.
  mocks.storeState.error = 'Command get_pending_update not found';
  mocks.storeState.status = 'error';
  await act(async () => root.render(<AboutDialog isOpen onClose={() => undefined} />));

  expect(container.textContent).not.toContain('update.errors.notFound');
  expect(container.textContent).not.toContain('get_pending_update');
});
