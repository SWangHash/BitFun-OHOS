const HTML_FILE_RE = /\.(?:html|htm)$/i;

export function isHtmlFilePath(pathOrName: string | null | undefined): boolean {
  if (!pathOrName) {
    return false;
  }

  return HTML_FILE_RE.test(pathOrName.trim());
}

export interface HtmlExternalBrowserScope {
  workspaceId?: string;
  workspacePath?: string;
}

/**
 * Serve the HTML file through the local preview gateway and open the resulting
 * http URL in the system browser. Opening the raw file path (file://) launches
 * the browser but fails to render the page (blank tab).
 *
 * Lazy imports avoid a static dependency cycle with the infrastructure layer.
 */
export async function openHtmlFileInExternalBrowser(
  path: string,
  scope?: HtmlExternalBrowserScope,
): Promise<void> {
  const { htmlPreviewApi } = await import('@/infrastructure/api/htmlPreviewApi');
  const { isPeerDeviceModeActive } = await import('@/infrastructure/peer-device/peerModeFlag');
  const { systemAPI } = await import('@/infrastructure/api/service-api/SystemAPI');

  const { url } = await htmlPreviewApi.create({
    filePath: path,
    workspaceId: scope?.workspaceId,
    workspacePath: scope?.workspacePath,
    peerDeviceMode: isPeerDeviceModeActive(),
  });

  await systemAPI.openExternal(url);
}
