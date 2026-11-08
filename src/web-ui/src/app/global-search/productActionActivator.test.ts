// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSceneStore } from '@/app/stores/sceneStore';
import { activateProductAction } from './productActionActivator';

vi.mock('@/infrastructure/services/business/workspaceManager', () => ({
  workspaceManager: {
    getState: () => ({ currentWorkspace: null, openedWorkspaces: new Map(), recentWorkspaces: [] }),
    openWorkspace: vi.fn(),
  },
}));

describe('activateProductAction browser surface', () => {
  afterEach(() => vi.restoreAllMocks());

  it('routes the browser into the workbench content pane without an open session', async () => {
    const details: unknown[] = [];
    const listener = (event: Event) => details.push((event as CustomEvent).detail);
    window.addEventListener('agent-create-tab', listener);
    try {
      await activateProductAction('surface.browser.open', { t: () => 'Browser' });
    } finally {
      window.removeEventListener('agent-create-tab', listener);
    }

    // The workbench owns the destination; navigating to a top-level browser
    // scene would replace the center scene and skip the content pane.
    expect(details).toEqual([expect.objectContaining({
      type: 'browser', title: 'Browser', duplicateCheckKey: 'browser-panel',
    })]);
    expect(useSceneStore.getState().openTabs).toHaveLength(0);
  });
});
