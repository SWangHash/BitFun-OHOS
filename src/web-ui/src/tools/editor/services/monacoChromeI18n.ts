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
  // Apply every matching rule: compound labels like "Find / Replace" contain
  // several chrome strings, and stopping at the first match produced
  // half-localized text ("Find / [localized Replace]") that then defeated the reverse
  // restore and the hover-remover matching (issue #432).
  let result = text;
  for (const rule of REPLACEMENT_RULES) {
    if (result.includes(rule.english)) {
      result = result.split(rule.english).join(strings[rule.key]);
    }
  }
  return result;
}

/**
 * Maps previously-localized chrome text back to its English source. Language
 * switches re-run localization over DOM that already carries the previous
 * language, so the restore pass must run before the new localization
 * (issue #434: en→zh worked, zh→en left stale Chinese labels). Longest-first
 * so compound labels win over their prefixes.
 */
function buildEnglishRestoreLookup(strings: MonacoChromeStrings): ReadonlyArray<{ localized: string; english: string }> {
  return REPLACEMENT_RULES
    .map(rule => ({ localized: strings[rule.key], english: rule.english }))
    .sort((a, b) => b.localized.length - a.localized.length);
}

function restoreEnglishText(text: string, lookup: ReadonlyArray<{ localized: string; english: string }>): string {
  let result = text;
  for (const entry of lookup) {
    if (entry.localized && result.includes(entry.localized)) {
      result = result.split(entry.localized).join(entry.english);
    }
  }
  return result;
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
 * were constructed with. Monaco appends keybinding hints to hover content,
 * so the comparison is prefix-based rather than exact. Editor content hovers
 * (diagnostics, markdown) carry different text and stay untouched.
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
  if (localized.some(label => label.length > 0 && normalized.startsWith(label))) return true;
  return REPLACEMENT_RULES.some(rule => normalized.startsWith(rule.english));
}

/**
 * Monaco renders managed-hover widgets at the body level, outside the editor
 * container, so the capture-phase block on the container cannot cover every
 * trigger path — and a widget that already showed stays visible on ArkWeb
 * (issue #432). This watcher hides chrome hint hover widgets before they
 * paint: an added node is inspected only when it is a Monaco hover widget or
 * its context-view wrapper (cheap class check), and only exact chrome hint
 * texts are hidden. The wrapper is hidden, not removed: Monaco owns that
 * `.context-view` node for the editor's lifetime and reuses it for every
 * context view (content hovers, context menus), so detaching it would leave
 * Monaco rendering into a detached node and silence all of them. Monaco's
 * own show() un-hides the wrapper for the next delegate.
 */
function attachChromeHintHoverRemover(strings: () => MonacoChromeStrings): () => void {
  // Wrappers hidden by this watcher: ContextView.show() clears the wrapper's
  // inline display for the next delegate, and the hover widget itself may be
  // re-rendered as CHILD mutations inside the (now visible) wrapper — nodes
  // that carry no `.monaco-hover` class and slip past the class guard. Any
  // mutation inside a hidden wrapper therefore re-hides it.
  const hiddenWrappers = new WeakSet<HTMLElement>();
  const hideChromeHover = (hover: Element): void => {
    if (!isChromeHintText(hover.textContent ?? '', strings())) return;
    const target = hover.closest<HTMLElement>('.context-view') ?? (hover instanceof HTMLElement ? hover : null);
    if (!target) return;
    target.style.display = 'none';
    hiddenWrappers.add(target);
  };

  const sweepExisting = (): void => {
    document.querySelectorAll<HTMLElement>('.monaco-hover').forEach(hideChromeHover);
  };

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      const mutatedInHiddenWrapper = mutation.target instanceof HTMLElement
        && hiddenWrappers.has((mutation.target.closest<HTMLElement>('.context-view')) ?? mutation.target);
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (mutatedInHiddenWrapper) {
          const wrapper = node.closest<HTMLElement>('.context-view') ?? node;
          if (hiddenWrappers.has(wrapper)) {
            wrapper.style.display = 'none';
          }
          continue;
        }
        const isHoverNode = node.classList.contains('monaco-hover');
        if (!isHoverNode && !node.classList.contains('context-view')) continue;
        const hover = isHoverNode ? node : node.querySelector<HTMLElement>('.monaco-hover');
        if (hover) hideChromeHover(hover);
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

  // Monaco's managed hover ALSO shows when a chrome element receives FOCUS
  // (clicking a button or tabbing into the find widget — capture-phase focus
  // listener on the target, issue #432 verification). Blocking focus descent
  // at the container removes that path the same way the mouseover path is
  // blocked; keyboard operation of the buttons is unaffected.
  const onFocus = (event: FocusEvent): void => {
    const node = event.target instanceof Element ? event.target : null;
    const target = node?.closest(HOVER_TARGET_SELECTOR) ?? null;
    if (!target || !container.contains(target)) return;
    event.stopPropagation();
  };

  container.addEventListener('mouseover', onOver, true);
  container.addEventListener('mouseout', onOut, true);
  container.addEventListener('focus', onFocus, true);
  container.addEventListener('scroll', hide, true);
  return () => {
    container.removeEventListener('mouseover', onOver, true);
    container.removeEventListener('mouseout', onOut, true);
    container.removeEventListener('focus', onFocus, true);
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
  // The strings used for the last localization pass: language switches must
  // first restore their output back to English before applying the new
  // language, otherwise already-localized labels never re-localize (issue
  // #434).
  let previousStrings = initialStrings;
  const detachHoverLayer = attachChromeHoverLayer(container);
  const detachHintRemover = attachChromeHintHoverRemover(() => currentStrings);

  const localizeAttributes = (element: HTMLElement, restoreLookup: ReadonlyArray<{ localized: string; english: string }>): void => {
    for (const attribute of ATTRIBUTES_TO_LOCALIZE) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const localized = localizeMonacoText(restoreEnglishText(value, restoreLookup), currentStrings);
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
    // One reverse lookup per pass: previously-localized text (attributes AND
    // text nodes) is restored to English before the new language is applied.
    const restoreLookup = buildEnglishRestoreLookup(previousStrings);
    // A diff container hosts two inner editors, so every find widget and
    // margin overlay under the container must be covered, not just the first.
    container.querySelectorAll<HTMLElement>('.find-widget').forEach(widget => {
      // Include the widget root: its own title/aria-label (e.g. "Find / Replace")
      // must not leave a persistent native bubble on ArkWeb (issue #432).
      localizeAttributes(widget, restoreLookup);
      widget.querySelectorAll<HTMLElement>('[title], [aria-label], [placeholder]').forEach(element => localizeAttributes(element, restoreLookup));
      const count = widget.querySelector<HTMLElement>('.matchesCount');
      if (count) {
        // The count text ("No results" / "N of M") is re-localized through the
        // same restore pass, otherwise it never follows a language switch
        // (issue #434: localized "No results" ↔ English "No results").
        const restored = restoreEnglishText(count.textContent ?? '', restoreLookup);
        const localized = localizeMatchesCount(restored, currentStrings);
        if (localized !== null && localized !== count.textContent) {
          count.textContent = localized;
        }
      }
    });
    container.querySelectorAll<HTMLElement>('.margin-view-overlays').forEach(margin => {
      // Glyphs carry their hint in aria-label after the first pass removed
      // the native title, so re-localization must scan aria-labels too
      // (issue #434: fold hints did not follow language switches).
      margin.querySelectorAll<HTMLElement>('[title], [aria-label]').forEach(element => localizeAttributes(element, restoreLookup));
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
    // i18n `languageChanged` event fires. The previously applied strings are
    // kept so the restore pass can map them back to English first (issue
    // #434).
    update: (strings: MonacoChromeStrings) => {
      previousStrings = currentStrings;
      currentStrings = strings;
      run();
    },
  };
}
