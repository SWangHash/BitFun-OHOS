import type { MonacoChromeStrings } from './monacoChromeI18n';

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function buildMonacoChromeStrings(t: Translate): MonacoChromeStrings {
  return {
    find: t('editor.find.find'),
    replace: t('editor.find.replace'),
    replaceAll: t('editor.find.replaceAll'),
    toggleReplace: t('editor.find.toggleReplace'),
    previousMatch: t('editor.find.previousMatch'),
    nextMatch: t('editor.find.nextMatch'),
    findInSelection: t('editor.find.findInSelection'),
    matchCase: t('editor.find.matchCase'),
    matchWholeWord: t('editor.find.matchWholeWord'),
    useRegularExpression: t('editor.find.useRegularExpression'),
    preserveCase: t('editor.find.preserveCase'),
    close: t('editor.find.close'),
    noResults: t('editor.find.noResults'),
    expandRange: t('editor.find.expandRange'),
    collapseRange: t('editor.find.collapseRange'),
    formatMatches: (current, total) => t('editor.find.matchesOf', { current, total }),
  };
}
