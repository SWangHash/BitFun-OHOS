/**
 * Global safety net for local file links (issue #376).
 *
 * A relative-anchor click that reaches the browser default navigates the whole
 * webview away from the app (the user sees the app "restart"). Every known
 * markdown surface intercepts links itself, but any future surface that leaks
 * a live `<a href="README.zh-CN.md">` used to take the whole app down with it.
 * The capture-phase guard below closes that hole: local path hrefs are
 * preventDefault-ed and routed through openFileInBestTarget, while web, mail,
 * fragment, and in-app scheme links keep their existing handlers.
 */

import { openFileInBestTarget } from '@/shared/utils/tabUtils';
import { globalAPI } from '@/infrastructure/api';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('LocalLinkGuard');

const INERT_HREF_PATTERN = /^(https?:|mailto:|tel:|data:|blob:|javascript:|#)/i;
const APP_SCHEME_PATTERN = /^(bitfun:|tab:|visualization:|computer:|bitfun-canvas:)/i;

export function isLocalFileLinkHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || INERT_HREF_PATTERN.test(trimmed) || APP_SCHEME_PATTERN.test(trimmed)) {
    return false;
  }
  return true;
}

/** file:///C:/repo/x.md → C:/repo/x.md; file:///home/u/x.md → /home/u/x.md. */
function filePathFromFileUri(uri: string): string {
  const withoutScheme = uri.slice('file://'.length);
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex === -1) {
    return decodeURIComponent(withoutScheme);
  }
  const host = withoutScheme.slice(0, slashIndex);
  const pathPart = withoutScheme.slice(slashIndex);
  if (host && !host.toLowerCase().startsWith('localhost')) {
    return decodeURIComponent(withoutScheme);
  }
  return decodeURIComponent(pathPart);
}

async function openLocalLink(href: string): Promise<void> {
  const trimmed = href.trim();
  let filePath: string;
  if (trimmed.startsWith('file://')) {
    filePath = filePathFromFileUri(trimmed);
  } else if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\\\')) {
    filePath = trimmed;
  } else {
    let workspacePath: string | undefined;
    try {
      workspacePath = await globalAPI.getCurrentWorkspacePath();
    } catch (error) {
      log.warn('Failed to resolve workspace for local link', { href, error: String(error) });
    }
    if (workspacePath) {
      const base = workspacePath.replace(/\/+$/, '');
      filePath = `${base}/${trimmed.replace(/^\.\//, '')}`;
    } else {
      filePath = trimmed;
    }
  }

  openFileInBestTarget({ filePath });
}

/**
 * Surfaces that render real `<a>` elements AND resolve their own local links.
 * The rich markdown editor anchors relative hrefs on the CURRENT FILE's
 * directory (issue #460). This guard runs in the capture phase, before any
 * surface handler, so resolving a raw href against the workspace root here
 * opened wrong targets for every document outside the workspace root and
 * re-anchored home-page clicks on whatever workspace happened to be active.
 * Their anchors are skipped; the editor's own handler still prevents the
 * browser default, so the webview cannot navigate away.
 */
const SELF_HANDLING_LINK_SURFACE = '.ProseMirror, [data-bitfun-component="tiptap-editor"]';

function handleDocumentClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0) {
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  const anchor = target?.closest('a');
  if (!anchor) {
    return;
  }
  const href = anchor.getAttribute('href');
  if (!href || !isLocalFileLinkHref(href)) {
    return;
  }
  if (anchor.closest(SELF_HANDLING_LINK_SURFACE)) {
    return;
  }
  event.preventDefault();
  void openLocalLink(href);
}

let installed = false;

export function installLocalLinkGuard(): () => void {
  if (installed || typeof document === 'undefined') {
    return () => undefined;
  }
  installed = true;
  document.addEventListener('click', handleDocumentClick, true);
  return () => {
    document.removeEventListener('click', handleDocumentClick, true);
    installed = false;
  };
}
