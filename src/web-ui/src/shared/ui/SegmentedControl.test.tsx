// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SegmentedControl } from '@bitfun/ui';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('preserves independent button navigation and repeated activation without changing radio defaults', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const change = vi.fn();
  const options = [{ value: 'content', label: 'Content' }, { value: 'filenames', label: 'File names' }];
  try {
    act(() => root.render(<SegmentedControl interaction="buttons" labelBehavior="static" value="content" options={options} onValueChange={change} />));
    let buttons = container.querySelectorAll('button');
    expect([...buttons].map(button => button.tabIndex)).toEqual([0, 0]);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    act(() => buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(change).not.toHaveBeenCalled();
    act(() => buttons[0].click());
    act(() => buttons[1].click());
    expect(change.mock.calls).toEqual([['content'], ['filenames']]);
    change.mockClear();
    act(() => root.render(<SegmentedControl value="content" options={options} onValueChange={change} />));
    buttons = container.querySelectorAll('button');
    expect([...buttons].map(button => button.tabIndex)).toEqual([0, -1]);
    act(() => buttons[0].click());
    expect(change).not.toHaveBeenCalled();
    act(() => buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(change).toHaveBeenCalledExactlyOnceWith('filenames');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
