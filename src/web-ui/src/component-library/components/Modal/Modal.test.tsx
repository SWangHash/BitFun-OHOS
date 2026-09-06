// @vitest-environment jsdom

import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/infrastructure/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe('Modal behavior', () => {
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
    document.querySelectorAll('style[data-openbitfun-appearance-runtime="test"]')
      .forEach(style => style.remove());
    document.documentElement.removeAttribute('data-openbitfun-appearance');
    document.documentElement.removeAttribute('data-openbitfun-appearance-revision');
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const pressEscape = () => {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }));
  };

  it('keeps the dialog mounted until its exit animation completes', () => {
    act(() => {
      root.render(
        <Modal isOpen onClose={vi.fn()} title="Motion test">
          Content
        </Modal>,
      );
    });

    expect(document.body.querySelector('.modal')).not.toBeNull();

    act(() => {
      root.render(
        <Modal isOpen={false} onClose={vi.fn()} title="Motion test">
          Content
        </Modal>,
      );
    });

    expect(document.body.querySelector('.modal-overlay--exiting')).not.toBeNull();
    expect(document.body.querySelector('.modal--exiting')).not.toBeNull();
    expect(document.body.querySelector('[role="dialog"]')?.getAttribute('aria-hidden')).toBe('true');

    act(() => vi.advanceTimersByTime(179));
    expect(document.body.querySelector('.modal')).not.toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(document.body.querySelector('.modal')).toBeNull();
  });

  it('cancels the exit when the dialog reopens', () => {
    const renderModal = (isOpen: boolean) => {
      root.render(
        <Modal isOpen={isOpen} onClose={vi.fn()} title="Motion test">
          Content
        </Modal>,
      );
    };

    act(() => renderModal(true));
    act(() => renderModal(false));
    act(() => {
      vi.advanceTimersByTime(80);
      renderModal(true);
    });
    act(() => vi.advanceTimersByTime(180));

    expect(document.body.querySelector('.modal')).not.toBeNull();
    expect(document.body.querySelector('.modal--exiting')).toBeNull();
  });

  it('keeps instance dimensions above late Appearance size rules', () => {
    act(() => {
      root.render(
        <Modal
          isOpen
          onClose={vi.fn()}
          size="xlarge"
          dimensions={{
            width: '100%',
            maxWidth: 960,
            maxHeight: 'calc(100vh - 80px)',
          }}
        >
          Content
        </Modal>,
      );
    });

    const runtimeStyle = document.createElement('style');
    runtimeStyle.setAttribute('data-openbitfun-appearance-runtime', 'test');
    runtimeStyle.textContent = `
      :root[data-openbitfun-appearance="builtin"][data-openbitfun-appearance-revision="7"]
      [data-openbitfun-component="modal"][data-openbitfun-part="dialog"][data-openbitfun-size="xlarge"] {
        width: 100%;
        max-width: 720px;
        max-height: 100%;
      }
    `;
    document.documentElement.setAttribute('data-openbitfun-appearance', 'builtin');
    document.documentElement.setAttribute('data-openbitfun-appearance-revision', '7');
    document.head.appendChild(runtimeStyle);

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.style.width).toBe('100%');
    expect(dialog?.style.maxWidth).toBe('960px');
    expect(dialog?.style.maxHeight).toBe('calc(100vh - 80px)');
    expect(dialog ? getComputedStyle(dialog).maxWidth : null).toBe('960px');
  });

  it('closes only when the pointer press and release both occur on the overlay', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <Modal isOpen onClose={onClose} title="Overlay behavior">
          <input defaultValue="Selectable content" />
        </Modal>,
      );
    });

    const overlay = document.body.querySelector('.modal-overlay') as HTMLDivElement;
    const input = document.body.querySelector('.modal input') as HTMLInputElement;

    act(() => {
      overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      overlay.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    act(() => {
      input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      overlay.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes a standalone modal on Escape', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <Modal isOpen onClose={onClose} title="Standalone">
          Content
        </Modal>,
      );
    });

    act(pressEscape);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes only the topmost modal for each Escape press', () => {
    const parentClosed = vi.fn();
    const childClosed = vi.fn();

    const NestedModals = () => {
      const [parentOpen, setParentOpen] = useState(true);
      const [childOpen, setChildOpen] = useState(true);
      return (
        <>
          <Modal isOpen={parentOpen} onClose={() => {
            parentClosed();
            setParentOpen(false);
          }} title="Parent">
            Parent content
          </Modal>
          <Modal isOpen={childOpen} onClose={() => {
            childClosed();
            setChildOpen(false);
          }} title="Child">
            Child content
          </Modal>
        </>
      );
    };

    act(() => root.render(<NestedModals />));
    act(pressEscape);

    expect(childClosed).toHaveBeenCalledTimes(1);
    expect(parentClosed).not.toHaveBeenCalled();

    act(pressEscape);

    expect(childClosed).toHaveBeenCalledTimes(1);
    expect(parentClosed).toHaveBeenCalledTimes(1);
  });

  it('removes a closed child from the stack before a reopened child is handled', () => {
    const parentClosed = vi.fn();

    const ReopenedChild = () => {
      const [childOpen, setChildOpen] = useState(true);
      return (
        <>
          <Modal isOpen onClose={parentClosed} title="Parent">
            Parent content
          </Modal>
          <Modal isOpen={childOpen} onClose={() => setChildOpen(false)} title="Child">
            Child content
          </Modal>
          {!childOpen ? <button onClick={() => setChildOpen(true)}>Reopen child</button> : null}
        </>
      );
    };

    act(() => root.render(<ReopenedChild />));
    act(pressEscape);
    const reopen = Array.from(document.body.querySelectorAll('button'))
      .find(button => button.textContent === 'Reopen child');
    expect(reopen).toBeTruthy();

    act(() => reopen?.click());
    act(pressEscape);
    expect(parentClosed).not.toHaveBeenCalled();

    act(pressEscape);
    expect(parentClosed).toHaveBeenCalledTimes(1);
  });
});
