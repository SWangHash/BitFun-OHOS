import { describe, expect, it, vi } from 'vitest';
import { htmlPreviewApi } from './htmlPreviewApi';
const invoke = vi.hoisted(() => vi.fn(async () => ({ sessionId: 'preview-1', url: 'http://localhost/preview' })));
vi.mock('./service-api/ApiClient', () => ({ api: { invoke } }));
describe('HTML preview workspace identity', () => {
  it('sends the saved workspace ID alongside the file IO operand', async () => {
    const request = { workspaceId: 'remote-id', filePath: '/repo/index.html', peerDeviceMode: false };
    await htmlPreviewApi.create(request);
    expect(invoke).toHaveBeenCalledWith('html_preview_create', { request });
  });
  it('rejects a missing workspace identity before invoking the host', async () => {
    invoke.mockClear();
    await expect(htmlPreviewApi.create({ workspaceId: '', filePath: '/repo/index.html', peerDeviceMode: false })).rejects.toThrow('workspace id or path');
    expect(invoke).not.toHaveBeenCalled();
  });
  it('accepts a legacy workspace path as the workspace identity', async () => {
    invoke.mockClear();
    await htmlPreviewApi.create({ filePath: '/repo/index.html', workspacePath: '/repo', peerDeviceMode: false });
    expect(invoke).toHaveBeenCalledWith('html_preview_create', {
      request: expect.objectContaining({ workspacePath: '/repo' }),
    });
  });
});
