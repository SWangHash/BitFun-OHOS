/**
 * @vitest-environment jsdom
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workspaceId: 'workspace-a' as string | undefined,
  workspaceEventListener: null as ((event: any) => void) | null,
  removeWorkspaceEventListener: vi.fn(),
  switchAgentCanvasWorkspace: vi.fn(),
  removeAgentCanvasSnapshot: vi.fn(),
  expandSessionAuxPane: vi.fn(),
  collapseSessionAuxPane: vi.fn(),
  canvasStore: {
    addTab: vi.fn(),
    switchToTab: vi.fn(),
    findTabByMetadata: vi.fn(() => null),
    updateTabContent: vi.fn(),
    closeAllTabs: vi.fn(),
    syncSessionOwnedBrowserTabs: vi.fn(),
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
  switchAgentCanvasWorkspace: mocks.switchAgentCanvasWorkspace,
  removeAgentCanvasSnapshot: mocks.removeAgentCanvasSnapshot,
}));

vi.mock('@/infrastructure/contexts/WorkspaceContext', () => ({
  useCurrentWorkspace: () => ({
    workspace: mocks.workspaceId ? { id: mocks.workspaceId } : null,
  }),
}));

vi.mock('@/infrastructure/services/business/workspaceManager', () => ({
  workspaceManager: {
    addEventListener: (listener: (event: any) => void) => {
      mocks.workspaceEventListener = listener;
      return mocks.removeWorkspaceEventListener;
    },
  },
}));

vi.mock('@/infrastructure/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
  i18nService: { t: (key: string) => key },
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
  }),
}));

vi.mock('@/features/qt-ohos-migration/hooks/useMigrationAutoOpen', () => ({
  useMigrationAutoOpen: () => undefined,
}));

import AuxPane from './AuxPane';

vi.mock('./sessionPanelLayout', () => ({
  expandSessionAuxPane: mocks.expandSessionAuxPane,
  collapseSessionAuxPane: mocks.collapseSessionAuxPane,
}));

import { appManager } from '@/app/services/AppManager';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('AuxPane workspace canvas switching', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.workspaceId = 'workspace-a';
    mocks.workspaceEventListener = null;
    mocks.removeWorkspaceEventListener.mockReset();
    mocks.switchAgentCanvasWorkspace.mockReset();
    mocks.removeAgentCanvasSnapshot.mockReset();
    mocks.expandSessionAuxPane.mockReset();
    mocks.collapseSessionAuxPane.mockReset();
    mocks.canvasStore.syncSessionOwnedBrowserTabs.mockReset()
      .mockReturnValue({ hasVisibleOwnedBrowserTab: false, hasVisibleTab: false });
    flowChatStore.setState(state => ({ ...state, activeSessionId: null }));
    appManager.updateLayout({ chatCollapsed: false, rightPanelCollapsed: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    flowChatStore.setState(state => ({ ...state, activeSessionId: null }));
    container.remove();
  });

  it('swaps canvas snapshots synchronously before the target review tab can open', () => {
    act(() => {
      root.render(<AuxPane />);
    });

    expect(mocks.switchAgentCanvasWorkspace).toHaveBeenCalledWith(null, 'workspace-a');
    mocks.switchAgentCanvasWorkspace.mockClear();

    const order: string[] = [];
    mocks.switchAgentCanvasWorkspace.mockImplementation(() => {
      order.push('canvas-swapped');
    });

    act(() => {
      mocks.workspaceEventListener?.({
        type: 'workspace:switched',
        workspace: { id: 'workspace-b' },
      });
      order.push('open-target-review');
    });

    expect(mocks.switchAgentCanvasWorkspace).toHaveBeenCalledWith(
      'workspace-a',
      'workspace-b',
    );
    expect(order).toEqual(['canvas-swapped', 'open-target-review']);

    act(() => {
      mocks.workspaceEventListener?.({
        type: 'workspace:active-changed',
        workspace: { id: 'workspace-b' },
      });
    });

    expect(mocks.switchAgentCanvasWorkspace).toHaveBeenCalledTimes(1);
  });

  it('reopens a session browser panel that was auto-collapsed while another session was active', () => {
    mocks.canvasStore.syncSessionOwnedBrowserTabs.mockImplementation(sessionId => ({
      hasVisibleOwnedBrowserTab: sessionId === 'session-a',
      hasVisibleTab: sessionId === 'session-a',
    }));
    flowChatStore.setState(state => ({ ...state, activeSessionId: 'session-a' }));
    appManager.updateLayout({ rightPanelCollapsed: false });

    act(() => root.render(<AuxPane />));
    act(() => {
      flowChatStore.setState(state => ({ ...state, activeSessionId: 'session-b' }));
    });
    appManager.updateLayout({ rightPanelCollapsed: true });
    mocks.expandSessionAuxPane.mockClear();

    act(() => {
      flowChatStore.setState(state => ({ ...state, activeSessionId: 'session-a' }));
    });

    expect(mocks.expandSessionAuxPane).toHaveBeenCalledTimes(1);
  });

  it('does not reopen a session browser panel that the user had collapsed', () => {
    mocks.canvasStore.syncSessionOwnedBrowserTabs.mockImplementation(sessionId => ({
      hasVisibleOwnedBrowserTab: sessionId === 'session-a',
      hasVisibleTab: sessionId === 'session-a',
    }));
    flowChatStore.setState(state => ({ ...state, activeSessionId: 'session-a' }));

    act(() => root.render(<AuxPane />));
    act(() => {
      flowChatStore.setState(state => ({ ...state, activeSessionId: 'session-b' }));
      flowChatStore.setState(state => ({ ...state, activeSessionId: 'session-a' }));
    });

    expect(mocks.expandSessionAuxPane).not.toHaveBeenCalled();
  });

  it('collapses an empty cross-workspace session and restores the original browser panel', () => {
    let canvasWorkspace = 'workspace-a';
    mocks.switchAgentCanvasWorkspace.mockImplementation((_previous, next) => {
      canvasWorkspace = next;
    });
    mocks.canvasStore.syncSessionOwnedBrowserTabs.mockImplementation(sessionId => ({
      hasVisibleOwnedBrowserTab: sessionId === 'session-a' && canvasWorkspace === 'workspace-a',
      hasVisibleTab: sessionId === 'session-a' && canvasWorkspace === 'workspace-a',
    }));
    flowChatStore.setState(state => ({ ...state, activeSessionId: 'session-a' }));
    appManager.updateLayout({ rightPanelCollapsed: false });

    act(() => root.render(<AuxPane />));
    act(() => {
      mocks.workspaceEventListener?.({
        type: 'workspace:switched',
        workspace: { id: 'workspace-b' },
      });
      flowChatStore.setState(state => ({ ...state, activeSessionId: 'session-b' }));
    });

    expect(mocks.collapseSessionAuxPane).toHaveBeenCalledTimes(1);

    appManager.updateLayout({ rightPanelCollapsed: true });
    mocks.expandSessionAuxPane.mockClear();
    act(() => {
      mocks.workspaceEventListener?.({
        type: 'workspace:switched',
        workspace: { id: 'workspace-a' },
      });
      flowChatStore.setState(state => ({ ...state, activeSessionId: 'session-a' }));
    });

    expect(mocks.expandSessionAuxPane).toHaveBeenCalledTimes(1);
  });

  it('restores the browser panel when the session changes before its workspace snapshot', () => {
    let canvasWorkspace = 'workspace-a';
    mocks.switchAgentCanvasWorkspace.mockImplementation((_previous, next) => {
      canvasWorkspace = next;
    });
    mocks.canvasStore.syncSessionOwnedBrowserTabs.mockImplementation(sessionId => ({
      hasVisibleOwnedBrowserTab: sessionId === 'session-a' && canvasWorkspace === 'workspace-a',
      hasVisibleTab: sessionId === 'session-a' && canvasWorkspace === 'workspace-a',
    }));
    flowChatStore.setState(state => ({ ...state, activeSessionId: 'session-a' }));
    appManager.updateLayout({ rightPanelCollapsed: false });

    act(() => root.render(<AuxPane />));
    act(() => {
      flowChatStore.setState(state => ({ ...state, activeSessionId: 'session-b' }));
      mocks.workspaceEventListener?.({
        type: 'workspace:switched',
        workspace: { id: 'workspace-b' },
      });
    });
    appManager.updateLayout({ rightPanelCollapsed: true });
    mocks.expandSessionAuxPane.mockClear();

    act(() => {
      flowChatStore.setState(state => ({ ...state, activeSessionId: 'session-a' }));
    });
    expect(mocks.expandSessionAuxPane).not.toHaveBeenCalled();

    act(() => {
      mocks.workspaceEventListener?.({
        type: 'workspace:switched',
        workspace: { id: 'workspace-a' },
      });
    });
    expect(mocks.expandSessionAuxPane).toHaveBeenCalledTimes(1);
  });

  it('keeps the panel open when the target session still has other visible content', () => {
    mocks.canvasStore.syncSessionOwnedBrowserTabs.mockImplementation(sessionId => ({
      hasVisibleOwnedBrowserTab: sessionId === 'session-a',
      hasVisibleTab: true,
    }));
    flowChatStore.setState(state => ({ ...state, activeSessionId: 'session-a' }));
    appManager.updateLayout({ rightPanelCollapsed: false });

    act(() => root.render(<AuxPane />));
    act(() => {
      mocks.workspaceEventListener?.({
        type: 'workspace:switched',
        workspace: { id: 'workspace-b' },
      });
      flowChatStore.setState(state => ({ ...state, activeSessionId: 'session-b' }));
    });

    expect(mocks.collapseSessionAuxPane).not.toHaveBeenCalled();
  });
});
