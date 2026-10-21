const DEFAULT_BROWSER_TAB_TITLE = 'Browser';

/** Return a compact, stable tab label for a URL opened without an explicit title. */
export function browserTabTitleFromUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return DEFAULT_BROWSER_TAB_TITLE;

  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return parsed.host || DEFAULT_BROWSER_TAB_TITLE;
  } catch {
    return DEFAULT_BROWSER_TAB_TITLE;
  }
}
