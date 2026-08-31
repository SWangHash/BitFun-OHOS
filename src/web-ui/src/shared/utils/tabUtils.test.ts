// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enqueuePendingTab: vi.fn(),
  openScene: vi.fn(),
  openTabs: [] as Array<{ id: string }>,
}));

vi.mock('@/infrastructure/i18n', () => ({
  i18nService: { getT: () => (key: string) => key },
}));

vi.mock('@/shared/services/FileTabManager', () => ({
  fileTabManager: { openFile: vi.fn() },
}));

vi.mock('@/shared/services/pendingTabQueue', () => ({
  enqueuePendingTab: (...args: unknown[]) => mocks.enqueuePendingTab(...args),
}));

vi.mock('@/shared/services/sceneOpenTargetResolver', () => ({
  resolveAndFocusOpenTarget: vi.fn(),
}));

vi.mock('@/app/stores/sceneStore', () => ({
  useSceneStore: {
    getState: () => ({
      openTabs: mocks.openTabs,
      openScene: (...args: unknown[]) => mocks.openScene(...args),
    }),
  },
}));

import { createTab } from './tabUtils';

describe('createTab ensureVisible', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.enqueuePendingTab.mockReset();
    mocks.openScene.mockReset();
    mocks.openTabs = [{ id: 'session' }];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('activates the session scene and expands the panel before dispatching', () => {
    const events: string[] = [];
    const listener = (event: Event) => events.push(event.type);
    window.addEventListener('expand-right-panel', listener);
    window.addEventListener('agent-create-tab', listener);

    createTab({
      type: 'browser',
      title: 'Browser',
      data: { url: 'https://example.com' },
      mode: 'agent',
      ensureVisible: true,
    });

    expect(mocks.openScene).toHaveBeenCalledWith('session');
    expect(events).toEqual(['expand-right-panel']);
    vi.advanceTimersByTime(300);
    expect(events).toEqual(['expand-right-panel', 'agent-create-tab']);

    window.removeEventListener('expand-right-panel', listener);
    window.removeEventListener('agent-create-tab', listener);
  });

  it('queues the tab when the session scene has not mounted yet', () => {
    mocks.openTabs = [];

    createTab({
      type: 'browser',
      title: 'Browser',
      data: { url: 'https://example.com' },
      mode: 'agent',
      ensureVisible: true,
    });

    expect(mocks.openScene).toHaveBeenCalledWith('session');
    expect(mocks.enqueuePendingTab).toHaveBeenCalledWith(
      'agent',
      expect.objectContaining({ type: 'browser' }),
    );
  });
});
