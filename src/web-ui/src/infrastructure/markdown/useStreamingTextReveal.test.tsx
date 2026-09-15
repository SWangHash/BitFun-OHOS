// @vitest-environment jsdom
import React, { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
const cleanups: (() => void)[] = [];
function render(element: React.ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  let mounted = true;
  const unmount = () => { if (mounted) { act(() => root.unmount()); container.remove(); mounted = false; } };
  cleanups.push(unmount);
  return { container, rerender: (next: React.ReactNode) => act(() => root.render(next)), unmount };
}
function cleanup() { cleanups.splice(0).forEach(fn => fn()); }
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STREAMING_TEXT_REVEAL_MS, useStreamingTextReveal } from './useStreamingTextReveal';

function Fixture({ text, streaming = true }: { text: string; streaming?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useStreamingTextReveal(ref, text, streaming);
  return <div ref={ref}><p>{text}</p><button>Copy</button></div>;
}
let highlights: Map<string, Set<Range>>;
const visibleRanges = () => [...highlights.values()].flatMap(value => [...value]).map(range => range.toString());
beforeEach(() => {
  vi.useFakeTimers();
  highlights = new Map();
  vi.stubGlobal('CSS', { highlights });
  vi.stubGlobal('Highlight', Set);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('streaming text arrival paint', () => {
  it('fades only appended glyphs without replacing text nodes or wrapping spans', () => {
    const view = render(<Fixture text="Already here" />);
    const textNode = view.container.querySelector('p')!.firstChild;
    expect(visibleRanges()).toEqual([]);
    view.rerender(<Fixture text="Already here 新文字👨‍👩‍👧‍👦" />);
    expect(visibleRanges()).toEqual([' 新文字👨‍👩‍👧‍👦']);
    expect(view.container.querySelector('p')!.firstChild).toBe(textNode);
    expect(view.container.querySelector('span')).toBeNull();
    expect(visibleRanges().join('')).not.toContain('Copy');
    act(() => vi.advanceTimersByTime(STREAMING_TEXT_REVEAL_MS + 20));
    expect(visibleRanges()).toEqual([]);
  });
  it('does not restart earlier arrivals when another batch arrives or the stream completes', () => {
    const view = render(<Fixture text="A" />);
    view.rerender(<Fixture text="AB" />);
    act(() => vi.advanceTimersByTime(96));
    view.rerender(<Fixture text="ABC" />);
    expect(visibleRanges().sort()).toEqual(['B', 'C']);
    view.rerender(<Fixture text="ABC" streaming={false} />);
    act(() => vi.advanceTimersByTime(80));
    expect(visibleRanges()).toEqual(['C']);
    act(() => vi.advanceTimersByTime(100));
    expect(visibleRanges()).toEqual([]);
  });
  it('settles history, remounts and replacements immediately', () => {
    const view = render(<Fixture text="History" streaming={false} />);
    view.rerender(<Fixture text="History extended" streaming={false} />);
    expect(visibleRanges()).toEqual([]);
    view.rerender(<Fixture text="Different response" />);
    expect(visibleRanges()).toEqual([]);
    view.unmount();
    render(<Fixture text="Already streaming on remount" />);
    expect(visibleRanges()).toEqual([]);
  });
  it('keeps parallel renderer ownership independent and releases ranges on unmount', () => {
    const first = render(<Fixture text="A" />);
    const second = render(<Fixture text="X" />);
    first.rerender(<Fixture text="AB" />);
    second.rerender(<Fixture text="XY" />);
    expect(visibleRanges()).toEqual(['B', 'Y']);
    first.unmount();
    expect(visibleRanges()).toEqual(['Y']);
    second.unmount();
    expect(visibleRanges()).toEqual([]);
  });
  it('honors reduced motion and works without the highlight API', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const view = render(<Fixture text="A" />);
    view.rerender(<Fixture text="AB" />);
    expect(visibleRanges()).toEqual([]);
    vi.stubGlobal('CSS', {});
    view.rerender(<Fixture text="ABC" />);
    expect(view.container.textContent).toBe('ABCCopy');
  });
});
