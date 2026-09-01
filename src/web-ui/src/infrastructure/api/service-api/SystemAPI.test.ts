import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemAPI } from './SystemAPI';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('./ApiClient', () => ({
  api: {
    invoke: invokeMock,
  },
}));

describe('SystemAPI', () => {
  let systemAPI: SystemAPI;

  beforeEach(() => {
    systemAPI = new SystemAPI();
    invokeMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not invoke the updater in development mode', async () => {
    vi.stubEnv('DEV', true);

    await expect(systemAPI.checkForUpdates()).rejects.toThrow(
      'Update checks are disabled in development mode',
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('invokes the updater outside development mode', async () => {
    vi.stubEnv('DEV', false);
    const response = {
      updateAvailable: false,
      currentVersion: '1.0.0',
      latestVersion: null,
      releaseNotes: null,
      releaseDate: null,
    };
    invokeMock.mockResolvedValueOnce(response);

    await expect(systemAPI.checkForUpdates()).resolves.toEqual(response);
    expect(invokeMock).toHaveBeenCalledWith('check_for_updates', {
      request: {},
    });
  });

  it('reads the persisted desktop preference', async () => {
    invokeMock.mockResolvedValueOnce(false);

    await expect(systemAPI.getPreventSleepEnabled()).resolves.toBe(false);
    expect(invokeMock).toHaveBeenCalledWith('get_prevent_sleep_enabled', {
      request: {},
    });
  });

  it('sends the requested app-wide state', async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await expect(systemAPI.setPreventSleepEnabled(true)).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith('set_prevent_sleep_enabled', {
      request: { enabled: true },
    });
  });
  it('passes the complete text payload to the controller-local save command', async () => {
    const request = {
      title: 'Export review report',
      defaultFileName: 'review.md',
      content: '# Review\n\n- 完整内容',
      filterName: 'Markdown',
      extensions: ['md'],
    };
    invokeMock.mockResolvedValueOnce({
      status: 'saved',
      filePath: '/tmp/review.md',
    });

    await expect(systemAPI.saveTextFileWithDialog(request)).resolves.toEqual({
      status: 'saved',
      filePath: '/tmp/review.md',
    });
    expect(invokeMock).toHaveBeenCalledWith('save_text_file_dialog', { request });
  });

  it('preserves a cancelled save outcome', async () => {
    const request = {
      title: 'Export review report',
      defaultFileName: 'review.md',
      content: '# Review',
      filterName: 'Markdown',
      extensions: ['md'],
    };
    invokeMock.mockResolvedValueOnce({ status: 'cancelled' });

    await expect(systemAPI.saveTextFileWithDialog(request)).resolves.toEqual({
      status: 'cancelled',
    });
  });
});
