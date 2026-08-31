import { afterEach, describe, expect, it } from 'vitest';
import {
  cacheAgentCanvasTabForWorkspace,
  clearAgentCanvasForPeerSwitch,
  switchAgentCanvasWorkspace,
  useAgentCanvasStore,
} from './canvasStore';

describe('Agent canvas workspace routing', () => {
  afterEach(() => {
    clearAgentCanvasForPeerSwitch();
  });

  it('caches a browser tab for its owner without changing the visible workspace', () => {
    clearAgentCanvasForPeerSwitch();
    switchAgentCanvasWorkspace(null, 'project-workspace');

    cacheAgentCanvasTabForWorkspace('assistant-workspace', {
      content: {
        type: 'browser',
        title: 'Assistant browser',
        data: { url: 'https://example.com', ownerWorkspaceId: 'assistant-workspace' },
        metadata: { duplicateCheckKey: 'browser:assistant' },
      },
      checkDuplicate: true,
      duplicateCheckKey: 'browser:assistant',
    });

    expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(0);

    switchAgentCanvasWorkspace('project-workspace', 'assistant-workspace');
    const tabs = useAgentCanvasStore.getState().primaryGroup.tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.content.data).toMatchObject({
      ownerWorkspaceId: 'assistant-workspace',
      url: 'https://example.com',
    });
  });

  it('keeps Agent browser tabs isolated by their owner session', () => {
    const store = useAgentCanvasStore.getState();
    store.addTab({
      type: 'browser',
      title: 'Session one browser',
      data: { url: 'https://one.example', ownerSessionId: 'session-1' },
    }, 'active');
    store.addTab({
      type: 'browser',
      title: 'Session two browser',
      data: { url: 'https://two.example', ownerSessionId: 'session-2' },
    }, 'active');
    store.addTab({
      type: 'browser',
      title: 'Workspace HTML preview',
      data: { html: '<h1>Preview</h1>' },
    }, 'active');

    store.syncSessionOwnedBrowserTabs('session-1');
    let state = useAgentCanvasStore.getState();
    let sessionOne = state.primaryGroup.tabs.find(tab => tab.content.data?.ownerSessionId === 'session-1');
    let sessionTwo = state.primaryGroup.tabs.find(tab => tab.content.data?.ownerSessionId === 'session-2');
    const workspacePreview = state.primaryGroup.tabs.find(tab => tab.content.data?.html);
    expect(sessionOne?.isHidden).toBe(false);
    expect(sessionTwo?.isHidden).toBe(true);
    expect(workspacePreview?.isHidden).not.toBe(true);

    state.switchToTab(sessionOne!.id, 'primary');
    state.syncSessionOwnedBrowserTabs('session-2');
    state = useAgentCanvasStore.getState();
    sessionOne = state.primaryGroup.tabs.find(tab => tab.content.data?.ownerSessionId === 'session-1');
    sessionTwo = state.primaryGroup.tabs.find(tab => tab.content.data?.ownerSessionId === 'session-2');
    expect(sessionOne?.isHidden).toBe(true);
    expect(sessionTwo?.isHidden).toBe(false);
    expect(state.primaryGroup.activeTabId).toBe(sessionTwo?.id);
  });
});
