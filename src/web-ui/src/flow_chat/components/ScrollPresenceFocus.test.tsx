/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScrollToBottomButton } from './ScrollToBottomButton';
import { ScrollToLatestBar } from './ScrollToLatestBar';
import { ScrollToTurnHeaderButton } from './ScrollToTurnHeaderButton';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@openbitfun/ui', async importOriginal => ({
  ...await importOriginal<typeof import('@openbitfun/ui')>(),
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));

describe('retained scroll controls', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('returns focus from the scroll-to-bottom button before its retained exit', () => {
    const focusTarget = document.createElement('div');
    focusTarget.tabIndex = -1;
    document.body.appendChild(focusTarget);
    const focusReturnRef = { current: focusTarget };
    act(() => {
      root.render(
        <ScrollToBottomButton
          visible
          onClick={vi.fn()}
          focusReturnRef={focusReturnRef}
        />,
      );
    });
    const button = container.querySelector<HTMLButtonElement>('button');
    button?.focus();
    expect(document.activeElement).toBe(button);

    act(() => {
      root.render(
        <ScrollToBottomButton
          visible={false}
          onClick={vi.fn()}
          focusReturnRef={focusReturnRef}
        />,
      );
    });

    expect(document.activeElement).toBe(focusTarget);
    expect(button?.getAttribute('aria-hidden')).toBe('true');
    expect(button?.hasAttribute('inert')).toBe(true);
    expect(button?.tabIndex).toBe(-1);
    act(() => vi.advanceTimersByTime(199));
    expect(container.querySelector('button')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector('button')).toBeNull();
    focusTarget.remove();
  });

  it('returns focus from the scroll-to-latest bar before its retained exit', () => {
    const focusTarget = document.createElement('div');
    focusTarget.tabIndex = -1;
    document.body.appendChild(focusTarget);
    const focusReturnRef = { current: focusTarget };
    act(() => {
      root.render(
        <ScrollToLatestBar
          visible
          onClick={vi.fn()}
          focusReturnRef={focusReturnRef}
        />,
      );
    });
    const bar = container.querySelector<HTMLElement>('[role="button"]');
    bar?.focus();
    expect(document.activeElement).toBe(bar);

    act(() => {
      root.render(
        <ScrollToLatestBar
          visible={false}
          onClick={vi.fn()}
          focusReturnRef={focusReturnRef}
        />,
      );
    });

    expect(document.activeElement).toBe(focusTarget);
    expect(bar?.getAttribute('aria-hidden')).toBe('true');
    expect(bar?.hasAttribute('inert')).toBe(true);
    expect(bar?.tabIndex).toBe(-1);
    act(() => vi.advanceTimersByTime(199));
    expect(container.querySelector('[role="button"]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector('[role="button"]')).toBeNull();
    focusTarget.remove();
  });

  it('cancels removal when a scroll affordance reappears quickly', () => {
    act(() => {
      root.render(<ScrollToBottomButton visible onClick={vi.fn()} unreadCount={2} />);
    });
    act(() => {
      root.render(<ScrollToBottomButton visible={false} onClick={vi.fn()} unreadCount={2} />);
    });
    act(() => vi.advanceTimersByTime(100));
    act(() => {
      root.render(<ScrollToBottomButton visible onClick={vi.fn()} unreadCount={3} />);
    });
    act(() => vi.advanceTimersByTime(200));

    const button = container.querySelector<HTMLButtonElement>('button');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-hidden')).toBe('false');
    expect(button?.hasAttribute('inert')).toBe(false);
    expect(button?.textContent).toContain('3');
  });

  it('keeps latest navigation on the whole bar and fires once per action', () => {
    const onClick = vi.fn();
    act(() => root.render(<ScrollToLatestBar visible onClick={onClick} inputHeight={140} />));
    const bar = container.querySelector<HTMLElement>('[role="button"]')!;
    const iconButton = bar.querySelector<HTMLButtonElement>('[data-openbitfun-component="icon-button"]')!;
    expect(iconButton.tabIndex).toBe(-1);
    expect(iconButton.getAttribute('aria-hidden')).toBe('true');
    act(() => iconButton.click());
    expect(onClick).toHaveBeenCalledTimes(1);
    act(() => bar.click());
    expect(onClick).toHaveBeenCalledTimes(2);
    for (const key of ['Enter', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      act(() => bar.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
    }
    expect(onClick).toHaveBeenCalledTimes(4);
    act(() => root.render(<ScrollToLatestBar visible={false} onClick={onClick} inputHeight={140} />));
    act(() => {
      bar.click();
      bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onClick).toHaveBeenCalledTimes(4);
  });

  it('keeps current-turn navigation and its hidden tab order', () => {
    const onClick = vi.fn();
    act(() => root.render(<ScrollToTurnHeaderButton visible onClick={onClick} turnLabel="Current turn" />));
    const button = container.querySelector<HTMLButtonElement>('[data-openbitfun-component="icon-button"]')!;
    expect(button.getAttribute('aria-label')).toBe('Current turn');
    expect(button.tabIndex).toBe(0);
    act(() => button.click());
    expect(onClick).toHaveBeenCalledTimes(1);
    act(() => root.render(<ScrollToTurnHeaderButton visible={false} onClick={onClick} />));
    expect(button.tabIndex).toBe(-1);
    expect(button.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
