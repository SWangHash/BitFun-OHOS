// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickSshDownloadPath, pickSshUploadPaths } from './sshFileDialogs';
import { pickSshCertificatePath, pickSshPrivateKeyPath } from './pickSshPrivateKeyPath';
import { activateSurface, isSurfaceChangedError, resetDeviceSurfaceForTest } from '@/infrastructure/peer-device/deviceSurface';
import { sshApi } from './sshApi';
import { describeFileAccessError } from '@/infrastructure/services/business/fileAccessErrorPresentation';

const transport = vi.hoisted(() => ({ request: vi.fn(), alternateRequest: vi.fn(), switched: false }));

// Keep the real WorkspaceAPI and ApiClient: a resolved invoke mock would hide
// the request timer that used to expire while the system picker was open.
vi.mock('@/infrastructure/api/adapters', () => ({
  getTransportAdapter: () => transport.switched ? { request: transport.alternateRequest } : transport,
  isPeerLocalOnlyCommand: () => false,
}));
vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/shared/utils/startupTrace', () => ({
  estimateJsonBytes: vi.fn(),
  isRemoteTraceRequest: () => false,
  startupTrace: { recordApiCall: vi.fn() },
}));

beforeEach(() => {
  vi.useFakeTimers();
  transport.request.mockReset();
  transport.alternateRequest.mockReset();
  transport.switched = false;
  resetDeviceSurfaceForTest();
  vi.stubGlobal('navigator', { userAgent: 'HarmonyOS', platform: 'Linux' });
  vi.stubGlobal('__TAURI_INTERNALS__', { invoke: vi.fn() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetDeviceSurfaceForTest();
});

describe('SSH system picker waiting', () => {
  it.each([
    ['upload files', () => pickSshUploadPaths('Upload'), ['/chosen/file']],
    ['download folder', () => pickSshDownloadPath('file.bin', 'Download'), '/chosen/file/file.bin'],
    ['private key', () => pickSshPrivateKeyPath(), '/chosen/file'],
    ['certificate', () => pickSshCertificatePath(), '/chosen/file'],
  ] as const)('waits for the user to finish choosing %s beyond the ordinary request deadline', async (_name, pick, expected) => {
    let finishPicker!: (value: string) => void;
    transport.request.mockReturnValueOnce(new Promise<string>(resolve => { finishPicker = resolve; }));
    let settled = false;
    const pending = pick().then(
      value => ({ value, error: undefined }),
      error => ({ value: undefined, error }),
    );
    void pending.then(() => { settled = true; });
    try {
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(settled).toBe(false);
      finishPicker('/chosen/file');
      await expect(pending).resolves.toEqual({ value: expected, error: undefined });
      expect(transport.request).toHaveBeenCalledTimes(1);
    } finally {
      finishPicker('/chosen/file');
      await pending;
    }
  });

  it('accepts cancellation after the upload picker has remained open', async () => {
    let finishPicker!: (value: string) => void;
    transport.request.mockReturnValueOnce(new Promise<string>(resolve => { finishPicker = resolve; }));
    const pending = pickSshUploadPaths('Upload');
    await vi.advanceTimersByTimeAsync(120_000);
    finishPicker('null');
    await expect(pending).resolves.toEqual([]);
  });

  it.each([
    ['download', () => sshApi.downloadToLocalPath('ssh-host', '/remote/file', '/local/file', undefined, 'download-id')],
    ['upload', () => sshApi.uploadFromLocalPath('ssh-host', '/local/file', '/remote/file', undefined, 'upload-id')],
  ] as const)('keeps waiting for a stoppable %s beyond the ordinary deadline', async (_name, transfer) => {
    let finishTransfer!: (value: undefined) => void;
    transport.request.mockReturnValueOnce(new Promise(resolve => { finishTransfer = resolve; }));
    let settled = false;
    const pending = transfer().then(
      () => { settled = true; },
      error => { settled = true; throw error; },
    );
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(settled).toBe(false);
    finishTransfer(undefined);
    await pending;
  });

  it.each([
    ['download', () => sshApi.downloadToLocalPath('ssh-host', '/remote/file', '/local/file', undefined, 'cancelled-transfer')],
    ['upload', () => sshApi.uploadFromLocalPath('ssh-host', '/local/file', '/remote/file', undefined, 'cancelled-transfer')],
  ] as const)('preserves the native cancellation response from an in-flight %s for the browser', async (_name, transfer) => {
    let rejectTransfer!: (reason: string) => void;
    transport.request.mockImplementation((command: string) => command === 'cancel_transfer'
      ? Promise.resolve()
      : new Promise((_resolve, reject) => { rejectTransfer = reject; }));
    const outcome = transfer().catch(error => error);
    expect(transport.request).toHaveBeenCalledTimes(1);
    await sshApi.cancelTransfer('cancelled-transfer');
    // Both native SFTP and container transfer commands return this string.
    // Exercise ApiClient normalization instead of injecting an Error into the UI.
    rejectTransfer('Transfer cancelled');
    expect(describeFileAccessError(await outcome)).toBe('Transfer cancelled');
  });

  it('keeps cleanup cancellation on the original host with its ordinary deadline', async () => {
    let finishTransfer!: (value: undefined) => void;
    transport.request.mockImplementation((command: string) => command === 'cancel_transfer'
      ? new Promise(() => {})
      : new Promise(resolve => { finishTransfer = resolve; }));
    const transfer = sshApi.downloadToLocalPath('ssh-host', '/remote/file', '/local/file', undefined, 'original-transfer')
      .catch(error => error);
    activateSurface('another-device');
    transport.switched = true;
    const cancellation = sshApi.cancelTransfer('original-transfer').catch(error => error);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(cancellation).resolves.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    expect(transport.request).toHaveBeenCalledWith('cancel_transfer', { transferId: 'original-transfer' }, expect.anything());
    expect(transport.alternateRequest).not.toHaveBeenCalled();
    finishTransfer(undefined);
    expect(isSurfaceChangedError(await transfer)).toBe(true);
  });
});
