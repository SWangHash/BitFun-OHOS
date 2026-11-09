// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachMonacoChromeI18n, type MonacoChromeStrings } from './monacoChromeI18n';

const strings: MonacoChromeStrings = {
  find: 'Find',
  replace: 'Replace',
  replaceAll: 'Replace All',
  toggleReplace: 'Toggle Replace',
  previousMatch: 'Previous Match',
  nextMatch: 'Next Match',
  findInSelection: 'Find in Selection',
  matchCase: 'Match Case',
  matchWholeWord: 'Match Whole Word',
  useRegularExpression: 'Use Regular Expression',
  preserveCase: 'Preserve Case',
  close: 'Close',
  noResults: 'No results',
  expandRange: 'Click to expand the range.',
  collapseRange: 'Click to collapse the range.',
  formatMatches: (current, total) => `${current} of ${total}`,
};

describe('monacoChromeI18n chrome hover layer', () => {
  let container: HTMLDivElement;
  let findButton: HTMLButtonElement;
  let detach: (() => void) | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    const findWidget = document.createElement('div');
    findWidget.className = 'find-widget';
    findButton = document.createElement('button');
    findButton.setAttribute('aria-label', 'Find');
    findWidget.append(findButton);
    container.append(findWidget);
    document.body.append(container);
  });

  afterEach(() => {
    detach?.();
    detach = null;
    container.remove();
  });

  function pointer(type: string, target: Element): void {
    const Ctor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
    target.dispatchEvent(new Ctor(type, { bubbles: true }));
  }

  function chromeTooltip(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.bitfun-editor-chrome-tooltip');
  }

  it('shows the app chrome hint on hover and hides on pointer leave', () => {
    detach = attachMonacoChromeI18n(container, strings).detach;

    findButton.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(chromeTooltip()?.style.display).toBe('block');
    expect(chromeTooltip()?.textContent).toBe('Find');

    // ArkWeb can drop the synthesized mouseout; the pointerout leaving the
    // anchor must still end the hint (issue #432).
    pointer('pointerout', findButton, container);
    expect(chromeTooltip()?.style.display).toBe('none');
  });

  it('hides on a pointerdown tap without any mousedown', () => {
    detach = attachMonacoChromeI18n(container, strings).detach;

    findButton.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(chromeTooltip()?.style.display).toBe('block');

    pointer('pointerdown', findButton);
    expect(chromeTooltip()?.style.display).toBe('none');
  });
});
