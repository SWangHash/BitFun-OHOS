import { useLayoutEffect, useRef, type RefObject } from 'react';

export const STREAMING_TEXT_REVEAL_MS = 160;
const LEVELS = 32;
const NAME = 'openbitfun-stream-reveal-';
type TextHighlight = Set<Range>;
type HighlightAPI = {
  CSS?: { highlights?: Map<string, TextHighlight> };
  Highlight?: new (...ranges: Range[]) => TextHighlight;
};
interface Arrival { start: number; end: number; at: number }
interface TextRun { node: Text; start: number; end: number }

function readRuns(root: HTMLElement): { runs: TextRun[]; text: string } {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest('button, [aria-hidden="true"], .katex-mathml')
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const runs: TextRun[] = [];
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const start = text.length;
    text += node.textContent ?? '';
    runs.push({ node: node as Text, start, end: text.length });
  }
  return { runs, text };
}

/**
 * Paint-only arrival treatment, shared by every streaming Markdown surface.
 * Ranges leave React's text nodes, selection, wrapping and virtualizer geometry
 * untouched. Each owner removes only its own ranges from the shared buckets.
 * Existing text on mount (including virtualized remounts) is already settled.
 */
export function useStreamingTextReveal(
  rootRef: RefObject<HTMLDivElement>, source: string, streaming: boolean,
): void {
  const previous = useRef<{ source: string; text: string } | null>(null);
  const arrivals = useRef<Arrival[]>([]);
  const owned = useRef<{ highlight: TextHighlight; range: Range }[]>([]);
  const frame = useRef<number | null>(null);
  const stop = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    for (const { highlight, range } of owned.current) highlight.delete(range);
    owned.current = [];
  };

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const view = root.ownerDocument.defaultView;
    const api = view as (Window & HighlightAPI) | null;
    const registry = api?.CSS?.highlights;
    const Highlight = api?.Highlight;
    const before = previous.current;
    // Do not traverse settled history on unrelated renderer updates.
    if (before?.source === source && arrivals.current.length === 0) return;
    const current = readRuns(root);
    previous.current = { source, text: current.text };
    const reduced = view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!registry || !Highlight || reduced || root.ownerDocument.hidden) {
      stop();
      arrivals.current = [];
      return;
    }
    const appended = before && source.startsWith(before.source) && source.length > before.source.length;
    if (before && !source.startsWith(before.source)) arrivals.current = [];
    // Reinterpreting Markdown may replace earlier nodes. Never replay those
    // letters; only a genuinely appended visible suffix gets a new arrival.
    if (streaming && appended && current.text.startsWith(before.text)) {
      arrivals.current.push({ start: before.text.length, end: current.text.length, at: performance.now() });
    }
    stop();
    // Resolve ranges once per content commit. Animation frames only move those
    // ranges between paint buckets; they do not walk a long transcript again.
    const resolved = arrivals.current.map(arrival => {
      const ranges: Range[] = [];
      let low = 0;
      let high = current.runs.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (current.runs[middle].end <= arrival.start) low = middle + 1;
        else high = middle;
      }
      for (let index = low; index < current.runs.length; index++) {
        const run = current.runs[index];
        if (run.start >= arrival.end) break;
        const start = Math.max(arrival.start, run.start);
        const end = Math.min(arrival.end, run.end);
        if (start >= end) continue;
        const range = root.ownerDocument.createRange();
        range.setStart(run.node, start - run.start);
        range.setEnd(run.node, end - run.start);
        ranges.push(range);
      }
      return { arrival, ranges };
    });
    const paint = (now: number) => {
      stop();
      arrivals.current = arrivals.current.filter(arrival => now - arrival.at < STREAMING_TEXT_REVEAL_MS);
      for (const { arrival, ranges } of resolved) {
        if (now - arrival.at >= STREAMING_TEXT_REVEAL_MS) continue;
        const progress = Math.max(0, (now - arrival.at) / STREAMING_TEXT_REVEAL_MS);
        const level = Math.min(LEVELS - 1, Math.floor((1 - (1 - progress) ** 2) * LEVELS));
        const name = `${NAME}${level}`;
        let highlight = registry.get(name);
        if (!highlight) {
          highlight = new Highlight();
          registry.set(name, highlight);
        }
        for (const range of ranges) {
          highlight.add(range);
          owned.current.push({ highlight, range });
        }
      }
      if (arrivals.current.length) frame.current = requestAnimationFrame(paint);
    };
    // Layout timing styles newly committed glyphs before their first paint.
    paint(performance.now());
  }, [source, streaming, rootRef]);

  useLayoutEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const clear = () => { stop(); arrivals.current = []; };
    const onPreference = () => { if (media?.matches) clear(); };
    const onVisibility = () => { if (document.hidden) clear(); };
    media?.addEventListener?.('change', onPreference);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clear();
      media?.removeEventListener?.('change', onPreference);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}
