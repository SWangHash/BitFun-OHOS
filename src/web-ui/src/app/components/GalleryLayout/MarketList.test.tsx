// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketList } from './MarketList';

describe('marketplace reorder motion', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let animations: Array<{ element: HTMLElement; frames: Keyframe[]; cancel: ReturnType<typeof vi.fn> }>;
  let offsets: Map<string, number>;
  let reduced: boolean;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    reduced = false; offsets = new Map(); animations = [];
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced })));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const element = this as HTMLElement;
      const index = element.dataset.marketKey ? [...element.parentElement!.children].indexOf(element) : 0;
      const top = index * 100 + (offsets.get(element.dataset.marketKey ?? '') ?? 0);
      return { x: 0, y: top, left: 0, top, width: 200, height: 80, bottom: top + 80, right: 200, toJSON: () => ({}) };
    });
    vi.stubGlobal('Animation', class {});
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: vi.fn(function (frames: Keyframe[]) {
      const element = this as HTMLElement;
      const cancel = vi.fn(() => offsets.delete(element.dataset.marketKey!));
      animations.push({ element, frames, cancel });
      return { cancel, onfinish: null };
    }) });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete (HTMLElement.prototype as any).animate;
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  async function render(keys: string[], animate = true) {
    await act(async () => root.render(
      <MarketList revision={keys.join(',')} animate={animate}>
        {keys.map(key => <button key={key} data-market-key={key}>{key}</button>)}
      </MarketList>,
    ));
  }

  it('keeps keyed nodes mounted and animates their displacement, not their dimensions', async () => {
    await render(['a', 'b', 'c']);
    const first = container.querySelector('[data-market-key="a"]');
    await render(['c', 'b', 'a']);
    expect(container.querySelector('[data-market-key="a"]')).toBe(first);
    expect(animations).toHaveLength(2);
    expect(animations.find(item => item.element === first)?.frames)
      .toEqual([{ transform: 'translate(0px, -200px)' }, { transform: 'translate(0, 0)' }]);
    await render(['c', 'b', 'a']);
    expect(animations).toHaveLength(2);
  });

  it('retargets an interrupted sort from the current on-screen position', async () => {
    await render(['a', 'b']);
    await render(['b', 'a']);
    offsets.set('a', -40); // a is midway back from its old position.
    offsets.set('b', 40);
    await render(['a', 'b']);
    expect(animations[0].cancel).toHaveBeenCalledOnce();
    expect(animations.filter(item => item.element.dataset.marketKey === 'a').at(-1)?.frames[0])
      .toEqual({ transform: 'translate(0px, 60px)' });
  });

  it('leaves unchanged catalogs, reduced motion and keyboard-driven sorts instant', async () => {
    await render(['a', 'b']);
    await render(['a', 'b']);
    reduced = true;
    await render(['b', 'a']);
    reduced = false;
    await render(['a', 'b'], false);
    expect(animations).toHaveLength(0);
  });
});
