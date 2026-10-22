// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickSshCertificatePath, pickSshPrivateKeyPath } from './pickSshPrivateKeyPath';
import { activateSurface, resetDeviceSurfaceForTest } from '@/infrastructure/peer-device/deviceSurface';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  homeDir: vi.fn(),
  join: vi.fn(),
}));

vi.mock('@/infrastructure/api/service-api/ApiClient', () => ({ api: { invoke: mocks.invoke } }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }));
vi.mock('@tauri-apps/api/path', () => ({ homeDir: mocks.homeDir, join: mocks.join }));
vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe('SSH authentication file picker', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetDeviceSurfaceForTest();
    vi.stubGlobal('navigator', { userAgent: 'HarmonyOS', platform: 'Linux' });
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke: vi.fn() });
    mocks.invoke.mockResolvedValue('/storage/keys/dev');
  });

  afterEach(() => {
    resetDeviceSurfaceForTest();
    vi.unstubAllGlobals();
  });

  it.each([
    ['private key', pickSshPrivateKeyPath],
    ['certificate', pickSshCertificatePath],
  ] as const)('opens the HarmonyOS %s picker without desktop path or dialog plugins', async (_kind, pick) => {
    await expect(pick({ title: 'Select SSH file' })).resolves.toBe('/storage/keys/dev');
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('open_oh_file_dialog', {
      options: JSON.stringify({ multiple: false, directory: false, title: 'Select SSH file' }),
    }, { timeout: 0 });
    expect(mocks.homeDir).not.toHaveBeenCalled();
    expect(mocks.join).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('retains the desktop SSH default directory', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Macintosh', platform: 'MacIntel' });
    mocks.homeDir.mockResolvedValue('/Users/test');
    mocks.join.mockResolvedValue('/Users/test/.ssh');
    mocks.open.mockResolvedValue('/Users/test/.ssh/id_ed25519');
    await expect(pickSshPrivateKeyPath()).resolves.toBe('/Users/test/.ssh/id_ed25519');
    expect(mocks.join).toHaveBeenCalledExactlyOnceWith('/Users/test', '.ssh');
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      multiple: false,
      directory: false,
      defaultPath: '/Users/test/.ssh',
    }));
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('preserves cancellation and reports picker failures', async () => {
    mocks.invoke.mockResolvedValueOnce('');
    await expect(pickSshPrivateKeyPath()).resolves.toBeNull();
    mocks.invoke.mockRejectedValueOnce(new Error('Document picker unavailable'));
    await expect(pickSshPrivateKeyPath()).rejects.toThrow('Document picker unavailable');
  });

  it('does not select a controller key for a peer-hosted SSH connection', async () => {
    activateSurface('peer-host');
    await expect(pickSshPrivateKeyPath()).rejects.toThrow('not supported on a peer host');
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.homeDir).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
