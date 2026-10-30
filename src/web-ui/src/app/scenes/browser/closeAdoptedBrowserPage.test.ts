// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeAdoptedBrowserPage, closedBrowserContent } from './closeAdoptedBrowserPage';
import { useAgentCanvasStore, switchAgentCanvasWorkspace, clearAgentCanvasForPeerSwitch } from '@/app/components/panels/content-canvas/stores/canvasStore';
import { useContentResourceStore } from '@/app/workbench/contentResourceStore';
import type { PanelContent } from '@/shared/types/panelContent';

const mocks = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/infrastructure/api/service-api/ApiClient', () => ({ api: { invoke: mocks.invoke } }));
vi.mock('@/shared/utils/logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }));
const page = (label = 'embedded-browser-panel-view-agent-test'): PanelContent => ({
  type: 'browser', title: 'Form', data: { url: 'https://example.com', adoptExisting: true, webviewLabel: label, automationId: 'test' },
});
const settle = () => vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalled(), { timeout: 1000 });

describe('adopted browser page ownership', () => {
  beforeEach(() => {
    mocks.invoke.mockClear();
    clearAgentCanvasForPeerSwitch();
    useContentResourceStore.setState({ resources: {} });
  });

  it('closes the exact native page when its last canvas tab is explicitly removed', async () => {
    const store = useAgentCanvasStore.getState();
    store.addTab(page(), 'active', 'primary');
    const tab = useAgentCanvasStore.getState().primaryGroup.tabs[0];
    store.closeTab(tab.id, 'primary');
    await settle();
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('browser_webview_close', {
      request: { label: 'embedded-browser-panel-view-agent-test' },
    });
    const history = useAgentCanvasStore.getState().closedTabs[0].tab.content;
    expect(history.data.adoptExisting).toBeUndefined();
    expect(history.data.webviewLabel).toBeUndefined();
    expect(history.data.url).toBe('https://example.com');
  });

  it('closes unpinned pages on close-all while retaining pinned native pages', async () => {
    const store = useAgentCanvasStore.getState();
    store.addTab(page('embedded-browser-panel-view-agent-a'), 'active', 'primary');
    store.addTab(page('embedded-browser-panel-view-agent-b'), 'active', 'primary');
    store.addTab(page('embedded-browser-panel-view-agent-pinned'), 'pinned', 'primary');
    expect(useAgentCanvasStore.getState().primaryGroup.tabs.filter(tab => tab.state !== 'pinned')).toHaveLength(2);
    store.closeAllTabs();
    await vi.waitFor(() => expect(mocks.invoke.mock.calls.map(call => call[1].request.label).sort()).toEqual([
      'embedded-browser-panel-view-agent-a', 'embedded-browser-panel-view-agent-b',
    ]));
    expect(mocks.invoke.mock.calls.map(call => call[1].request.label).sort()).toEqual([
      'embedded-browser-panel-view-agent-a', 'embedded-browser-panel-view-agent-b',
    ]);
  });

  it('preserves native pages while switching workspaces or transferring a tab', async () => {
    switchAgentCanvasWorkspace(null, 'project-a');
    const store = useAgentCanvasStore.getState();
    store.addTab(page(), 'active', 'primary');
    switchAgentCanvasWorkspace('project-a', 'project-b');
    switchAgentCanvasWorkspace('project-b', 'project-a');
    const tab = useAgentCanvasStore.getState().primaryGroup.tabs[0];
    store.detachTab(tab.id, 'primary');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('closes pages when a main workbench resource is explicitly removed', async () => {
    const store = useContentResourceStore.getState();
    const id = store.open(page(), { surfaceId: 'local', workspaceId: 'project-a' });
    store.remove(id);
    await settle();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it('never closes an inactive peer label on the controller', async () => {
    closeAdoptedBrowserPage(page(), 'peer-other');
    closeAdoptedBrowserPage({ type: 'browser', title: 'Legacy', data: { url: 'https://example.com' } });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(closedBrowserContent(page()).data.url).toBe('https://example.com');
  });
});
