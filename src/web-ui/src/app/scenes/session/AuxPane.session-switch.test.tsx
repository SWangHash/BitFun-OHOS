/**
 * @vitest-environment jsdom
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  switchAgentCanvasScope: vi.fn(),
  canvasStore: {
    addTab: vi.fn(),
    switchToTab: vi.fn(),
    findTabByMetadata: vi.fn(() => null),
    updateTabContent: vi.fn(),
    closeAllTabs: vi.fn(),
    scopeKey: 'session-a' as string | undefined,
    primaryGroup: { tabs: [] },
    secondaryGroup: { tabs: [] },
    tertiaryGroup: { tabs: [] },
  },
}));

vi.mock('../../components/panels/content-canvas', () => ({
  ContentCanvas: () => <div data-testid="content-canvas" />,
  useCanvasStore: (selector: (state: typeof mocks.canvasStore) => unknown) => (
    selector(mocks.canvasStore)
  ),
}));

vi.mock('../../components/panels/content-canvas/stores', () => ({
  switchAgentCanvasScope: mocks.switchAgentCanvasScope,
}));

vi.mock('@/infrastructure/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
  }),
}));

import AuxPane from './AuxPane';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';

vi.mock('./sessionPanelLayout', () => ({
  expandSessionAuxPane: vi.fn(),
  collapseSessionAuxPane: vi.fn(),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function setActiveSession(sessionId: string | null): void {
  flowChatStore.setState(state => ({ ...state, activeSessionId: sessionId }));
}

describe('AuxPane session canvas switching', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.switchAgentCanvasScope.mockReset();
    setActiveSession('session-a');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    setActiveSession(null);
  });

  it('scopes the canvas to the active session on mount', () => {
    act(() => {
      root.render(<AuxPane />);
    });

    expect(mocks.switchAgentCanvasScope).toHaveBeenCalledWith('session-a');
  });

  it('swaps canvas snapshots synchronously before the target session content can open', () => {
    act(() => {
      root.render(<AuxPane />);
    });
    mocks.switchAgentCanvasScope.mockClear();

    const order: string[] = [];
    mocks.switchAgentCanvasScope.mockImplementation(() => {
      order.push('canvas-swapped');
    });

    act(() => {
      setActiveSession('session-b');
      order.push('open-target-content');
    });

    expect(mocks.switchAgentCanvasScope).toHaveBeenCalledWith('session-b');
    expect(order).toEqual(['canvas-swapped', 'open-target-content']);
  });

  it('ignores store updates that keep the same active session and swaps back on return', () => {
    act(() => {
      root.render(<AuxPane />);
    });
    mocks.switchAgentCanvasScope.mockClear();

    act(() => setActiveSession('session-b'));
    act(() => setActiveSession('session-b'));

    expect(mocks.switchAgentCanvasScope).toHaveBeenCalledTimes(1);

    act(() => setActiveSession('session-a'));

    expect(mocks.switchAgentCanvasScope).toHaveBeenLastCalledWith('session-a');
    expect(mocks.switchAgentCanvasScope).toHaveBeenCalledTimes(2);
  });
});
