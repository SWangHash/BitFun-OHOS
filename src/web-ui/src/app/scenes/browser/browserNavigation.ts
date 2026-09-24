export const BROWSER_NAVIGATION_EVENT = 'bitfun-browser-navigate';

let pendingBrowserUrl: string | null = null;

/**
 * Queue a URL for the built-in browser and notify an already-mounted browser
 * scene. Keeping one pending URL also covers navigation requested just before
 * the browser scene finishes mounting.
 */
export function requestBrowserNavigation(url: string): void {
  pendingBrowserUrl = url;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BROWSER_NAVIGATION_EVENT, {
      detail: { url },
    }));
  }
}

export function consumePendingBrowserNavigation(): string | null {
  const url = pendingBrowserUrl;
  pendingBrowserUrl = null;
  return url;
}
