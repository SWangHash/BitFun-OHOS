import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHtmlFilePath, openHtmlFileInExternalBrowser } from './htmlFilePreview';

const createMock = vi.hoisted(() => vi.fn());
const openExternalMock = vi.hoisted(() => vi.fn());
const peerDeviceModeMock = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/api/htmlPreviewApi', () => ({
  htmlPreviewApi: { create: createMock },
}));
vi.mock('@/infrastructure/api/service-api/SystemAPI', () => ({
  systemAPI: { openExternal: openExternalMock },
}));
vi.mock('@/infrastructure/peer-device/peerModeFlag', () => ({
  isPeerDeviceModeActive: peerDeviceModeMock,
}));

describe('htmlFilePreview', () => {
  beforeEach(() => {
    createMock.mockReset();
    openExternalMock.mockReset();
    peerDeviceModeMock.mockReset().mockReturnValue(false);
    createMock.mockResolvedValue({ url: 'http://127.0.0.1:52100/preview', sessionId: 'preview-1' });
    openExternalMock.mockResolvedValue(undefined);
  });

  it('detects html and htm files case-insensitively', () => {
    expect(isHtmlFilePath('index.html')).toBe(true);
    expect(isHtmlFilePath('REPORT.HTM')).toBe(true);
    expect(isHtmlFilePath('index.tsx')).toBe(false);
    expect(isHtmlFilePath('html-notes.md')).toBe(false);
  });

  it('serves the html file through the preview gateway and opens its url in the system browser', async () => {
    const path = 'E:\\Projects\\Demo App\\index #1.html';

    await openHtmlFileInExternalBrowser(path, { workspaceId: 'w1', workspacePath: 'E:\\Projects\\Demo App' });

    expect(createMock).toHaveBeenCalledWith({
      filePath: path,
      workspaceId: 'w1',
      workspacePath: 'E:\\Projects\\Demo App',
      peerDeviceMode: false,
    });
    expect(openExternalMock).toHaveBeenCalledWith('http://127.0.0.1:52100/preview');
  });

  it('forwards peer device mode from the peer-mode flag', async () => {
    peerDeviceModeMock.mockReturnValue(true);

    await openHtmlFileInExternalBrowser('/repo/index.html');

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ peerDeviceMode: true }));
  });
});
