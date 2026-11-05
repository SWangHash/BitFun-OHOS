// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import common from '../../locales/zh-CN/common.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteFileBrowser } from './RemoteFileBrowser';
import type { RemoteFileEntry } from './types';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  readDir: vi.fn(async () => [{ name: 'old.txt', path: '/srv/project/old.txt', isDir: false }]),
  rename: vi.fn(async () => undefined),
  downloadToLocalPath: vi.fn(async (_connectionId: string, _remotePath: string, _localPath: string,
    _onProgress?: undefined, _transferId?: string, _isCancelled?: () => boolean) => undefined),
  uploadFromLocalPath: vi.fn(async (_connectionId: string, _localPath: string, _remotePath: string,
    _onProgress?: undefined, _transferId?: string, _isCancelled?: () => boolean) => ({ wasDirectory: false })),
  cancelTransfer: vi.fn(async (_transferId: string) => undefined),
}));
const native = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), save: vi.fn(), confirm: vi.fn() }));
const device = vi.hoisted(() => ({ surfaceId: 'local', assertCurrent: vi.fn() }));
vi.mock('./sshApi', () => ({ sshApi: api }));
vi.mock('@/infrastructure/api/service-api/ApiClient', () => ({ api: { invoke: native.invoke } }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: native.open, save: native.save }));
vi.mock('@/infrastructure/confirm-dialog/confirmDialogService', async importOriginal => ({
  ...await importOriginal<typeof import('@/infrastructure/confirm-dialog/confirmDialogService')>(),
  confirmDialog: native.confirm,
}));
vi.mock('@/infrastructure/peer-device/deviceSurface', async importOriginal => {
  const actual = await importOriginal<typeof import('@/infrastructure/peer-device/deviceSurface')>();
  return {
    ...actual,
    getActiveSurfaceScope: () => ({ ...actual.getActiveSurfaceScope(), ...device }),
  };
});
vi.mock('@/infrastructure/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
  i18nService: { t: (key: string) => key.replace('common:', '').split('.').reduce<any>((node, part) => node?.[part], common) ?? key },
}));

const fileEntry: RemoteFileEntry = {
  name: 'old.txt', path: '/srv/project/old.txt', isDir: false, isFile: true, isSymlink: false,
};
const linkEntry: RemoteFileEntry = {
  name: 'linked project', path: '/srv/project/linked project', isDir: false, isFile: false, isSymlink: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.readDir.mockReset().mockResolvedValue([{ name: 'old.txt', path: '/srv/project/old.txt', isDir: false }]);
  api.downloadToLocalPath.mockReset().mockResolvedValue(undefined);
  api.uploadFromLocalPath.mockReset().mockResolvedValue({ wasDirectory: false });
  api.cancelTransfer.mockReset().mockResolvedValue(undefined);
  native.invoke.mockReset();
  native.open.mockReset();
  native.save.mockReset();
  native.confirm.mockReset().mockResolvedValue(false);
  device.surfaceId = 'local';
  device.assertCurrent.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function useHost(platform: 'ohos' | 'desktop' | 'browser' = 'ohos') {
  vi.stubGlobal('navigator', { userAgent: platform === 'ohos' ? 'OpenHarmony' : 'Macintosh', platform });
  // Tauri v2 need not expose window.__TAURI__.
  vi.stubGlobal('__TAURI_INTERNALS__', platform === 'browser' ? undefined : { invoke: vi.fn() });
}

function selectPaths(path: string, destinationExists = false) {
  native.invoke.mockImplementation(async (command: string) => command === 'check_path_exists' ? destinationExists : path);
}

async function withBrowser(
  run: (onSelect: ReturnType<typeof vi.fn>, unmount: () => void, onCancel: ReturnType<typeof vi.fn>) => Promise<void>,
  selectDirectoriesOnly = false,
) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onSelect = vi.fn();
  const onCancel = vi.fn(() => unmount());
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    act(() => root.unmount());
    mounted = false;
  };
  try {
    await act(async () => root.render(<RemoteFileBrowser connectionId="ssh-host" initialPath="/srv/project"
      selectDirectoriesOnly={selectDirectoriesOnly} onSelect={onSelect} onCancel={onCancel} />));
    await run(onSelect, unmount, onCancel);
  } finally {
    unmount();
    container.remove();
  }
}

function fileContextMenu() {
  const row = document.querySelector<HTMLElement>('.remote-file-browser__row:not(.remote-file-browser__row--parent)')!;
  act(() => row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 80, clientY: 90 })));
}

async function transfer(action: 'upload' | 'download') {
  if (action === 'download') fileContextMenu();
  const button = action === 'upload'
    ? document.querySelector<HTMLElement>('[aria-label="ssh.remote.upload"]')!
    : [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find(node => node.textContent === 'ssh.remote.download')!;
  await act(async () => button.click());
}

function stopButton() {
  return document.querySelector<HTMLButtonElement>('[data-testid="ssh-file-transfer-stop"]');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('SSH file actions', () => {
  it('uploads all OHOS file selections to the displayed remote directory and refreshes it', async () => {
    useHost();
    selectPaths('["/storage/Users/currentUser/Desktop/a.bin","/storage/Users/currentUser/Desktop/b.bin"]');
    await withBrowser(async () => {
      await transfer('upload');
      expect(native.invoke).toHaveBeenCalledWith('open_oh_file_dialog', {
        options: JSON.stringify({ title: 'ssh.remote.uploadDialogTitle', multiple: true, directory: false }),
      }, { timeout: 0 });
      expect(api.uploadFromLocalPath.mock.calls).toEqual([
        ['ssh-host', '/storage/Users/currentUser/Desktop/a.bin', '/srv/project/a.bin', undefined, expect.any(String), expect.any(Function)],
        ['ssh-host', '/storage/Users/currentUser/Desktop/b.bin', '/srv/project/b.bin', undefined, expect.any(String), expect.any(Function)],
      ]);
      expect(api.uploadFromLocalPath.mock.calls[0][4]).not.toBe(api.uploadFromLocalPath.mock.calls[1][4]);
      expect(api.readDir).toHaveBeenCalledTimes(2);
      expect(native.open).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['ohos', '/storage/report\\draft.txt', '/srv/project/report\\draft.txt'],
    ['desktop', '/Users/test/report\\draft.txt', '/srv/project/report\\draft.txt'],
    ['windows', 'C:\\Users\\test\\draft.txt', '/srv/project/draft.txt'],
  ] as const)('preserves the upload filename on %s', async (platform, localPath, remotePath) => {
    useHost(platform === 'ohos' ? 'ohos' : 'desktop');
    if (platform === 'windows') {
      vi.stubGlobal('navigator', { userAgent: 'Windows', platform: 'Win32' });
      vi.stubGlobal('__TAURI_INTERNALS__', { invoke: vi.fn(), metadata: { currentWindow: { label: 'main' } } });
    }
    selectPaths(JSON.stringify([localPath]));
    native.open.mockResolvedValue([localPath]);
    await withBrowser(async () => {
      await transfer('upload');
      expect(api.uploadFromLocalPath).toHaveBeenCalledExactlyOnceWith('ssh-host', localPath, remotePath,
        undefined, expect.any(String), expect.any(Function));
    });
  });

  it('refreshes the displayed directory when an upload finishes after navigation', async () => {
    useHost();
    selectPaths('/storage/new.bin');
    const pending = deferred<{ wasDirectory: boolean }>();
    api.uploadFromLocalPath.mockReturnValueOnce(pending.promise);
    api.readDir.mockImplementation(async (_connectionId?: string, path?: string) => [
      { name: path === '/srv' ? 'parent.txt' : 'old.txt', path: `${path}/file`, isDir: false },
    ]);
    await withBrowser(async () => {
      await transfer('upload');
      await act(async () => document.querySelector<HTMLElement>('.remote-file-browser__row--parent')!.click());
      await act(async () => pending.resolve({ wasDirectory: false }));
      expect(api.readDir).toHaveBeenLastCalledWith('ssh-host', '/srv');
      expect(document.querySelector('.remote-file-browser__table')?.textContent).toContain('parent.txt');
    });
  });

  it.each(['success', 'failure'] as const)('keeps a delayed directory %s from replacing a newer navigation', async outcome => {
    const pending = deferred<Array<{ name: string; path: string; isDir: boolean }>>();
    await withBrowser(async () => {
      api.readDir.mockReturnValueOnce(pending.promise);
      await act(async () => document.querySelector<HTMLElement>('[aria-label="actions.refresh"]')!.click());
      api.readDir.mockResolvedValueOnce([{ name: 'parent.txt', path: '/srv/parent.txt', isDir: false }]);
      await act(async () => document.querySelector<HTMLElement>('[aria-label="newProject.parentDirectory"]')!.click());
      await act(async () => {
        if (outcome === 'success') pending.resolve([{ name: 'stale.txt', path: '/srv/project/stale.txt', isDir: false }]);
        else pending.reject(new Error('Old directory unavailable'));
      });
      expect(document.querySelector('.remote-file-browser__table')?.textContent).toContain('parent.txt');
      expect(document.querySelector('.remote-file-browser__table')?.textContent).not.toContain('stale.txt');
      expect(document.querySelector('.remote-file-browser__error')).toBeNull();
    });
  });

  it.each([
    ['/storage/Users/currentUser/Download/', 'old.txt', '/storage/Users/currentUser/Download/old.txt'],
    ['/', 'old.txt', '/old.txt'],
    ['/downloads', '..\\..\\config:backup', '/downloads/..\\..\\config:backup'],
    ['/downloads', 'version..txt', '/downloads/version..txt'],
  ])('downloads into the selected OHOS folder %s without changing the name %s', async (folder, name, destination) => {
    useHost();
    api.readDir.mockResolvedValue([{ name, path: `/srv/project/${name}`, isDir: false }]);
    selectPaths(folder);
    await withBrowser(async () => {
      await transfer('download');
      expect(native.invoke).toHaveBeenCalledWith('open_oh_file_dialog', {
        options: JSON.stringify({ title: 'ssh.remote.downloadDialogTitle', directory: true, multiple: false }),
      }, { timeout: 0 });
      expect(api.downloadToLocalPath).toHaveBeenCalledExactlyOnceWith('ssh-host', `/srv/project/${name}`,
        destination, undefined, expect.any(String), expect.any(Function));
      expect(native.invoke).toHaveBeenCalledWith('check_path_exists', {
        request: { path: destination, remoteConnectionId: '' },
      });
      expect(native.save).not.toHaveBeenCalled();
    });
  });

  it.each(['../../outside', 'a/../../outside', '/absolute', '', '.', '..', 'file\0name'])(
    'rejects a remote name that is not a POSIX file component: %j', async name => {
      useHost();
      api.readDir.mockResolvedValue([{ name, path: `/srv/project/${name}`, isDir: false }]);
      selectPaths('/downloads');
      await withBrowser(async () => {
        await transfer('download');
        expect(document.querySelector('.remote-file-browser__error')?.textContent)
          .toContain('Remote entry name cannot be represented as a local path component');
        expect(native.invoke).not.toHaveBeenCalled();
        expect(api.downloadToLocalPath).not.toHaveBeenCalled();
      });
    },
  );

  it.each([false, true])('requires an explicit overwrite decision (%s) for an existing OHOS download', async overwrite => {
    useHost();
    selectPaths('/downloads', true);
    native.confirm.mockResolvedValue(overwrite);
    await withBrowser(async () => {
      await transfer('download');
      expect(native.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmText: 'editor.codeEditor.overwriteSave' }));
      expect(api.downloadToLocalPath).toHaveBeenCalledTimes(overwrite ? 1 : 0);
    });
  });

  it('retains the desktop save dialog and its chosen file name', async () => {
    useHost('desktop');
    native.save.mockResolvedValue('/downloads/renamed.txt');
    await withBrowser(async () => {
      await transfer('download');
      expect(native.save).toHaveBeenCalledExactlyOnceWith({ title: 'ssh.remote.downloadDialogTitle', defaultPath: 'old.txt' });
      expect(api.downloadToLocalPath).toHaveBeenCalledExactlyOnceWith('ssh-host', '/srv/project/old.txt',
        '/downloads/renamed.txt', undefined, expect.any(String), expect.any(Function));
    });
  });

  it.each(['upload', 'download'] as const)('does not transfer or report an error when %s is cancelled', async action => {
    useHost();
    selectPaths('null');
    await withBrowser(async () => {
      await transfer(action);
      expect(api.uploadFromLocalPath).not.toHaveBeenCalled();
      expect(api.downloadToLocalPath).not.toHaveBeenCalled();
      expect(document.querySelector('.remote-file-browser__error')).toBeNull();
    });
  });

  it.each(['upload', 'download'] as const)('shows %s picker failures and allows retry', async action => {
    useHost();
    selectPaths('null');
    native.invoke.mockRejectedValueOnce(new Error('Document picker unavailable'));
    await withBrowser(async () => {
      await transfer(action);
      expect(document.querySelector('.remote-file-browser__error')?.textContent).toContain('Document picker unavailable');
      expect(api.uploadFromLocalPath).not.toHaveBeenCalled();
      expect(api.downloadToLocalPath).not.toHaveBeenCalled();
      await transfer(action);
      expect(document.querySelector('.remote-file-browser__error')).toBeNull();
    });
  });

  it.each(['upload', 'download'] as const)('shows %s transfer errors and releases the busy state', async action => {
    useHost();
    selectPaths('/downloads/file.bin');
    api.uploadFromLocalPath.mockRejectedValue(new Error('SFTP transfer failed'));
    api.downloadToLocalPath.mockRejectedValue(new Error('SFTP transfer failed'));
    await withBrowser(async () => {
      await transfer(action);
      expect(document.querySelector('.remote-file-browser__error')?.textContent).toContain('SFTP transfer failed');
      expect(document.querySelector<HTMLButtonElement>('[aria-label="ssh.remote.upload"]')?.disabled).toBe(false);
    });
  });

  it.each(['upload', 'download'] as const)('keeps %s busy until the stopped native request ends', async action => {
    useHost();
    selectPaths('/downloads/file.bin');
    const pendingUpload = deferred<{ wasDirectory: boolean }>();
    const pendingDownload = deferred<void>();
    api.uploadFromLocalPath.mockReturnValueOnce(pendingUpload.promise);
    api.downloadToLocalPath.mockReturnValueOnce(pendingDownload.promise);
    await withBrowser(async () => {
      await transfer(action);
      const call = action === 'upload' ? api.uploadFromLocalPath.mock.calls[0] : api.downloadToLocalPath.mock.calls[0];
      expect(call[5]?.()).toBe(false);
      expect(stopButton()).not.toBeNull();
      await act(async () => stopButton()!.click());
      expect(api.cancelTransfer).toHaveBeenCalledExactlyOnceWith(call[4]);
      expect(call[5]?.()).toBe(true);
      expect(stopButton()?.disabled).toBe(true);
      expect(document.querySelector<HTMLButtonElement>('[aria-label="ssh.remote.upload"]')?.disabled).toBe(true);
      expect(document.querySelector<HTMLButtonElement>('.remote-file-browser__close-btn')?.disabled).toBe(false);
      await act(async () => {
        const failure = new Error('Transfer cancelled');
        if (action === 'upload') pendingUpload.reject(failure);
        else pendingDownload.reject(failure);
      });
      expect(stopButton()).toBeNull();
      expect(document.querySelector('.remote-file-browser__error')).toBeNull();
      expect(document.querySelector<HTMLButtonElement>('[aria-label="ssh.remote.upload"]')?.disabled).toBe(false);
    });
  });

  it('stops the current upload without starting the remaining selected files', async () => {
    useHost();
    selectPaths('["/storage/a.bin","/storage/b.bin"]');
    const pending = deferred<{ wasDirectory: boolean }>();
    api.uploadFromLocalPath.mockReturnValueOnce(pending.promise);
    await withBrowser(async () => {
      await transfer('upload');
      const firstId = api.uploadFromLocalPath.mock.calls[0][4];
      await act(async () => stopButton()!.click());
      // Even a native request that resolves successfully after stop must not
      // allow the next item in the batch to start.
      await act(async () => pending.resolve({ wasDirectory: false }));
      expect(api.uploadFromLocalPath).toHaveBeenCalledTimes(1);
      selectPaths('/storage/new.bin');
      await transfer('upload');
      expect(api.uploadFromLocalPath).toHaveBeenCalledTimes(2);
      expect(api.uploadFromLocalPath.mock.calls[1][4]).not.toBe(firstId);
      expect(api.uploadFromLocalPath.mock.calls[1][5]?.()).toBe(false);
    });
  });

  it('releases transfer controls without letting an older upload refresh replace the newest listing', async () => {
    useHost();
    selectPaths('/storage/new.bin');
    const refresh = deferred<Array<{ name: string; path: string; isDir: boolean }>>();
    await withBrowser(async (_onSelect, _unmount, onCancel) => {
      api.readDir.mockReturnValueOnce(refresh.promise);
      await transfer('upload');
      expect(api.readDir).toHaveBeenCalledTimes(2);
      expect(stopButton()).toBeNull();
      expect(document.querySelector<HTMLButtonElement>('[aria-label="ssh.remote.upload"]')?.disabled).toBe(false);
      const close = document.querySelector<HTMLButtonElement>('.remote-file-browser__close-btn')!;
      expect(close.disabled).toBe(false);
      api.readDir.mockResolvedValueOnce([
        { name: 'new.bin', path: '/srv/project/new.bin', isDir: false },
        { name: 'newer.bin', path: '/srv/project/newer.bin', isDir: false },
      ]);
      selectPaths('/storage/newer.bin');
      await transfer('upload');
      expect(api.readDir).toHaveBeenCalledTimes(3);
      expect(document.querySelector('.remote-file-browser__table')?.textContent).toContain('newer.bin');
      await act(async () => refresh.resolve([{ name: 'new.bin', path: '/srv/project/new.bin', isDir: false }]));
      expect(document.querySelector('.remote-file-browser__table')?.textContent).toContain('newer.bin');
      act(() => close.click());
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });

  it('shows cancellation failures and allows retry without losing the active download', async () => {
    useHost();
    selectPaths('/downloads');
    const pending = deferred<void>();
    api.downloadToLocalPath.mockReturnValueOnce(pending.promise);
    api.cancelTransfer.mockRejectedValueOnce(new Error('Cancel request failed'));
    await withBrowser(async () => {
      await transfer('download');
      await act(async () => stopButton()!.click());
      expect(document.querySelector('.remote-file-browser__error')?.textContent).toContain('Cancel request failed');
      expect(stopButton()?.disabled).toBe(false);
      expect(document.querySelector<HTMLButtonElement>('[aria-label="ssh.remote.upload"]')?.disabled).toBe(true);
      await act(async () => stopButton()!.click());
      expect(api.cancelTransfer).toHaveBeenCalledTimes(2);
      expect(api.cancelTransfer.mock.calls[1][0]).toBe(api.cancelTransfer.mock.calls[0][0]);
      expect(stopButton()?.disabled).toBe(true);
      await act(async () => pending.reject(new Error('SFTP channel failed')));
      expect(stopButton()).toBeNull();
      expect(document.querySelector('.remote-file-browser__error')?.textContent).toContain('SFTP channel failed');
    });
  });

  it.each([
    ['close button', 'not-requested'],
    ['footer cancel', 'pending'],
    ['Escape', 'acknowledged'],
  ] as const)('closes through %s while transfer cancellation is %s and stops the remaining uploads', async (exit, cancellation) => {
    useHost();
    selectPaths('["/storage/a.bin","/storage/b.bin"]');
    const pending = deferred<{ wasDirectory: boolean }>();
    const cancelRequest = deferred<void>();
    api.uploadFromLocalPath.mockReturnValueOnce(pending.promise);
    if (cancellation === 'pending') api.cancelTransfer.mockReturnValueOnce(cancelRequest.promise);
    await withBrowser(async (_onSelect, _unmount, onCancel) => {
      await transfer('upload');
      const first = api.uploadFromLocalPath.mock.calls[0];
      if (cancellation !== 'not-requested') {
        await act(async () => stopButton()!.click());
        expect(stopButton()?.disabled).toBe(true);
      }
      await act(async () => {
        if (exit === 'Escape') {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        } else {
          document.querySelector<HTMLButtonElement>(exit === 'close button'
            ? '.remote-file-browser__close-btn'
            : '.remote-file-browser__footer-actions button')!.click();
        }
      });
      expect(onCancel).toHaveBeenCalledOnce();
      expect(document.querySelector('.remote-file-browser')).toBeNull();
      expect(api.cancelTransfer).toHaveBeenCalledWith(first[4]);
      expect(first[5]?.()).toBe(true);
      await act(async () => {
        cancelRequest.resolve();
        pending.resolve({ wasDirectory: false });
      });
      expect(api.uploadFromLocalPath).toHaveBeenCalledTimes(1);
      expect(api.readDir).toHaveBeenCalledTimes(1);
    });
  });

  it.each(['picker', 'overwrite'] as const)('starts no transfer while waiting for %s or after the browser closes', async waitingFor => {
    useHost();
    const picker = deferred<string>();
    const overwrite = deferred<boolean>();
    if (waitingFor === 'picker') native.invoke.mockReturnValue(picker.promise);
    else {
      selectPaths('/downloads', true);
      native.confirm.mockReturnValue(overwrite.promise);
    }
    await withBrowser(async (_onSelect, unmount) => {
      await transfer('download');
      expect(api.downloadToLocalPath).not.toHaveBeenCalled();
      expect(stopButton()).toBeNull();
      expect(document.querySelector<HTMLButtonElement>('[aria-label="ssh.remote.upload"]')?.disabled).toBe(false);
      unmount();
      await act(async () => {
        if (waitingFor === 'picker') picker.resolve('/downloads');
        else overwrite.resolve(true);
      });
      expect(api.downloadToLocalPath).not.toHaveBeenCalled();
      expect(api.cancelTransfer).not.toHaveBeenCalled();
    });
  });

  it.each(['upload', 'download'] as const)('rejects %s before passing this device paths to a peer host', async action => {
    useHost();
    device.surfaceId = 'peer-device';
    await withBrowser(async () => {
      await transfer(action);
      expect(document.querySelector('.remote-file-browser__error')?.textContent).toContain('not supported on a peer host');
      expect(native.invoke).not.toHaveBeenCalled();
      expect(api.uploadFromLocalPath).not.toHaveBeenCalled();
      expect(api.downloadToLocalPath).not.toHaveBeenCalled();
    });
  });

  it('keeps browser-only uploads explicit about the missing native capability', async () => {
    useHost('browser');
    await withBrowser(async () => {
      await transfer('upload');
      expect(document.querySelector('.remote-file-browser__error')?.textContent).toContain('ssh.remote.transferNeedsDesktop');
      expect(native.invoke).not.toHaveBeenCalled();
    });
  });

  it('omits the inapplicable file Open action when choosing a workspace directory', async () => {
    await withBrowser(async onSelect => {
      fileContextMenu();
      expect([...document.querySelectorAll('[role="menuitem"]')].some(node => node.textContent === 'actions.open')).toBe(false);
      expect(onSelect).not.toHaveBeenCalled();
    }, true);
  });

  it('still opens a file when the browser allows file selection', async () => {
    await withBrowser(async onSelect => {
      fileContextMenu();
      const open = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent === 'actions.open')!;
      await act(async () => open.click());
      expect(onSelect).toHaveBeenCalledExactlyOnceWith('/srv/project/old.txt');
    });
  });
});

it('renames a remote file once and keeps IME and outside clicks from dismissing the dialog', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<RemoteFileBrowser connectionId="ssh-host" initialPath="/srv/project" onSelect={() => undefined} onCancel={() => undefined} />));
    const row = [...document.querySelectorAll<HTMLElement>('.remote-file-browser__row')].find(node => node.textContent?.includes('old.txt'))!;
    act(() => row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 80, clientY: 90 })));
    const rename = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent === 'ssh.remote.rename')!;
    await act(async () => rename.click());
    const dialog = document.querySelector<HTMLElement>('.remote-file-browser__dialog')!;
    expect(dialog.getAttribute('data-bitfun-component')).toBe('dialog');
    const input = dialog.querySelector('input')!;
    expect(input.value).toBe('old.txt');
    expect(document.activeElement).toBe(input);
    expect(dialog.querySelector(`label[for="${input.id}"]`)?.textContent).toContain('ssh.remote.name');
    act(() => {
      input.value = 'new.txt';
      Simulate.change(input);
      Simulate.compositionStart(input);
      Simulate.keyDown(input, { key: 'Escape' });
      Simulate.keyDown(input, { key: 'Enter' });
    });
    expect(dialog.isConnected).toBe(true);
    expect(api.rename).not.toHaveBeenCalled();
    act(() => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(dialog.isConnected).toBe(true);
    await act(async () => {
      Simulate.compositionEnd(input);
      Simulate.keyDown(input, { key: 'Enter' });
    });
    expect(api.rename).toHaveBeenCalledExactlyOnceWith('ssh-host', '/srv/project/old.txt', '/srv/project/new.txt');
    expect(dialog.isConnected).toBe(false);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

describe('remote directory link navigation', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const onSelect = vi.fn();
  const row = (name: string) => [...document.querySelectorAll<HTMLElement>('.remote-file-browser__row')]
    .find(node => node.querySelector('.remote-file-browser__name')?.textContent === name)!;
  const openButton = () => [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(node => node.textContent === 'ssh.remote.openWorkspace')!;
  const currentPath = () => document.querySelector('.remote-file-browser__footer-hint')?.textContent;
  const render = async (connectionId = 'ssh-host', initialPath = '/srv/project') => {
    await act(async () => root.render(
      <RemoteFileBrowser connectionId={connectionId} initialPath={initialPath} selectDirectoriesOnly onSelect={onSelect} onCancel={() => undefined} />,
    ));
  };

  beforeEach(() => {
    onSelect.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('names the modal and exposes directory navigation to the keyboard', async () => {
    api.readDir.mockResolvedValueOnce([fileEntry, linkEntry]).mockResolvedValueOnce([]);
    await render();
    const dialog = document.querySelector<HTMLElement>('.remote-file-browser[role="dialog"]')!;
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('ssh.remote.selectWorkspace');
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.remote-file-browser__entry-button')];
    expect(buttons).toHaveLength(3);
    act(() => buttons[0].focus());
    act(() => buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(document.activeElement).toBe(buttons[1]);
    act(() => buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    expect(document.activeElement).toBe(buttons.at(-1));
    act(() => buttons.at(-1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(document.activeElement).toBe(buttons[0]);
    await act(async () => buttons[1].click());
    expect(api.readDir).toHaveBeenLastCalledWith('ssh-host', linkEntry.path);
    expect(api.readDir).toHaveBeenCalledTimes(2);
  });

  it('opens entry actions with Shift+F10 within the owning modal', async () => {
    await render();
    const file = row(fileEntry.name).querySelector<HTMLButtonElement>('.remote-file-browser__entry-button')!;
    act(() => file.focus());
    await act(async () => file.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true })));
    const rename = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === 'ssh.remote.rename')!;
    expect(rename).toBeDefined();
    await act(async () => rename.click());
    const input = document.querySelector<HTMLInputElement>('.remote-file-browser__dialog input')!;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe(fileEntry.name);
  });

  it('provides a keyboard-focusable path editor with an accessible name', async () => {
    await render();
    const edit = document.querySelector<HTMLButtonElement>('button[aria-label="ssh.remote.clickToEditPath"]')!;
    act(() => edit.focus());
    expect(document.activeElement).toBe(edit);
    await act(async () => edit.click());
    expect(document.querySelector<HTMLInputElement>('input[aria-label="peerDirectoryPicker.path"]')?.value).toBe('/srv/project');
  });

  it.each(['click', 'double click', 'context menu'])('opens a directory symlink through %s and preserves its POSIX path', async (action) => {
    api.readDir.mockResolvedValueOnce([fileEntry, linkEntry]).mockResolvedValueOnce([]);
    await render();
    expect(row(linkEntry.name).querySelector('.remote-file-browser__entry-icon--link')).not.toBeNull();
    await act(async () => {
      if (action === 'click') row(linkEntry.name).click();
      else if (action === 'double click') Simulate.doubleClick(row(linkEntry.name));
      else row(linkEntry.name).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    if (action === 'context menu') {
      const open = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find(node => node.textContent === 'actions.open')!;
      await act(async () => open.click());
    }
    expect(api.readDir).toHaveBeenNthCalledWith(2, 'ssh-host', linkEntry.path);
    expect(api.readDir).toHaveBeenCalledTimes(2);
    expect(currentPath()).toBe(linkEntry.path);
    expect(openButton().disabled).toBe(false);
    act(() => openButton().click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(linkEntry.path);

    await act(async () => row('..').click());
    expect(api.readDir).toHaveBeenLastCalledWith('ssh-host', '/srv/project');
    expect(currentPath()).toBe('/srv/project');
  });

  it.each([
    ['file link', new Error('Not a directory')],
    ['broken link', 'No such file'],
    ['inaccessible link', new Error('Permission denied')],
    ['cyclic link', new Error('Too many levels of symbolic links')],
  ])('keeps the parent listing and error for a %s, and retries the same remote path', async (_kind, error) => {
    api.readDir.mockResolvedValueOnce([linkEntry]).mockRejectedValueOnce(error).mockRejectedValueOnce(error);
    await render();
    await act(async () => row(linkEntry.name).click());
    expect(openButton().disabled).toBe(true);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(currentPath()).toBe('/srv/project');
    expect(row(linkEntry.name)).toBeDefined();
    expect(document.querySelector('.remote-file-browser__error')?.textContent)
      .toContain(error instanceof Error ? error.message : error);
    expect(document.querySelector('.remote-file-browser__empty')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();

    api.readDir.mockResolvedValueOnce([]);
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="actions.retry"]')!.click());
    expect(api.readDir).toHaveBeenLastCalledWith('ssh-host', linkEntry.path);
    expect(currentPath()).toBe(linkEntry.path);
  });

  it('does not select an unvalidated initial directory or call a failed load empty', async () => {
    api.readDir.mockRejectedValue('Permission denied');
    await render();
    expect(openButton().disabled).toBe(true);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(openButton().disabled).toBe(true);
    expect(document.querySelector('.remote-file-browser__empty')).toBeNull();
    act(() => openButton().click());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores a late link response after navigating home', async () => {
    let resolveLink!: (entries: RemoteFileEntry[]) => void;
    api.readDir.mockResolvedValueOnce([linkEntry])
      .mockImplementationOnce(() => new Promise(resolve => { resolveLink = resolve; }))
      .mockResolvedValueOnce([fileEntry]);
    await render();
    await act(async () => row(linkEntry.name).click());
    expect(openButton().disabled).toBe(true);
    act(() => openButton().click());
    expect(onSelect).not.toHaveBeenCalled();
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="ssh.remote.homeFolder"]')!.click());
    await act(async () => resolveLink([]));
    expect(currentPath()).toBe('/srv/project');
    expect(row(fileEntry.name)).toBeDefined();
    act(() => openButton().click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('/srv/project');
  });

  it('discards an old connection response when the host changes', async () => {
    let resolveLink!: (entries: RemoteFileEntry[]) => void;
    api.readDir.mockResolvedValueOnce([linkEntry])
      .mockImplementationOnce(() => new Promise(resolve => { resolveLink = resolve; }))
      .mockResolvedValueOnce([fileEntry]);
    await render();
    await act(async () => row(linkEntry.name).click());
    await render('other-host');
    await act(async () => resolveLink([]));
    expect(api.readDir).toHaveBeenLastCalledWith('other-host', '/srv/project');
    expect(currentPath()).toBe('/srv/project');
    expect(row(fileEntry.name)).toBeDefined();
  });
});

describe('SSH directory error presentation', () => {
  it.each([
    ['SFTP status: 3 (permission denied)', 'SFTP status: 3 (permission denied)'],
    ['Failed to list directory: unexpected SFTP response', 'Failed to list directory: unexpected SFTP response'],
  ])('preserves an unknown dependency message %s without a category fallback', async (raw, expected) => {
    api.readDir.mockReset().mockRejectedValue(raw);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<RemoteFileBrowser connectionId="ssh-test" initialPath="/restricted" onSelect={vi.fn()} onCancel={vi.fn()} />));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
      expect(document.body.textContent).toContain(expected);

      expect(api.readDir).toHaveBeenCalledWith('ssh-test', '/restricted');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
