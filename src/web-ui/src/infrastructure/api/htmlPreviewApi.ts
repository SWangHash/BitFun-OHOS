import { api } from './service-api/ApiClient';

export interface HtmlPreviewCreateRequest {
  filePath: string;
  /** Preferred: the workspace record id. Either workspaceId or workspacePath is required. */
  workspaceId?: string;
  /** Legacy path-based workspace reference, used when no workspace id is available. */
  workspacePath?: string;
  peerDeviceMode: boolean;
}

export interface HtmlPreviewCreateResponse {
  url: string;
  sessionId: string;
}

export const htmlPreviewApi = {
  create(request: HtmlPreviewCreateRequest): Promise<HtmlPreviewCreateResponse> {
    if (!request.workspaceId && !request.workspacePath) {
      return Promise.reject(new Error('HTML preview requires a workspace id or path'));
    }
    return api.invoke('html_preview_create', { request });
  },
  release(sessionId: string): Promise<void> {
    return api.invoke('html_preview_release', { request: { sessionId } });
  },
};
