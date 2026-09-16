import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

function renderHook<P, R>(hook: (props: P) => R, options?: { initialProps: P }) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.createElement('div'));
  const result = {} as { current: R };
  let props = options?.initialProps as P;
  function View() { result.current = hook(props); return null; }
  const render = () => act(() => root.render(createElement(View)));
  render();
  return { result, rerender(next: P) { props = next; render(); },
    unmount() { act(() => root.unmount()); dom.window.close(); } };
}
import { afterEach, describe, expect, it, vi } from 'vitest';

const events = vi.hoisted(() => new Map<string, (event: any) => void>());
vi.mock('@/infrastructure/api/service-api/ACPClientAPI', () => ({
  ACPClientAPI: { onPlanUpdated: (callback: (event: any) => void) => {
    events.set('plan', callback);
    return () => events.delete('plan');
  } },
}));
vi.mock('@/infrastructure/api/service-api/AgentAPI', () => ({
  agentAPI: Object.fromEntries(['Completed', 'Cancelled', 'Failed'].map((name) => [
    `onDialogTurn${name}`, (callback: (event: any) => void) => {
      events.set(name, callback);
      return () => events.delete(name);
    },
  ])),
}));

import { initializeAcpPlanState } from '../services/acpPlanState';
import { useAcpPlan } from './useAcpPlan';

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); events.clear(); vi.unstubAllGlobals(); });
const emitPlan = (status: string, turnId = 'turn-a') => {
  events.get('plan')!({ sessionId: 'a', turnId, clientId: 'client',
    entries: [{ content: 'step', priority: 'medium', status }] });
};

describe('ACP plan session lifetime', () => {
  it('retains plans across switching and receives progress with no mounted view', () => {
    cleanup = initializeAcpPlanState();
    const view = renderHook(({ sessionId }) => useAcpPlan(sessionId), {
      initialProps: { sessionId: 'a' as string | null },
    });
    act(() => emitPlan('pending'));
    view.rerender({ sessionId: 'b' });
    expect(view.result.current.entries).toEqual([]);
    view.rerender({ sessionId: 'a' });
    expect(view.result.current.entries[0].status).toBe('pending');
    view.unmount();
    act(() => emitPlan('in_progress'));
    const restored = renderHook(() => useAcpPlan('a'));
    expect(restored.result.current.entries[0].status).toBe('in_progress');
    restored.unmount();
  });

  it.each(['Completed', 'Cancelled', 'Failed'])('clears a background turn on %s without clearing a newer turn', (event) => {
    cleanup = initializeAcpPlanState();
    emitPlan('pending', 'new-turn');
    events.get(event)!({ sessionId: 'a', turnId: 'old-turn' });
    const view = renderHook(() => useAcpPlan('a'));
    expect(view.result.current.entries).toHaveLength(1);
    view.unmount();
    events.get(event)!({ sessionId: 'a', turnId: 'new-turn' });
    const restored = renderHook(() => useAcpPlan('a'));
    expect(restored.result.current.entries).toEqual([]);
    restored.unmount();
  });
});
