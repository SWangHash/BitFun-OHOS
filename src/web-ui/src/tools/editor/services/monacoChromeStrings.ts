import type { MonacoChromeStrings } from './monacoChromeI18n';

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function buildMonacoChromeStrings(t: Translate): MonacoChromeStrings {
  return {
    find: t('editor.findWidget.find'),
    replace: t('editor.findWidget.replace'),
    replaceAll: t('editor.findWidget.replaceAll'),
    toggleReplace: t('editor.findWidget.toggleReplace'),
    previousMatch: t('editor.findWidget.previousMatch'),
    nextMatch: t('editor.findWidget.nextMatch'),
    findInSelection: t('editor.findWidget.findInSelection'),
    matchCase: t('editor.findWidget.matchCase'),
    matchWholeWord: t('editor.findWidget.matchWholeWord'),
    useRegularExpression: t('editor.findWidget.useRegularExpression'),
    preserveCase: t('editor.findWidget.preserveCase'),
    close: t('editor.findWidget.close'),
    noResults: t('editor.findWidget.noResults'),
    expandRange: t('editor.findWidget.expandRange'),
    collapseRange: t('editor.findWidget.collapseRange'),
    formatMatches: (current, total) => t('editor.findWidget.matchesOf', { current, total }),
  };
}
