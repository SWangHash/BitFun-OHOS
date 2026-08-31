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
});
