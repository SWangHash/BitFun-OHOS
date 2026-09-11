import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceAPI } from './WorkspaceAPI';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn(() => vi.fn()));
const waitForListenerRegistrationsMock = vi.hoisted(() => vi.fn());
const streamCapabilityMock = vi.hoisted(() => ({ supported: false }));
const dialogOpenMock = vi.hoisted(() => vi.fn());

vi.mock('./ApiClient', () => ({
  api: {
    invoke: invokeMock,
    listen: listenMock,
    waitForListenerRegistrations: waitForListenerRegistrationsMock,
    getAdapter: () => ({
      supportsSearchStreamEvents: () => streamCapabilityMock.supported,
    }),
  },
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: dialogOpenMock,
}));

describe('WorkspaceAPI', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue('file content');
    listenMock.mockReset();
    listenMock.mockImplementation(() => vi.fn());
    waitForListenerRegistrationsMock.mockReset();
    waitForListenerRegistrationsMock.mockResolvedValue(undefined);
    streamCapabilityMock.supported = false;
    dialogOpenMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('reads text through the registered command with remote routing context', async () => {
    await workspaceAPI.readFileContent(
      '/workspace/src/new.ts',
      undefined,
      'remote-connection-1',
    );

    expect(invokeMock).toHaveBeenCalledWith('read_file_content', {
      request: {
        filePath: '/workspace/src/new.ts',
        encoding: undefined,
        remoteConnectionId: 'remote-connection-1',
      },
    });
  });

  it('writes text through the registered command with remote routing context', async () => {
    await workspaceAPI.writeFileContent(
      '/workspace',
      '/workspace/.openbitfun/plans/refactor.plan.md',
      '# Plan',
      'remote-connection-1',
    );

    expect(invokeMock).toHaveBeenCalledWith('write_file_content', {
      request: {
        workspacePath: '/workspace',
        filePath: '/workspace/.openbitfun/plans/refactor.plan.md',
        content: '# Plan',
        remoteConnectionId: 'remote-connection-1',
      },
    });
  });

  it('browses the resource tree through the explicit remote workspace scope', async () => {
    invokeMock.mockResolvedValue([]);
    await workspaceAPI.explorerGetChildren('/workspace', 'remote-connection-2');
    expect(invokeMock).toHaveBeenCalledWith('explorer_get_children', {
      request: { path: '/workspace', remoteConnectionId: 'remote-connection-2' },
    });
  });

  it('browses a directory through the explicit remote workspace scope', async () => {
    invokeMock.mockResolvedValueOnce([]);

    await workspaceAPI.getDirectoryChildren('/workspace', 'remote-connection-1');

    expect(invokeMock).toHaveBeenCalledWith('get_directory_children', {
      request: {
        path: '/workspace',
        remoteConnectionId: 'remote-connection-1',
      },
    });
  });

  it('searches filenames through the same explicit remote workspace scope', async () => {
    invokeMock.mockResolvedValueOnce({ results: [], limit: 30, truncated: false });

    await workspaceAPI.searchFilenamesOnlyDetailed(
      '/workspace',
      '手写',
      false,
      false,
      false,
      undefined,
      30,
      true,
      undefined,
      'remote-connection-1',
    );

    expect(invokeMock).toHaveBeenCalledWith('search_filenames', {
      request: expect.objectContaining({
        rootPath: '/workspace',
        pattern: '手写',
        maxResults: 30,
        includeDirectories: true,
        remoteConnectionId: 'remote-connection-1',
      }),
    });
  });

  it('uses response-based filename search when transport events are unavailable', async () => {
    invokeMock.mockResolvedValueOnce({
      results: [{
        path: '/workspace/手写笔画标注项目',
        name: '手写笔画标注项目',
        isDirectory: true,
        matchType: 'fileName',
      }],
      limit: 30,
      truncated: false,
    });
    const onProgress = vi.fn();

    await workspaceAPI.searchFilenamesOnlyStreamDetailed(
      '/workspace',
      '手写',
      false,
      false,
      false,
      undefined,
      30,
      true,
      { onProgress },
      undefined,
      'remote-connection-1',
    );

    expect(invokeMock).toHaveBeenCalledWith('search_filenames', {
      request: expect.objectContaining({
        remoteConnectionId: 'remote-connection-1',
      }),
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      'start_search_filenames_stream',
      expect.anything(),
    );
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      results: [expect.objectContaining({ name: '手写笔画标注项目' })],
    }));
  });

  it('starts scoped streaming only after transport listeners are registered', async () => {
    streamCapabilityMock.supported = true;
    const listeners = new Map<string, (event: any) => void>();
    listenMock.mockImplementation((event: string, callback: (payload: any) => void) => {
      listeners.set(event, callback);
      return vi.fn();
    });
    invokeMock.mockImplementationOnce(async (command: string, args: {
      request: { searchId: string };
    }) => {
      expect(command).toBe('start_search_filenames_stream');
      listeners.get('file-search://progress')?.({
        searchId: args.request.searchId,
        searchKind: 'filenames',
        results: [],
      });
      listeners.get('file-search://complete')?.({
        searchId: args.request.searchId,
        searchKind: 'filenames',
        limit: 30,
        truncated: false,
        totalResults: 0,
      });
      return { searchId: args.request.searchId, limit: 30 };
    });

    await workspaceAPI.searchFilenamesOnlyStreamDetailed(
      '/workspace',
      '手写',
      false,
      false,
      false,
      undefined,
      30,
      true,
      {},
      undefined,
      'remote-connection-1',
    );

    expect(invokeMock).toHaveBeenCalledWith('start_search_filenames_stream', {
      request: expect.objectContaining({
        rootPath: '/workspace',
        remoteConnectionId: 'remote-connection-1',
      }),
    });
    expect(waitForListenerRegistrationsMock).toHaveBeenCalledOnce();
  });

  it('does not start an orphaned stream when aborted during listener registration', async () => {
    streamCapabilityMock.supported = true;
    let finishListenerRegistration: (() => void) | undefined;
    waitForListenerRegistrationsMock.mockReturnValueOnce(new Promise<void>(resolve => {
      finishListenerRegistration = resolve;
    }));
    const controller = new AbortController();

    const search = workspaceAPI.searchFilenamesOnlyStreamDetailed(
      '/workspace',
      '手写',
      false,
      false,
      false,
      undefined,
      30,
      true,
      {},
      controller.signal,
      'remote-connection-1',
    );
    await vi.waitFor(() => {
      expect(waitForListenerRegistrationsMock).toHaveBeenCalledOnce();
    });

    controller.abort();
    finishListenerRegistration?.();

    await expect(search).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    expect(invokeMock.mock.calls.some(([command]) => (
      command === 'start_search_filenames_stream'
    ))).toBe(false);
  });

  it('resolves browser-dropped file paths through a structured host request', async () => {
    invokeMock.mockResolvedValueOnce(['C:\\drop\\report.pdf']);

    await expect(workspaceAPI.resolveBrowserDroppedFilePaths('drop-token', 1)).resolves.toEqual([
      'C:\\drop\\report.pdf',
    ]);
    expect(invokeMock).toHaveBeenCalledWith('resolve_browser_dropped_file_paths', {
      request: {
        token: 'drop-token',
        fileCount: 1,
      },
    });
  });

  describe('openFileOrDirectoryDialog platform dispatch', () => {
    type TauriInternals = { invoke?: unknown; metadata?: { currentWindow?: { label?: string } } };
    const stubTauri = () => {
      (globalThis as { window?: unknown }).window = {
        __TAURI_INTERNALS__: {
          invoke: vi.fn(),
          metadata: { currentWindow: { label: 'main' } },
        } satisfies TauriInternals,
      };
    };
    const stubNavigator = (platform: string, userAgent: string) => {
      vi.stubGlobal('navigator', { platform, userAgent });
    };

    it('routes the Windows desktop runtime to the native plugin-dialog and never to the OHOS command', async () => {
      stubTauri();
      stubNavigator('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
      dialogOpenMock.mockResolvedValueOnce('C:\\dev\\project');

      await expect(
        workspaceAPI.openFileOrDirectoryDialog({ directory: true, multiple: false }),
      ).resolves.toBe('C:\\dev\\project');

      expect(dialogOpenMock).toHaveBeenCalledOnce();
      expect(dialogOpenMock).toHaveBeenCalledWith({
        directory: true,
        multiple: false,
        title: undefined,
        defaultPath: undefined,
        filters: undefined,
      });
      expect(invokeMock.mock.calls.some(([command]) => command === 'open_oh_file_dialog')).toBe(
        false,
      );
    });

    it('routes the macOS desktop runtime to the native plugin-dialog as well', async () => {
      stubTauri();
      stubNavigator('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
      dialogOpenMock.mockResolvedValueOnce('/Users/dev/project');

      await expect(
        workspaceAPI.openFileOrDirectoryDialog({ directory: true }),
      ).resolves.toBe('/Users/dev/project');

      expect(dialogOpenMock).toHaveBeenCalledOnce();
      expect(invokeMock.mock.calls.some(([command]) => command === 'open_oh_file_dialog')).toBe(
        false,
      );
    });

    it('routes the OpenHarmony runtime to the open_oh_file_dialog command and decodes its envelope', async () => {
      stubTauri();
      stubNavigator('OpenHarmony', 'Mozilla/5.0 (OpenHarmony) AppleWebKit/537.36');
      // Multi-select comes back as a JSON array string through the ArkTS bridge.
      invokeMock.mockResolvedValueOnce('["/data/storage/a","/data/storage/b"]');

      await expect(
        workspaceAPI.openFileOrDirectoryDialog({ multiple: true, directory: false }),
      ).resolves.toEqual(['/data/storage/a', '/data/storage/b']);

      expect(dialogOpenMock).not.toHaveBeenCalled();
      expect(invokeMock).toHaveBeenCalledWith('open_oh_file_dialog', {
        options: JSON.stringify({ multiple: true, directory: false }),
      });
    });

    it('maps the OHOS cancel envelope ("null") to null', async () => {
      stubTauri();
      stubNavigator('OpenHarmony', 'Mozilla/5.0 (OpenHarmony)');

      // The Rust bridge encodes "user cancelled" (an empty paths array) as the
      // JSON string "null"; see parse_picker_result in register_arkts_function.rs.
      invokeMock.mockResolvedValueOnce('null');
      await expect(workspaceAPI.openFileOrDirectoryDialog()).resolves.toBeNull();
    });

    it('keeps the legacy oh-named alias routed through the same dispatch', async () => {
      stubTauri();
      stubNavigator('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
      dialogOpenMock.mockResolvedValueOnce('C:\\dev\\skill-folder');

      await expect(
        workspaceAPI.open_oh_file_dialog({ directory: true, multiple: false }),
      ).resolves.toBe('C:\\dev\\skill-folder');

      expect(dialogOpenMock).toHaveBeenCalledOnce();
      expect(invokeMock.mock.calls.some(([command]) => command === 'open_oh_file_dialog')).toBe(
        false,
      );
    });

    it('rejects loudly in a plain browser runtime instead of invoking a host command', async () => {
      (globalThis as { window?: unknown }).window = {};
      stubNavigator('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');

      await expect(workspaceAPI.openFileOrDirectoryDialog({ directory: true })).rejects.toThrow(
        /no native file dialog/i,
      );
      expect(dialogOpenMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });
  });

  describe('startWindowDragging platform dispatch', () => {
    type TauriInternals = { invoke?: unknown; metadata?: { currentWindow?: { label?: string } } };
    const stubTauri = () => {
      (globalThis as { window?: unknown }).window = {
        __TAURI_INTERNALS__: {
          invoke: vi.fn(),
          metadata: { currentWindow: { label: 'main' } },
        } satisfies TauriInternals,
      };
    };
    const stubNavigator = (platform: string, userAgent: string) => {
      vi.stubGlobal('navigator', { platform, userAgent });
    };

    it('routes the OpenHarmony runtime to window_start_dragging instead of the unsupported tao drag_window', async () => {
      stubTauri();
      stubNavigator('OpenHarmony', 'Mozilla/5.0 (OpenHarmony) AppleWebKit/537.36');

      await expect(workspaceAPI.startWindowDragging()).resolves.toBeUndefined();

      expect(invokeMock).toHaveBeenCalledWith('window_start_dragging');
    });

    it('keeps desktop runtimes on the native Tauri startDragging path', async () => {
      stubTauri();
      stubNavigator('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
      const startDragging = vi.fn().mockResolvedValue(undefined);
      vi.doMock('@tauri-apps/api/window', () => ({
        getCurrentWindow: () => ({ startDragging }),
      }));
      const { workspaceAPI: freshApi } = await import('./WorkspaceAPI');

      await expect(freshApi.startWindowDragging()).resolves.toBeUndefined();

      expect(startDragging).toHaveBeenCalledOnce();
      expect(invokeMock).not.toHaveBeenCalledWith('window_start_dragging');
      vi.doUnmock('@tauri-apps/api/window');
    });
  });
});
