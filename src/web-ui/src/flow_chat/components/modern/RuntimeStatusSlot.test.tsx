// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeStatusSlot } from './RuntimeStatusSlot';
import { useRuntimeStatusStore } from '../../store/runtimeStatusStore';
import { flowChatStore } from '../../store/FlowChatStore';
import type { DialogTurn, Session } from '../../types/flow-chat';
import { formatDuration } from '@/shared/utils/format';
import { activateSurface, getActiveSurfaceScope, LOCAL_SURFACE_ID } from '@/infrastructure/peer-device/deviceSurface';
import { registerSubmittedMessage } from '../../services/submittedMessagePresentation';

const translationMock = vi.hoisted(() => ({
  t: vi.fn((key: string, options?: Record<string, unknown>) => (
    key === 'elapsed' ? `${String(options?.duration ?? '')} elapsed` : ['Working on it']
  )),
  i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
  ready: true,
}));

vi.mock('@bitfun/ui', () => ({
  Spinner: () => <span data-testid="dot-matrix" />,
  OverflowText: ({ children, behavior: _behavior, marqueeActive: _marqueeActive, ...props }: any) => <span {...props}>{children}</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => translationMock,
  // FlowChatStore pulls in I18nService, which registers the plugin at import time.
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

describe('RuntimeStatusSlot', () => {
  let container: HTMLDivElement;
  let root: Root;

  const seedRunningTurn = (status: DialogTurn['status'], startTime: number) => {
    const session = {
      sessionId: 'session-1',
      dialogTurns: [{
        id: 'turn-1',
        sessionId: 'session-1',
        userMessage: { id: 'user-1', content: 'hello', timestamp: startTime - 10 },
        modelRounds: [],
        status,
        startTime,
      }],
    } as unknown as Session;
    flowChatStore.setState(() => ({
      sessions: new Map([[session.sessionId, session]]),
      activeSessionId: session.sessionId,
    }));
  };

  const settleTurn = () => {
    flowChatStore.setState(state => {
      const session = state.sessions.get('session-1')!;
      return {
        ...state,
        sessions: new Map(state.sessions).set('session-1', {
          ...session,
          dialogTurns: session.dialogTurns.map(turn => ({ ...turn, status: 'completed' as const })),
        }),
      };
    });
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    activateSurface(LOCAL_SURFACE_ID);
    useRuntimeStatusStore.getState().reset();
    flowChatStore.setState(() => ({ sessions: new Map(), activeSessionId: null }));
    translationMock.t.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    flowChatStore.setState(() => ({ sessions: new Map(), activeSessionId: null }));
    activateSurface(LOCAL_SURFACE_ID);
    vi.useRealTimers();
  });

  it('defers only initial status paint and cancels the delay when a quick reply clears it', () => {
    act(() => root.render(<RuntimeStatusSlot sessionId="session-1" />));
    const slot = container.querySelector<HTMLElement>('.runtime-status-slot')!;
    const content = slot.querySelector<HTMLElement>('.runtime-status-slot__content')!;
    registerSubmittedMessage(getActiveSurfaceScope(), 'session-1', 'turn-1', 'message-1');
    act(() => useRuntimeStatusStore.getState().show({
      sessionId: 'session-1', turnId: 'turn-1', roundId: 'round-1',
    }));
    expect(content.style.transitionDelay).toBe('160ms');
    expect(useRuntimeStatusStore.getState().bySessionId.has('session-1')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(50);
      useRuntimeStatusStore.getState().clear({ sessionId: 'session-1' });
    });
    expect(slot.dataset.runtimeStatusVisible).toBe('false');
    expect(content.style.transitionDelay).toBe('');
    act(() => vi.advanceTimersByTime(300));
    expect(slot.dataset.runtimeStatusVisible).toBe('false');
    expect(container.querySelector('.runtime-status-slot')).toBe(slot);
  });

  it('keeps the same fixed slot mounted while visibility changes', () => {
    act(() => {
      root.render(<RuntimeStatusSlot sessionId="session-1" placement="footer" />);
    });
    const slot = container.querySelector<HTMLElement>('.runtime-status-slot');
    const iconSlot = container.querySelector('[data-bitfun-part="leadingIcon"]');
    expect(iconSlot?.querySelector('[data-bitfun-component="spinner"]')).not.toBeNull();
    expect(slot).not.toBeNull();
    expect(slot?.dataset.runtimeStatusVisible).toBe('false');

    act(() => {
      useRuntimeStatusStore.getState().show({
        sessionId: 'session-1',
        turnId: 'turn-1',
        roundId: 'round-1',
      });
    });
    expect(container.querySelector('.runtime-status-slot')).toBe(slot);
    expect(slot?.dataset.runtimeStatusVisible).toBe('true');
    expect(slot?.textContent).toContain('Working on it');

    act(() => {
      useRuntimeStatusStore.getState().show({
        sessionId: 'session-1',
        turnId: 'dispatch-turn',
        roundId: 'dispatch-transfer:job-1',
        label: 'Transferring workspace',
      });
    });
    expect(slot?.textContent).toContain('Transferring workspace');
    expect(container.querySelector('[data-bitfun-part="leadingIcon"]')).toBe(iconSlot);

    act(() => {
      useRuntimeStatusStore.getState().clear({ sessionId: 'session-1' });
    });
    expect(container.querySelector('.runtime-status-slot')).toBe(slot);
    expect(slot?.dataset.runtimeStatusVisible).toBe('false');
    expect(container.querySelector('[data-bitfun-part="leadingIcon"]')).toBe(iconSlot);
  });

  it('only translates generated hints when an unlabeled status is visible', () => {
    translationMock.i18n.language = 'test-hints';
    translationMock.i18n.resolvedLanguage = 'test-hints';
    act(() => root.render(<RuntimeStatusSlot sessionId="session-1" />));
    expect(translationMock.t).not.toHaveBeenCalled();

    act(() => useRuntimeStatusStore.getState().show({
      sessionId: 'session-1', turnId: 'turn-1', roundId: 'round-1',
    }));
    expect(translationMock.t).toHaveBeenCalledTimes(1);

    act(() => useRuntimeStatusStore.getState().show({
      sessionId: 'session-1', turnId: 'turn-2', roundId: 'round-2',
    }));
    expect(translationMock.t).toHaveBeenCalledTimes(1);

    act(() => useRuntimeStatusStore.getState().show({
      sessionId: 'session-1',
      turnId: 'turn-3',
      roundId: 'round-3',
      label: 'Transferring workspace',
    }));
    expect(translationMock.t).toHaveBeenCalledTimes(1);
  });

  it('times the whole turn from the turn ledger and drops the clock once the turn settles', () => {
    // A round-scoped status is already gone here: the reply is streaming, which
    // is exactly the stretch the live clock has to cover.
    seedRunningTurn('processing', Date.now() - 12_000);
    act(() => root.render(<RuntimeStatusSlot sessionId="session-1" placement="footer" />));

    const slot = container.querySelector<HTMLElement>('.runtime-status-slot')!;
    const elapsed = () => container.querySelector<HTMLElement>('[data-bitfun-part="elapsed"]');
    expect(slot.dataset.runtimeStatusVisible).toBe('true');
    expect(elapsed()?.textContent).toBe(`${formatDuration(12_000, 'live')} elapsed`);

    act(() => vi.advanceTimersByTime(1000));
    expect(elapsed()?.textContent).toBe(`${formatDuration(13_000, 'live')} elapsed`);

    act(() => settleTurn());
    expect(elapsed()).toBeNull();
    expect(slot.dataset.runtimeStatusVisible).toBe('false');
    expect(container.querySelector('.runtime-status-slot')).toBe(slot);
  });

  it('does not flash a clock for a turn that finishes within a second', () => {
    seedRunningTurn('pending', Date.now() - 200);
    act(() => root.render(<RuntimeStatusSlot sessionId="session-1" />));
    expect(container.querySelector('[data-bitfun-part="elapsed"]')).toBeNull();

    act(() => settleTurn());
    expect(container.querySelector('[data-bitfun-part="elapsed"]')).toBeNull();
  });
});
