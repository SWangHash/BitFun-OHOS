/**
 * Localizes the Monaco chrome that is not reachable through app i18n because
 * it is rendered by Monaco itself: the built-in find/replace widget and the
 * fold-range hints in the margin. Monaco ships English NLS strings only, so
 * the bridge watches the editor DOM and rewrites known English strings with
 * localized equivalents from the `tools` namespace.
 */

export interface MonacoChromeStrings {
  find: string;
  replace: string;
  replaceAll: string;
  toggleReplace: string;
  previousMatch: string;
  nextMatch: string;
  findInSelection: string;
  matchCase: string;
  matchWholeWord: string;
  useRegularExpression: string;
  preserveCase: string;
  close: string;
  noResults: string;
  expandRange: string;
  collapseRange: string;
  formatMatches: (current: number, total: number) => string;
}

type MonacoChromeTextKey = Exclude<keyof MonacoChromeStrings, 'formatMatches'>;

/** Longest-first so compound labels ("Replace All") win over their prefixes. */
const REPLACEMENT_RULES: ReadonlyArray<{ key: MonacoChromeTextKey; english: string }> = [
  { key: 'useRegularExpression', english: 'Use Regular Expression' },
  { key: 'matchWholeWord', english: 'Match Whole Word' },
  { key: 'findInSelection', english: 'Find in Selection' },
  { key: 'toggleReplace', english: 'Toggle Replace' },
  { key: 'replaceAll', english: 'Replace All' },
  { key: 'previousMatch', english: 'Previous Match' },
  { key: 'nextMatch', english: 'Next Match' },
  { key: 'matchCase', english: 'Match Case' },
  { key: 'preserveCase', english: 'Preserve Case' },
  { key: 'expandRange', english: 'Click to expand the range.' },
  { key: 'collapseRange', english: 'Click to collapse the range.' },
  { key: 'noResults', english: 'No results' },
  { key: 'replace', english: 'Replace' },
  { key: 'close', english: 'Close' },
  { key: 'find', english: 'Find' },
];

export function localizeMonacoText(text: string, strings: MonacoChromeStrings): string {
  for (const rule of REPLACEMENT_RULES) {
    if (text.includes(rule.english)) {
      return text.split(rule.english).join(strings[rule.key]);
    }
  }
  return text;
}

function localizeMatchesCount(text: string, strings: MonacoChromeStrings): string | null {
  const trimmed = text.trim();
  if (trimmed === 'No results') {
    return strings.noResults;
  }
  const match = /^(\d+)\s+of\s+(\d+)$/.exec(trimmed);
  if (match) {
    return strings.formatMatches(Number(match[1]), Number(match[2]));
  }
  return null;
}

const ATTRIBUTES_TO_LOCALIZE = ['title', 'aria-label', 'placeholder'] as const;

/**
 * Watches the editor container and rewrites Monaco-owned English strings.
 * Returns a detach function. Re-localization converges because already
 * localized text matches no English rule.
 */
export interface MonacoChromeI18nHandle {
  detach: () => void;
  update: (strings: MonacoChromeStrings) => void;
}

export function attachMonacoChromeI18n(container: HTMLElement, initialStrings: MonacoChromeStrings): MonacoChromeI18nHandle {
  let scheduled = false;
  let pendingTimer: number | undefined;
  let currentStrings = initialStrings;

  const localizeAttributes = (element: HTMLElement): void => {
    for (const attribute of ATTRIBUTES_TO_LOCALIZE) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const localized = localizeMonacoText(value, currentStrings);
      if (localized !== value) {
        element.setAttribute(attribute, localized);
      }
    }
    // Move native title into aria-label: ArkWeb renders persistent native
    // title bubbles that don't disappear on mouse leave (issue #432).
    const title = element.getAttribute('title');
    if (title && !element.getAttribute('aria-label')) {
      element.setAttribute('aria-label', title);
    }
    if (title) {
      element.removeAttribute('title');
    }
  };

  const run = (): void => {
    scheduled = false;
    const widget = container.querySelector<HTMLElement>('.find-widget');
    const margin = container.querySelector<HTMLElement>('.margin-view-overlays');
    if (widget) {
      // Include the widget root: its own title/aria-label (e.g. "Find / Replace")
      // must not leave a persistent native bubble on ArkWeb (issue #432).
      localizeAttributes(widget);
      widget.querySelectorAll<HTMLElement>('[title], [aria-label], [placeholder]').forEach(localizeAttributes);
      const count = widget.querySelector<HTMLElement>('.matchesCount');
      if (count) {
        const localized = localizeMatchesCount(count.textContent ?? '', currentStrings);
        if (localized !== null && localized !== count.textContent) {
          count.textContent = localized;
        }
      }
    }
    if (margin) {
      margin.querySelectorAll<HTMLElement>('[title]').forEach(localizeAttributes);
    }
  };

  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(run, 50);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(container, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['title', 'aria-label', 'placeholder'],
  });
  run();

  return {
    detach: () => {
      observer.disconnect();
      if (pendingTimer !== undefined) {
        window.clearTimeout(pendingTimer);
        pendingTimer = undefined;
      }
    },
    // Re-applies all localized strings with a new translation set (e.g. after
    // the user switches the UI language). Called from CodeEditor when the
    // i18n `languageChanged` event fires.
    update: (strings: MonacoChromeStrings) => {
      currentStrings = strings;
      run();
    },
  };
}
