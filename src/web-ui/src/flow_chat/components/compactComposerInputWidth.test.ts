// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { readCompactComposerInputWidth } from './compactComposerInputWidth';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

function composer(layout = 'compact', width = 183.75) {
  const container = document.createElement('div');
  container.className = `bitfun-chat-input bitfun-chat-input--${layout === 'compact' ? 'capsule' : 'multi-line'}`;
  container.innerHTML = `<div data-bitfun-component="chat-composer"><div data-bitfun-part="surface" data-bitfun-layout="${layout}"><div class="bitfun-chat-input__input-area"></div></div></div>`;
  const area = container.querySelector<HTMLElement>('.bitfun-chat-input__input-area')!;
  const read = vi.spyOn(area, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, width, 20));
  document.body.append(container);
  return { container, area, read };
}

it('reads the actual compact input track without DOM mutations or cloning', () => {
  const { container, read } = composer();
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  const clone = vi.spyOn(container, 'cloneNode');
  expect(readCompactComposerInputWidth(container)).toBe(183);
  expect(read).toHaveBeenCalledOnce();
  expect(clone).not.toHaveBeenCalled();
  expect(observer.takeRecords()).toEqual([]);
  observer.disconnect();
});

it('never substitutes the wider expanded track for the compact-layout probe', () => {
  const { container, read } = composer('expanded', 600);
  expect(readCompactComposerInputWidth(container)).toBeNull();
  container.classList.replace('bitfun-chat-input--multi-line', 'bitfun-chat-input--capsule');
  expect(readCompactComposerInputWidth(container)).toBeNull();
  expect(read).not.toHaveBeenCalled();
});

it.each([0, NaN, Infinity])('retains the fallback for unusable geometry %s', width => {
  const { container } = composer('compact', width);
  expect(readCompactComposerInputWidth(container)).toBeNull();
});

it('reads fresh geometry when controls or the pane width change', () => {
  const { container, read } = composer();
  expect(readCompactComposerInputWidth(container)).toBe(183);
  read.mockReturnValue(new DOMRect(0, 0, 92.5, 20));
  expect(readCompactComposerInputWidth(container)).toBe(92);
  read.mockReturnValue(new DOMRect(0, 0, 50.5, 20));
  expect(readCompactComposerInputWidth(container)).toBe(80);
});
