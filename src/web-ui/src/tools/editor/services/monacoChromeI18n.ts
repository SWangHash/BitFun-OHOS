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
export function attachMonacoChromeI18n(container: HTMLElement, strings: MonacoChromeStrings): () => void {
  let scheduled = false;

  const localizeAttributes = (element: HTMLElement): void => {
    for (const attribute of ATTRIBUTES_TO_LOCALIZE) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const localized = localizeMonacoText(value, strings);
      if (localized !== value) {
        element.setAttribute(attribute, localized);
      }
    }
  };

  const run = (): void => {
    scheduled = false;
    const widget = container.querySelector<HTMLElement>('.find-widget');
    const margin = container.querySelector<HTMLElement>('.margin-view-overlays');
    if (widget) {
      widget.querySelectorAll<HTMLElement>('[title], [aria-label], [placeholder]').forEach(localizeAttributes);
      const count = widget.querySelector<HTMLElement>('.matchesCount');
      if (count) {
        const localized = localizeMatchesCount(count.textContent ?? '', strings);
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

  return () => observer.disconnect();
}
