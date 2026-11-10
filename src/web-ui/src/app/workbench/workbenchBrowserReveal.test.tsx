// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WorkbenchLayout from './WorkbenchLayout';
import { useSceneStore } from '../stores/sceneStore';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { startSessionPaneLayoutSync } from '../scenes/session/sessionPaneLayoutSync';
import { sessionPaneLayoutStore, selectSessionPaneMode } from '../scenes/session/sessionPaneLayoutStore';
import { clearAgentCanvasForPeerSwitch, openAgentCanvasTabForSessionInBackground,
  useAgentCanvasStore } from '../components/panels/content-canvas/stores/canvasStore';
import { activateSurface } from '@/infrastructure/peer-device/deviceSurface';

vi.mock('@/infrastructure/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }),
  i18nService: { t: (key: string) => key } }));
vi.mock('../components/SceneTopBar', () => ({ SceneTopBar: () => null }));
vi.mock('../components/SceneBar/SceneBar', () => ({ default: () => null }));
vi.mock('../components/panels/content-canvas/CanvasToolbar', () => ({
  CanvasToolbarHost: () => null, CanvasToolbarProvider: ({ children }: React.PropsWithChildren) => children,
}));
vi.mock('../components/panels/content-canvas', async () => {
  const { useAgentCanvasStore } = await import('../components/panels/content-canvas/stores/canvasStore');
  return { useCanvasStore: useAgentCanvasStore, ContentCanvas: () => <div data-testid="canvas-content" /> };
});
vi.mock('@/features/qt-ohos-migration/hooks/useMigrationAutoOpen', () => ({ useMigrationAutoOpen: () => {} }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, stop: () => void;
const mode = () => selectSessionPaneMode(sessionPaneLayoutStore.getState());
const select = (sessionId: string, workspaceKey: string, surfaceId = 'local') => {
  // Match the production activation order: the session owner commits before
  // the scene navigation transaction publishes its pane selection.
  flowChatStore.setState(state => ({ ...state, activeSessionId: sessionId }));
  useSceneStore.getState().openSessionScene({ surfaceId, workspaceKey, sessionId });
};

beforeEach(() => {
  activateSurface('local');
  useSceneStore.getState().resetForPeerSwitch();
  sessionPaneLayoutStore.setState(sessionPaneLayoutStore.getInitialState());
  clearAgentCanvasForPeerSwitch();
  flowChatStore.setState(state => ({ ...state, activeSessionId: null, sessions: new Map() }));
  stop = startSessionPaneLayoutSync();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); stop(); host.remove();
  clearAgentCanvasForPeerSwitch(); useSceneStore.getState().resetForPeerSwitch();
  flowChatStore.setState(state => ({ ...state, activeSessionId: null }));
  activateSurface('local'); vi.unstubAllGlobals();
});

it.each(['local', 'peer-host'])('reveals a background browser on return, preserves manual collapse and isolates sessions on %s', async surfaceId => {
  activateSurface(surfaceId);
  select('session-b', 'project-b', surfaceId);
  await act(async () => root.render(<WorkbenchLayout><textarea defaultValue="unsent B draft" /></WorkbenchLayout>));
  const draft = host.querySelector('textarea')!;
  draft.focus();
  await act(async () => openAgentCanvasTabForSessionInBackground('session-a', { content: {
    type: 'browser', title: 'A browser', data: { url: 'https://example.com', ownerSessionId: 'session-a' },
  } }));
  expect(mode()).toBe('chat-only');
  expect(flowChatStore.getState().activeSessionId).toBe('session-b');
  expect(document.activeElement).toBe(draft);
  expect(draft.value).toBe('unsent B draft');

  await act(async () => select('session-a', 'project-a', surfaceId));
  expect(mode()).toBe('split');
  const tab = useAgentCanvasStore.getState().primaryGroup.tabs[0]!;
  expect(tab.isHidden).toBe(false);
  expect(tab.content.metadata?.pendingSessionReveal).toBeUndefined();
  expect(useAgentCanvasStore.getState().primaryGroup.activeTabId).toBe(tab.id);
  expect(useSceneStore.getState().paneSelections.secondary.kind).toBe('canvas');

  await act(async () => sessionPaneLayoutStore.getState().hideContent());
  await act(async () => select('session-b', 'project-b', surfaceId));
  expect(mode()).toBe('chat-only');
  await act(async () => sessionPaneLayoutStore.getState().showContent());
  await act(async () => select('session-a', 'project-a', surfaceId));
  expect(mode()).toBe('chat-only');
  expect(useAgentCanvasStore.getState().primaryGroup.tabs[0]!.id).toBe(tab.id);
});
