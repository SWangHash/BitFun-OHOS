import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveTextFileWithDialog } from './saveTextFileWithDialog';

const isTauriRuntimeMock = vi.hoisted(() => vi.fn());
const downloadTextFileInBrowserMock = vi.hoisted(() => vi.fn());
const saveTextFileWithDialogMock = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/runtime/environment', () => ({
  isTauriRuntime: () => isTauriRuntimeMock(),
}));

vi.mock('@/shared/utils/browserDownload', () => ({
  downloadTextFileInBrowser: (...args: unknown[]) => downloadTextFileInBrowserMock(...args),
}));

vi.mock('@/infrastructure/api/service-api/SystemAPI', () => ({
  systemAPI: {
    saveTextFileWithDialog: (...args: unknown[]) => saveTextFileWithDialogMock(...args),
  },
}));

const options = {
  title: 'Export review report',
  defaultFileName: 'review.md',
  content: '# Review\n\n- complete finding\n- 完整内容',
  mimeType: 'text/markdown;charset=utf-8',
  filter: { name: 'Markdown', extensions: ['md'] },
};

describe('saveTextFileWithDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps browser exports in the browser download boundary', async () => {
    isTauriRuntimeMock.mockReturnValue(false);

    await expect(saveTextFileWithDialog(options)).resolves.toEqual({
      status: 'saved',
      filePath: 'review.md',
    });
    expect(downloadTextFileInBrowserMock).toHaveBeenCalledWith(
      options.defaultFileName,
      options.content,
      options.mimeType,
    );
    expect(saveTextFileWithDialogMock).not.toHaveBeenCalled();
  });

  it('routes desktop exports through the controller-local host capability', async () => {
    isTauriRuntimeMock.mockReturnValue(true);
    saveTextFileWithDialogMock.mockResolvedValue({ status: 'cancelled' });

    await expect(saveTextFileWithDialog(options)).resolves.toEqual({ status: 'cancelled' });
    expect(saveTextFileWithDialogMock).toHaveBeenCalledWith({
      title: options.title,
      defaultFileName: options.defaultFileName,
      content: options.content,
      filterName: options.filter.name,
      extensions: options.filter.extensions,
    });
    expect(downloadTextFileInBrowserMock).not.toHaveBeenCalled();
  });
});
