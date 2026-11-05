/**
 * @vitest-environment jsdom
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = {
    visibleOwnedBrowserTabBySession: {} as Record<string, boolean>,
    visibleTabBySession: {} as Record<string, boolean>,
  };
  return {
    state,
    switchAgentCanvasScope: vi.fn(),
    paneLayout: {
      expandSessionAuxPane: vi.fn(),
      collapseSessionAuxPane: vi.fn(),
    },
    canvasStore: {
      addTab: vi.fn(),
      switchToTab: vi.fn(),
      findTabByMetadata: vi.fn(() => null),
      updateTabContent: vi.fn(),
      closeAllTabs: vi.fn(),
      syncSessionOwnedBrowserTabs: vi.fn((sessionId: string | null) => ({
        hasVisibleOwnedBrowserTab: Boolean(
          sessionId && state.visibleOwnedBrowserTabBySession[sessionId],
        ),
        hasVisibleTab: sessionId ? state.visibleTabBySession[sessionId] ?? true : false,
      })),
      scopeKey: 'session-a' as string | undefined,
      primaryGroup: { tabs: [] },
      secondaryGroup: { tabs: [] },
      tertiaryGroup: { tabs: [] },
    },
  };
});

vi.mock('../../components/panels/content-canvas', () => ({
  ContentCanvas: ({ toolbarActions }: { toolbarActions?: React.ReactNode }) => (
    <div data-testid="content-canvas">{toolbarActions}</div>
  ),
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

vi.mock('@/features/qt-ohos-migration/hooks/useMigrationAutoOpen', () => ({
  useMigrationAutoOpen: vi.fn(),
}));

vi.mock('@/app/services/AppManager', () => ({
  appManager: {
    getState: () => ({ layout: { rightPanelCollapsed: false } }),
  },
}));

import AuxPane from './AuxPane';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';

vi.mock('./sessionPanelLayout', () => ({
  expandSessionAuxPane: mocks.paneLayout.expandSessionAuxPane,
  collapseSessionAuxPane: mocks.paneLayout.collapseSessionAuxPane,
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
    mocks.paneLayout.expandSessionAuxPane.mockReset();
    mocks.paneLayout.collapseSessionAuxPane.mockReset();
    mocks.state.visibleOwnedBrowserTabBySession = {};
    mocks.state.visibleTabBySession = {};
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

  it('offers reversible fullscreen without a duplicate hide control or closing its tabs', () => {
    const onToggleFullscreen = vi.fn();
    act(() => root.render(<AuxPane onToggleFullscreen={onToggleFullscreen} />));
    expect(container.querySelector('[aria-label="canvas.hidePanel"]')).toBeNull();
    const maximize = container.querySelector<HTMLButtonElement>('[aria-label="canvas.maximizePanel"]')!;
    expect(maximize.getAttribute('aria-pressed')).toBe('false');
    act(() => maximize.click());
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1);

    act(() => root.render(<AuxPane isFullscreen onToggleFullscreen={onToggleFullscreen} />));
    const restore = container.querySelector<HTMLButtonElement>('[aria-label="canvas.restorePanel"]')!;
    expect(restore.getAttribute('aria-pressed')).toBe('true');
    act(() => restore.click());
    expect(onToggleFullscreen).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[aria-label="canvas.hidePanel"]')).toBeNull();
    expect(mocks.canvasStore.closeAllTabs).not.toHaveBeenCalled();
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

  it('collapses an empty session pane and restores the remembered open state on return', () => {
    act(() => {
      root.render(<AuxPane />);
    });

    // Session A owned a visible browser tab and the user left the pane open.
    mocks.state.visibleOwnedBrowserTabBySession = { 'session-a': true };
    mocks.state.visibleTabBySession = { 'session-b': false };
    mocks.paneLayout.expandSessionAuxPane.mockClear();

    act(() => setActiveSession('session-b'));
    expect(mocks.paneLayout.collapseSessionAuxPane).toHaveBeenCalledTimes(1);

    act(() => setActiveSession('session-a'));
    expect(mocks.paneLayout.expandSessionAuxPane).toHaveBeenCalledTimes(1);
  });

  it('does not collapse on the first session even when it has no visible tab', () => {
    mocks.state.visibleTabBySession = { 'session-a': false };

    act(() => {
      root.render(<AuxPane />);
    });

    expect(mocks.paneLayout.collapseSessionAuxPane).not.toHaveBeenCalled();
  });
});
