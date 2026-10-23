// @vitest-environment jsdom

import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExploreGroupData } from '../../store/modernFlowChatStore';
import type { FlowTextItem, FlowThinkingItem, FlowToolItem } from '../../types/flow-chat';
import { ExploreGroupRenderer } from './ExploreGroupRenderer';

const fixture = vi.hoisted(() => ({
  expandedGroups: new Map([['group', true]]),
  expandedHeight: 400,
  updateHeight: new Map<string, (height: number) => void>(),
}));

vi.mock('@bitfun/ui', () => ({ Icon: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./FlowChatContext', () => ({
  useFlowChatContext: () => ({}),
  useFlowChatVolatileContext: () => ({ exploreGroupStates: fixture.expandedGroups }),
}));
vi.mock('../FlowTextBlock', () => ({
  FlowTextBlock: () => <div className="flow-text-block" data-height="200">Text</div>,
}));
vi.mock('../FlowToolCard', () => ({
  FlowToolCard: ({ toolItem }: { toolItem: FlowToolItem }) => <ExpandableContent id={toolItem.id} />,
}));
vi.mock('../../tool-cards/ModelThinkingDisplay', () => ({
  ModelThinkingDisplay: ({ thinkingItem }: { thinkingItem: FlowThinkingItem }) => (
    <ExpandableContent id={thinkingItem.id} />
  ),
}));

// Child-local state deliberately does not replace the group's allItems array or
// dispatch a scroll/toggle event to the parent (as with a review summary).
function ExpandableContent({ id }: { id: string }) {
  const [expanded, setExpanded] = useState(false);
  const [height, setHeight] = useState(fixture.expandedHeight);
  useEffect(() => {
    fixture.updateHeight.set(id, setHeight);
    return () => { fixture.updateHeight.delete(id); };
  }, [id]);
  return (
    <div data-height={expanded ? height : 200}>
      <button data-testid={id} onClick={() => setExpanded(value => !value)}>Toggle</button>
      {expanded && <div>Details</div>}
    </div>
  );
}

function contentHeight(element: Element): number {
  if (element.hasAttribute('data-height')) return Number(element.getAttribute('data-height'));
  return Array.from(element.children).reduce((sum, child) => sum + boxHeight(child), 0);
}

function boxHeight(element: Element): number {
  const height = contentHeight(element);
  return element.classList.contains('explore-region__content')
    && element.closest('.explore-region--bounded') ? Math.min(400, height) : height;
}

// JSDOM has no layout. Deliver resize callbacks only for observed boxes whose
// supplied height changed; growing scrollHeight alone must not notify a capped box.
const observers = new Set<LayoutObserver>();
class LayoutObserver {
  private sizes = new Map<Element, number>();
  constructor(private callback: ResizeObserverCallback) { observers.add(this); }
  observe(target: Element) { this.sizes.set(target, boxHeight(target)); }
  disconnect() { this.sizes.clear(); observers.delete(this); }
  deliver() {
    const entries: ResizeObserverEntry[] = [];
    for (const [target, previousHeight] of this.sizes) {
      const height = boxHeight(target);
      if (height !== previousHeight) {
        this.sizes.set(target, height);
        entries.push({ target } as ResizeObserverEntry);
      }
    }
    if (entries.length > 0) this.callback(entries, this as unknown as ResizeObserver);
  }
}

function groupData(type: 'tool' | 'thinking' = 'tool', id = 'card'): ExploreGroupData {
  const item: FlowToolItem | FlowThinkingItem = type === 'tool'
    ? { id, type, timestamp: 1, status: 'completed', toolName: 'ReviewSessionSummary', toolCall: { id, input: {} } }
    : { id, type, timestamp: 1, status: 'completed', content: 'Thinking', isStreaming: false, isCollapsed: true };
  const text: FlowTextItem = {
    id: 'text', type: 'text', timestamp: 0, status: 'completed', content: 'Text', isStreaming: false,
  };
  return {
    groupId: 'group', rounds: [], allItems: [text, item],
    stats: { readCount: 0, searchCount: 0, commandCount: 0 },
    isGroupStreaming: false, isLastGroupInTurn: true, wasCutByCritical: false,
  };
}

describe('ExploreGroupRenderer overflow', () => {
  let container: HTMLDivElement;
  let root: Root;
  let frames: Map<number, FrameRequestCallback>;

  function flushFrame() {
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback(0));
    });
  }

  function deliverLayout() { act(() => observers.forEach(observer => observer.deliver())); }
  function group() { return container.querySelector<HTMLElement>('[data-testid="chat-explore-group"]')!; }
  function viewport() { return container.querySelector<HTMLElement>('[data-testid="chat-explore-group-content"]')!; }
  function toggle(id = 'card') {
    act(() => container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.click());
    deliverLayout();
  }
  function render(data: ExploreGroupData) {
    act(() => root.render(<ExploreGroupRenderer data={data} turnId="turn" />));
    flushFrame();
    flushFrame(); // Existing tail placement settles before child-only changes.
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    fixture.expandedGroups.set('group', true);
    fixture.expandedHeight = 400;
    frames = new Map();
    let frameId = 0;
    vi.stubGlobal('ResizeObserver', LayoutObserver);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return boxHeight(this);
    });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return contentHeight(this);
    });
    const offsets = new WeakMap<HTMLElement, number>();
    vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(function (this: HTMLElement) {
      return Math.min(offsets.get(this) ?? 0, Math.max(0, this.scrollHeight - this.clientHeight));
    });
    vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(function (this: HTMLElement, value) {
      offsets.set(this, Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)));
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    expect(observers.size).toBe(0);
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['tool', 'thinking'] as const)('updates overflow and edges when a nested %s expands and collapses at the height cap', type => {
    render(groupData(type));
    expect(viewport().clientHeight).toBe(400);
    expect(group().classList.contains('explore-region--has-scroll')).toBe(false);

    toggle();
    expect(viewport().clientHeight).toBe(400);
    expect(viewport().scrollHeight).toBe(600);
    expect(group().classList.contains('explore-region--has-scroll')).toBe(true);
    expect(group().classList.contains('explore-region--at-bottom')).toBe(false);
    expect(viewport().scrollTop).toBe(0);

    act(() => {
      viewport().scrollTop = 200;
      viewport().dispatchEvent(new Event('scroll'));
    });
    flushFrame();
    expect(group().classList.contains('explore-region--at-top')).toBe(false);
    expect(group().classList.contains('explore-region--at-bottom')).toBe(true);

    toggle();
    expect(group().classList.contains('explore-region--has-scroll')).toBe(false);
    expect(group().classList.contains('explore-region--at-top')).toBe(true);
    expect(group().classList.contains('explore-region--at-bottom')).toBe(true);
  });

  it('detects delayed content growth without a toggle or group update and preserves the reading offset', async () => {
    fixture.expandedHeight = 200;
    render(groupData());
    toggle();
    expect(group().classList.contains('explore-region--has-scroll')).toBe(false);

    await act(async () => { fixture.updateHeight.get('card')!(await Promise.resolve(600)); });
    deliverLayout();
    expect(group().classList.contains('explore-region--has-scroll')).toBe(true);
    viewport().scrollTop = 100;
    await act(async () => { fixture.updateHeight.get('card')!(await Promise.resolve(800)); });
    deliverLayout();
    expect(viewport().scrollTop).toBe(100);
    expect(group().classList.contains('explore-region--at-top')).toBe(false);
    expect(group().classList.contains('explore-region--at-bottom')).toBe(false);
  });

  it('tracks replacement items and reattached content after closing and reopening the group', () => {
    render(groupData());
    render(groupData('tool', 'replacement'));
    toggle('replacement');
    expect(group().classList.contains('explore-region--has-scroll')).toBe(true);

    fixture.expandedGroups.set('group', false);
    render(groupData());
    expect(group().classList.contains('explore-region--has-scroll')).toBe(false);
    expect(observers.size).toBe(0);
    fixture.expandedGroups.set('group', true);
    render(groupData());
    toggle();
    expect(group().classList.contains('explore-region--has-scroll')).toBe(true);
  });

  it('keeps an unbounded group in natural flow without introducing inner scrolling', () => {
    render({ ...groupData(), wasCutByCritical: true });
    toggle();
    expect(viewport().clientHeight).toBe(600);
    expect(group().classList.contains('explore-region--bounded')).toBe(false);
    expect(group().classList.contains('explore-region--has-scroll')).toBe(false);
    expect(viewport().scrollTop).toBe(0);
  });
});
