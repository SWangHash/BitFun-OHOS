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
 * Monaco chrome whose hover hints the app renders itself: find-widget buttons
 * and the fold-range glyphs in the margin. Monaco shows these through its own
 * managed-hover widget or a native `title` bubble, and neither hides reliably
 * on ArkWeb (issue #432) — while every app-owned tooltip hides on mouse leave.
 * The layer below blocks Monaco's hover triggers (capture-phase mouseover)
 * and shows the localized aria-label in an app-styled overlay instead.
 */
const HOVER_TARGET_SELECTOR =
  '.find-widget [aria-label]:not(input):not(textarea), .margin-view-overlays .cldr[aria-label]';

const TOOLTIP_STYLE_ID = 'bitfun-editor-chrome-tooltip-style';

/**
 * Chrome hint texts whose Monaco managed-hover widget must never become
 * visible: the localized labels plus the English NLS originals the buttons
 * were constructed with. Editor content hovers (diagnostics, markdown) carry
 * different text and stay untouched.
 */
function isChromeHintText(text: string, strings: MonacoChromeStrings): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  const localized = [
    strings.find,
    strings.replace,
    strings.replaceAll,
    strings.toggleReplace,
    strings.previousMatch,
    strings.nextMatch,
    strings.findInSelection,
    strings.matchCase,
    strings.matchWholeWord,
    strings.useRegularExpression,
    strings.preserveCase,
    strings.close,
    strings.noResults,
    strings.expandRange,
    strings.collapseRange,
  ];
  if (localized.includes(normalized)) return true;
  return REPLACEMENT_RULES.some(rule => rule.english === normalized);
}

/**
 * Monaco renders managed-hover widgets at the body level, outside the editor
 * container, so the capture-phase block on the container cannot cover every
 * trigger path — and a widget that already showed stays visible on ArkWeb
 * (issue #432). This watcher removes chrome hint hover widgets before they
 * paint: an added node is inspected only when it is a Monaco hover widget or
 * its context-view wrapper (cheap class check), and only exact chrome hint
 * texts are dropped.
 */
function attachChromeHintHoverRemover(strings: () => MonacoChromeStrings): () => void {
  const dropChromeHover = (hover: Element): void => {
    if (!isChromeHintText(hover.textContent ?? '', strings())) return;
    const host = hover.closest<HTMLElement>('.context-view') ?? hover;
    host.remove();
  };

  const sweepExisting = (): void => {
    document.querySelectorAll<HTMLElement>('.monaco-hover').forEach(dropChromeHover);
  };

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const isHoverNode = node.classList.contains('monaco-hover');
        if (!isHoverNode && !node.classList.contains('context-view')) continue;
        const hover = isHoverNode ? node : node.querySelector<HTMLElement>('.monaco-hover');
        if (hover) dropChromeHover(hover);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  sweepExisting();
  return () => observer.disconnect();
}

function ensureTooltipStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(TOOLTIP_STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = TOOLTIP_STYLE_ID;
  style.textContent = `
.bitfun-editor-chrome-tooltip {
  position: fixed;
  z-index: var(--bitfun-layer-fullscreen, 2000);
  max-width: 320px;
  padding: 4px 8px;
  border: 1px solid var(--bitfun-color-field-border-hover);
  border-radius: 4px;
  background: var(--bitfun-color-surface-canvas);
  color: var(--bitfun-color-content-primary);
  font-size: var(--bitfun-type-label-sm-font-size, 12px);
  line-height: 1.4;
  pointer-events: none;
  box-shadow: 0 4px 20px color-mix(in srgb, var(--bitfun-color-content-on-light) 40%, transparent);
  white-space: normal;
  word-break: break-word;
}
`;
  document.head.appendChild(style);
}

/**
 * App-owned hover tooltip for the Monaco chrome listed in
 * HOVER_TARGET_SELECTOR. Shows on mouseover, hides on leave/scroll/detach —
 * the same lifecycle the app's other tooltips follow.
 */
function attachChromeHoverLayer(container: HTMLElement): () => void {
  ensureTooltipStyle();
  const tooltip = document.createElement('div');
  tooltip.className = 'bitfun-editor-chrome-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);

  const hide = (): void => {
    tooltip.style.display = 'none';
  };

  const show = (target: Element): void => {
    const label = target.getAttribute('aria-label') ?? target.getAttribute('title') ?? '';
    if (!label) {
      hide();
      return;
    }
    tooltip.textContent = label;
    tooltip.style.display = 'block';
    const rect = target.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - tipRect.width / 2),
      Math.max(8, window.innerWidth - tipRect.width - 8),
    );
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${rect.bottom + 6}px`;
  };

  const onOver = (event: MouseEvent): void => {
    const node = event.target instanceof Element ? event.target : null;
    const target = node?.closest(HOVER_TARGET_SELECTOR) ?? null;
    if (!target || !container.contains(target)) return;
    // Keep Monaco's own hover machinery from also reacting: the managed hover
    // and native bubbles are what fail to hide on ArkWeb (issue #432).
    event.stopPropagation();
    show(target);
  };

  const onOut = (event: MouseEvent): void => {
    const node = event.target instanceof Element ? event.target : null;
    if (!node?.closest(HOVER_TARGET_SELECTOR)) return;
    hide();
  };

  container.addEventListener('mouseover', onOver, true);
  container.addEventListener('mouseout', onOut, true);
  container.addEventListener('scroll', hide, true);
  return () => {
    container.removeEventListener('mouseover', onOver, true);
    container.removeEventListener('mouseout', onOut, true);
    container.removeEventListener('scroll', hide, true);
    tooltip.remove();
  };
}

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
  let currentStrings = initialStrings;
  const detachHoverLayer = attachChromeHoverLayer(container);
  const detachHintRemover = attachChromeHintHoverRemover(() => currentStrings);

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
    // A diff container hosts two inner editors, so every find widget and
    // margin overlay under the container must be covered, not just the first.
    container.querySelectorAll<HTMLElement>('.find-widget').forEach(widget => {
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
    });
    container.querySelectorAll<HTMLElement>('.margin-view-overlays').forEach(margin => {
      margin.querySelectorAll<HTMLElement>('[title]').forEach(localizeAttributes);
    });
  };

  const observer = new MutationObserver(mutations => {
    // The cleanup must run SYNCHRONOUSLY in the observer microtask: mutation
    // observers always deliver before the frame's rendering steps, so a title
    // is stripped before the browser can paint the bubble. ArkWeb keeps a
    // painted native bubble alive after its element is gone (and only a new
    // bubble replaces it), so losing this race — as a deferred rAF cleanup
    // does on click-driven re-renders that paint in the same frame — means a
    // tooltip that never disappears (issue #432).
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        run();
        return;
      }
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            run();
            return;
          }
        }
        continue;
      }
      // characterData: only the find widget's match count matters; editor
      // typing must not trigger a full scan on every keystroke.
      const host = mutation.target.parentElement ?? mutation.target;
      if (host instanceof Element && host.closest('.find-widget')) {
        run();
        return;
      }
    }
  });
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
      detachHoverLayer();
      detachHintRemover();
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
