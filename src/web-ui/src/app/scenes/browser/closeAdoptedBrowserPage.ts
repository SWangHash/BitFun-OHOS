import type { PanelContent } from '@/shared/types/panelContent';
import { getActiveSurfaceId, getActiveSurfaceScope } from '@/infrastructure/peer-device/deviceSurface';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('BrowserPageLifecycle');
let apiModule: Promise<typeof import('@/infrastructure/api/service-api/ApiClient')> | undefined;

/** Explicit resource/tab removal owns native close; presentation unmount only hides. */
export function closeAdoptedBrowserPage(content: PanelContent, surfaceId = content.metadata?.resourceScope?.surfaceId ?? getActiveSurfaceId()): void {
  if (content.type !== 'browser' || content.data?.adoptExisting !== true) return;
  const label = content.data.webviewLabel;
  if (typeof label !== 'string' || !label) return;
  // Never use a label from an inactive peer on the controller or another host.
  if (surfaceId !== getActiveSurfaceId()) {
    log.warn('Cannot close a browser page on an inactive device surface', { label, surfaceId });
    return;
  }
  const scope = getActiveSurfaceScope();
  void (apiModule ??= import('@/infrastructure/api/service-api/ApiClient')).then(({ api }) => {
    if (!scope.isCurrent()) return;
    return api.invoke('browser_webview_close', { request: { label } });
  }).catch(error => log.warn('Close adopted browser page failed', { label, error }));
}

/** Reopening an explicitly closed page creates a new page, not a dead native handle. */
export function closedBrowserContent(content: PanelContent): PanelContent {
  if (content.type !== 'browser' || content.data?.adoptExisting !== true) return content;
  const { webviewLabel: _label, automationId: _automation, adoptExisting: _adopt, openRequestId: _request, ...data } = content.data;
  return { ...content, data };
}
