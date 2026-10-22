import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sshApi } from './sshApi';
import { activateSurface, resetDeviceSurfaceForTest } from '@/infrastructure/peer-device/deviceSurface';

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), unlisten: vi.fn(), request: vi.fn() }));
vi.mock('@/infrastructure/api/service-api/ApiClient', () => ({
  api: { invoke: native.invoke },
  ApiClient: class {
    invoke(...args: unknown[]) { return native.request(...args); }
  },
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }));

const transfers = [
  {
    name: 'download', command: 'remote_download_to_local_path', event: 'download_progress',
    run: (id?: string, cancelled?: () => boolean) => sshApi.downloadToLocalPath('ssh-host', '/remote/file', '/local/file', undefined, id, cancelled),
  },
  {
    name: 'upload', command: 'remote_upload_from_local_path', event: 'upload_progress',
    run: (id?: string, cancelled?: () => boolean) => sshApi.uploadFromLocalPath('ssh-host', '/local/file', '/remote/file', undefined, id, cancelled),
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  resetDeviceSurfaceForTest();
  native.invoke.mockResolvedValue(undefined);
  native.listen.mockResolvedValue(native.unlisten);
});

describe('SSH transfer lifetime', () => {
  it.each(transfers)('removes only the total deadline for a stoppable $name', async ({ run, command }) => {
    await run('transfer-id');
    expect(native.invoke).toHaveBeenLastCalledWith(command, expect.objectContaining({ transferId: 'transfer-id' }), { timeout: 0 });
    await run();
    expect(native.invoke).toHaveBeenLastCalledWith(command, expect.objectContaining({ transferId: expect.any(String) }), undefined);
  });

  it('retains the ordinary request deadline for directory reads', async () => {
    await sshApi.readDir('ssh-host', '/remote');
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith('remote_read_dir', { connectionId: 'ssh-host', path: '/remote' });
  });

  it.each(transfers)('does not start a $name stopped while its listener was registering', async ({ run }) => {
    let finishListening!: (unlisten: () => void) => void;
    native.listen.mockReturnValueOnce(new Promise(resolve => { finishListening = resolve; }));
    let cancelled = false;
    const outcome = run('transfer-id', () => cancelled).catch(error => error);
    await vi.waitFor(() => expect(native.listen).toHaveBeenCalledOnce());
    cancelled = true;
    finishListening(native.unlisten);
    await expect(outcome).resolves.toMatchObject({ message: 'Transfer cancelled' });
    expect(native.invoke).not.toHaveBeenCalled();
    expect(native.unlisten).toHaveBeenCalledOnce();
  });

  it.each(transfers)('repeats an early stop once $name progress proves backend registration', async ({ run, command, event }) => {
    let finishTransfer!: (value: undefined) => void;
    native.invoke.mockImplementation((action: string) => action === 'cancel_transfer'
      ? Promise.resolve()
      : new Promise(resolve => { finishTransfer = resolve; }));
    let cancelled = false;
    const pending = run('transfer-id', () => cancelled);
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledWith(command, expect.anything(), { timeout: 0 }));
    expect(native.listen.mock.calls[0][0]).toBe(event);
    const progress = native.listen.mock.calls[0][1];
    cancelled = true;
    await sshApi.cancelTransfer('transfer-id');
    progress({ payload: { transferId: 'another-transfer' } });
    expect(native.invoke.mock.calls.filter(([action]) => action === 'cancel_transfer')).toHaveLength(1);
    progress({ payload: { transferId: 'transfer-id' } });
    progress({ payload: { transferId: 'transfer-id' } });
    expect(native.invoke.mock.calls.filter(([action]) => action === 'cancel_transfer')).toHaveLength(2);
    finishTransfer(undefined);
    await pending;
    expect(native.unlisten).toHaveBeenCalledOnce();
  });

  it.each(transfers)('preserves $name backend errors and releases the listener', async ({ run }) => {
    native.invoke.mockRejectedValueOnce(new Error('SFTP request timed out'));
    await expect(run('transfer-id', () => false)).rejects.toThrow('SFTP request timed out');
    expect(native.unlisten).toHaveBeenCalledOnce();
  });

  it.each(transfers)('cancels a $name on its original host after switching device surfaces', async ({ run, command }) => {
    let finishTransfer!: (value: undefined) => void;
    native.invoke.mockReturnValueOnce(new Promise(resolve => { finishTransfer = resolve; }));
    const pending = run('original-host-transfer');
    expect(native.invoke).toHaveBeenCalledWith(command, expect.anything(), { timeout: 0 });
    activateSurface('another-device');
    await sshApi.cancelTransfer('original-host-transfer');
    expect(native.request).toHaveBeenCalledExactlyOnceWith('cancel_transfer', { transferId: 'original-host-transfer' });
    expect(native.invoke).toHaveBeenCalledTimes(1);
    finishTransfer(undefined);
    await pending;
  });
});
