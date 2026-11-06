// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSessionSceneNavigation, useSceneStore } from '../stores/sceneStore';
import { useContentResourceStore } from './contentResourceStore';
import { registerContentCloseGuard } from './contentResourceLifecycle';
import { fileTabManager } from '@/shared/services/FileTabManager';
import { openFileInBestTarget, createTerminalTab, createGitCodeEditorTab, createCodeEditorTab, createTab } from '@/shared/utils/tabUtils';
import { captureContentScope, openContentInBestTarget, openWorkbenchContent } from '@/shared/services/workbenchContentService';
import { clearAgentCanvasForPeerSwitch, switchAgentCanvasScope, useAgentCanvasStore, useGitCanvasStore } from '../components/panels/content-canvas/stores';
import { appManager } from '../services/AppManager';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { openBtwSessionInAuxPane } from '@/flow_chat/services/btwSessionPane';
import { createBtwChildSession, createBtwSessionPlaceholder } from '@/flow_chat/services/BtwThreadService';
import { agentAPI } from '@/infrastructure/api/service-api/AgentAPI';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import { initializeEventListeners } from '@/flow_chat/services/flow-chat-manager/EventHandlerModule';
import { agenticEventListener } from '@/flow_chat/services/AgenticEventListener';
import type { FlowChatContext } from '@/flow_chat/services/flow-chat-manager/types';
import { sessionBelongsToWorkspaceNavRow } from '@/flow_chat/utils/sessionOrdering';
import { resolveSessionRelationship } from '@/flow_chat/utils/sessionMetadata';
import type { Session } from '@/flow_chat/types/flow-chat';
import { getEditorDocument, releaseEditorDocument } from '@/tools/editor/services/EditorDocument';
import { cancelPendingSettingsNavigation, discardAndContinueSettingsNavigation, registerSettingsDraft,
  resetSettingsDraftRegistryForTests } from '@/infrastructure/config/settingsDraftRegistry';
import { globalEventBus } from '@/infrastructure/event-bus';
import { editorJumpService } from '@/shared/services/EditorJumpService';
import { activateSurface, getActiveSurfaceId } from '@/infrastructure/peer-device/deviceSurface';
import { SCENE_TAB_REGISTRY } from '../scenes/registry';
import { getSessionSceneTabId } from '../components/SceneBar/types';
import { resolveSessionSceneTarget } from '../services/sessionSceneTarget';
import { workspaceManager } from '@/infrastructure/services/business/workspaceManager';
import { openThinkingPanel } from '@/flow_chat/services/openThinkingPanel';
import type { WorkspaceInfo } from '@/shared/types';
import { __test_only__ } from '@/flow_chat/services/flow-chat-manager/EventHandlerModule';

vi.mock('@/infrastructure/services/business/workspaceManager', () => ({
  workspaceManager: { getState: vi.fn(() => ({ currentWorkspace: { id: 'project', rootPath: '/project' }, recentWorkspaces: [],
    openedWorkspaces: new Map([['project', { id: 'project', rootPath: '/project' }]]) })) },
}));

describe('workbench content navigation', () => {
  let stopEventListeners: (() => void) | undefined;
  function selectSession(sessionId = 'session-a', overrides: Partial<Session> = {}) {
    const session: Session = { sessionId, title: sessionId, dialogTurns: [], status: 'idle', config: {},
      sessionKind: 'normal', createdAt: 1, lastActiveAt: 1, error: null,
      workspacePath: '/project', workspaceId: 'project', ...overrides };
    flowChatStore.setState(state => ({ ...state, sessions: new Map(state.sessions).set(sessionId, session), activeSessionId: sessionId }));
    return session;
  }

  function openSession(sessionId = 'session-a', overrides: Partial<Session> = {}) {
    const session = selectSession(sessionId, overrides);
    const target = resolveSessionSceneTarget(session, workspaceManager.getState().openedWorkspaces.values(), getActiveSurfaceId());
    useSceneStore.getState().openSessionScene(target);
    return target;
  }

  beforeEach(() => {
    activateSurface('local');
    flowChatStore.setState(state => ({ ...state, sessions: new Map(), activeSessionId: null }));
    clearAgentCanvasForPeerSwitch();
    useContentResourceStore.setState({ resources: {} });
    useSceneStore.getState().resetForPeerSwitch();
    resetSettingsDraftRegistryForTests();
    appManager.updateLayout({ chatCollapsed: false, rightPanelCollapsed: true });
  });

  afterEach(() => {
    stopEventListeners?.();
    stopEventListeners = undefined;
    vi.restoreAllMocks();
    activateSurface('local');
    flowChatStore.setState(state => ({ ...state, sessions: new Map(), activeSessionId: null }));
    clearAgentCanvasForPeerSwitch();
    resetSettingsDraftRegistryForTests();
    vi.mocked(workspaceManager.getState).mockClear();
  });

  it.each([false, true])('refreshes a dispatch snapshot through the production open path, inline=%s', inline => {
    if (inline) openSession();
    const open = (dataUrl: string) => createTab({
      type: 'image-viewer', title: 'output.png', mode: 'agent', replaceExisting: true,
      duplicateCheckKey: 'job/output.png', data: { filePath: 'dispatch-file://job/output.png', imageSource: { dataUrl, size: 1 } },
    });
    open('data:image/png;base64,AQ==');
    open('data:image/png;base64,Ag==');
    const contents = inline
      ? useAgentCanvasStore.getState().primaryGroup.tabs.map(tab => tab.content)
      : Object.values(useContentResourceStore.getState().resources).map(resource => resource.content);
    expect(contents).toHaveLength(1);
    expect(contents[0].data.imageSource.dataUrl).toBe('data:image/png;base64,Ag==');
  });

  it('falls back to one main file tab when a stale scene has no usable session', () => {
    useSceneStore.getState().openSessionScene({ surfaceId: 'local', workspaceKey: 'project', sessionId: 'session-a' });
    fileTabManager.openFile({ filePath: '/project/a.ts', sceneJustOpened: true });
    openFileInBestTarget({ filePath: '/project/a.ts', jumpToLine: 42 }, { source: 'project-nav' });
    const state = useSceneStore.getState();
    expect(state.openTabs.filter(tab => tab.contentId)).toHaveLength(1);
    expect(state.activeTabId).toMatch(/^content:/);
    expect(Object.values(useContentResourceStore.getState().resources)[0].content.data.jumpToLine).toBe(42);
    expect(SCENE_TAB_REGISTRY.some(tab => ['panel-view'].includes(tab.id))).toBe(false);
  });

  it.each([true, false])('opens content at the top when only a cached session exists, selected=%s', selected => {
    const session = selectSession();
    if (!selected) flowChatStore.setState(state => ({ ...state, activeSessionId: null }));
    const activate = vi.fn(async () => true);
    const stop = registerSessionSceneNavigation({ current: () => null, isActive: () => false, activate });
    try {
      fileTabManager.openFile({ filePath: '/project/a.ts' });
      createTerminalTab('pty-session', 'Shell', 'project');
      createTab({ type: 'markdown-viewer', title: 'Note', data: '# Note', mode: 'agent' });
      expect(activate).not.toHaveBeenCalled();
      expect(useSceneStore.getState().openTabs).toHaveLength(3);
      expect(useSceneStore.getState().openTabs.every(tab => tab.contentId && !tab.session)).toBe(true);
      expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(0);
      expect(appManager.getState().layout.rightPanelCollapsed).toBe(true);
      expect(flowChatStore.getState().activeSessionId).toBe(selected ? session.sessionId : null);
    } finally { stop(); }
  });

  it('does not reopen a closed session tab while its session remains selected', async () => {
    const target = openSession();
    await useSceneStore.getState().closeScene(getSessionSceneTabId(target));
    expect(flowChatStore.getState().activeSessionId).toBe(target.sessionId);
    fileTabManager.openFile({ filePath: '/project/a.ts' });
    expect(useSceneStore.getState().openTabs).toHaveLength(1);
    expect(useSceneStore.getState().activeTabId).toMatch(/^content:/);
    expect(useSceneStore.getState().openTabs.some(tab => tab.session)).toBe(false);
    expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(0);
    expect(appManager.getState().layout.rightPanelCollapsed).toBe(true);
  });

  it('opens into the session and expands its panel before any viewport mounts', () => {
    openSession();
    fileTabManager.openFile({ filePath: '/project/a.ts', sceneJustOpened: true });
    openFileInBestTarget({ filePath: '/project/a.ts', jumpToLine: 42 }, { source: 'project-nav' });
    const canvas = useAgentCanvasStore.getState();
    expect(canvas.scopeKey).toBe('session-a');
    expect(canvas.primaryGroup.tabs).toHaveLength(1);
    expect(canvas.primaryGroup.tabs[0].content.data).toMatchObject({ filePath: '/project/a.ts', jumpToLine: 42 });
    expect(useSceneStore.getState().openTabs.map(tab => tab.session?.sessionId)).toEqual(['session-a']);
    expect(appManager.getState().layout.rightPanelCollapsed).toBe(false);
    expect(Object.values(useContentResourceStore.getState().resources)).toHaveLength(0);

    // AuxPane's later first mount and stale scope syncs cannot reset this write.
    switchAgentCanvasScope('session-a');
    switchAgentCanvasScope('session-a');
    expect(useAgentCanvasStore.getState().primaryGroup.tabs[0].id).toBe(canvas.primaryGroup.tabs[0].id);
  });

  it('keeps one thinking tab across different thoughts and projected child sessions', () => {
    openSession();
    const open = (id: string, sessionId = 'session-a') => openThinkingPanel({
      title: 'Thinking', sessionId, workspaceId: 'project',
      thinkingItem: { id, type: 'thinking', content: id, status: 'completed',
        timestamp: 1, isStreaming: false, isCollapsed: true },
      navigationTarget: { sessionId: 'session-a', turnId: 'turn-1', itemId: id },
    });
    open('thinking-1');
    const first = useAgentCanvasStore.getState().primaryGroup.tabs[0];
    createTab({ type: 'markdown-viewer', title: 'Note', data: '# Note', duplicateCheckKey: 'note' });
    appManager.updateLayout({ rightPanelCollapsed: true });
    open('thinking-2');
    open('child-thinking', 'child-session');
    const tabs = useAgentCanvasStore.getState().primaryGroup.tabs;
    const readers = tabs.filter(tab => tab.content.type === 'thinking-detail');
    expect(readers).toHaveLength(1);
    expect(readers[0].id).toBe(first.id);
    expect(readers[0].content.data.thinkingItem.id).toBe('child-thinking');
    expect(readers[0].content.data.sessionId).toBe('child-session');
    expect(tabs.some(tab => tab.content.type === 'markdown-viewer')).toBe(true);
    expect(appManager.getState().layout.rightPanelCollapsed).toBe(false);
  });

  it('returns to an open session behind another top-level scene instead of a cached selection', () => {
    const target = openSession();
    selectSession('cached-session', { lastActiveAt: 999 });
    useSceneStore.getState().openScene('git');
    fileTabManager.openFile({ filePath: '/project/a.ts' });
    expect(useSceneStore.getState().activeTabId).toBe(getSessionSceneTabId(target));
    expect(useSceneStore.getState().openTabs.find(tab => tab.session)?.session).toEqual(target);
    expect(useSceneStore.getState().openTabs.some(tab => tab.contentId)).toBe(false);
    expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(1);
  });

  it('chooses the matching workspace tab while a different workspace session is active', () => {
    const target = openSession();
    const other = openSession('other-session', { workspaceId: undefined, workspacePath: '/other' });
    switchAgentCanvasScope('other-session');
    useAgentCanvasStore.getState().addTab({ type: 'text-viewer', title: 'Other', data: { content: 'draft' } }, 'active');
    const previous = useAgentCanvasStore.getState().primaryGroup.tabs[0];
    fileTabManager.openFile({ filePath: '/project/a.ts', workspacePath: '/project' });
    expect(useSceneStore.getState().activeTabId).toBe(getSessionSceneTabId(target));
    expect(useSceneStore.getState().openTabs.map(tab => tab.session)).toEqual([target, other]);
    expect(useAgentCanvasStore.getState().scopeKey).toBe('session-a');
    expect(useAgentCanvasStore.getState().primaryGroup.tabs[0].content.data.filePath).toBe('/project/a.ts');
    switchAgentCanvasScope('other-session');
    expect(useAgentCanvasStore.getState().primaryGroup.tabs.map(tab => tab.id)).toEqual([previous.id]);
  });

  it.each([
    { isTransient: true },
    { sessionKind: 'subagent' as const },
    { persistedStatus: 'archived' as const },
  ])('does not use an ineligible session even if its tab remains open: %j', overrides => {
    openSession('ineligible', overrides);
    fileTabManager.openFile({ filePath: '/project/a.ts' });
    expect(useSceneStore.getState().activeTabId).toMatch(/^content:/);
    expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(0);
    expect(appManager.getState().layout.rightPanelCollapsed).toBe(true);
  });

  it.each(['local', 'peer'])('uses the matching SSH workspace tab on the %s surface', surfaceId => {
    activateSurface(surfaceId);
    const workspaces = workspaceManager.getState();
    const sshWorkspace = { id: 'ssh-project', rootPath: '/srv/project', connectionId: 'ssh-a', workspaceKind: 'remote' } as WorkspaceInfo;
    vi.mocked(workspaceManager.getState).mockReturnValue({ ...workspaces,
      currentWorkspace: sshWorkspace, openedWorkspaces: new Map([[sshWorkspace.id, sshWorkspace]]) });
    try {
      const target = openSession('ssh-session', { workspaceId: sshWorkspace.id,
        workspacePath: sshWorkspace.rootPath, remoteConnectionId: 'ssh-a' });
      useSceneStore.getState().openScene('git');
      fileTabManager.openFile({ filePath: 'a.ts', workspacePath: sshWorkspace.rootPath, remoteConnectionId: 'ssh-a' });
      expect(useSceneStore.getState().activeTabId).toBe(getSessionSceneTabId(target));
      expect(useAgentCanvasStore.getState().scopeKey).toBe('ssh-session');
      expect(useAgentCanvasStore.getState().primaryGroup.tabs[0].content.metadata?.resourceScope).toEqual({
        surfaceId, workspaceId: sshWorkspace.id, workspacePath: sshWorkspace.rootPath, remoteConnectionId: 'ssh-a',
      });
      expect(() => fileTabManager.openFile({ filePath: 'b.ts', workspacePath: sshWorkspace.rootPath, remoteConnectionId: 'ssh-b' })).toThrow('Workspace identity');
      expect(useSceneStore.getState().activeTabId).toBe(getSessionSceneTabId(target));
      expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(1);
    } finally { vi.mocked(workspaceManager.getState).mockReturnValue(workspaces); }
  });

  it('routes an upgraded worktree session through its owning project ID', () => {
    const target = openSession('worktree-session', { workspaceId: 'worktree-id', projectWorkspaceId: 'project', workspacePath: '/worktrees/a',
      projectWorkspacePath: '/project' });
    fileTabManager.openFile({ filePath: '/project/a.ts', workspacePath: '/project' });
    expect(useSceneStore.getState().activeTabId).toBe(getSessionSceneTabId(target));
    expect(useAgentCanvasStore.getState().scopeKey).toBe('worktree-session');
    expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(1);

    fileTabManager.openFile({ filePath: 'a.ts', workspaceId: 'worktree-id' });
    const tabs = useAgentCanvasStore.getState().primaryGroup.tabs;
    expect(tabs).toHaveLength(2);
    expect(tabs.find(tab => tab.content.data.filePath === '/worktrees/a/a.ts')?.content.metadata?.resourceScope)
      .toEqual({ surfaceId: 'local', workspaceId: 'worktree-id', workspacePath: '/worktrees/a', remoteConnectionId: undefined });
    expect(useAgentCanvasStore.getState().scopeKey).toBe('worktree-session');
    expect(() => fileTabManager.openFile({ filePath: 'a.ts', workspaceId: 'missing-id', workspacePath: '/worktrees/a' }))
      .toThrow('Workspace identity');
  });

  it.each([
    { sessionKind: 'review', eventFirst: true },
    { sessionKind: 'review', eventFirst: false },
    { sessionKind: 'deep_review', eventFirst: true },
    { sessionKind: 'deep_review', eventFirst: false },
    { sessionKind: 'btw', eventFirst: false },
  ] as const)(
    'keeps a $sessionKind child visible and openable when the creation event arrives first: $eventFirst', async ({ sessionKind, eventFirst }) => {
      const target = openSession('worktree-parent', {
        workspaceId: 'worktree-id', workspacePath: '/worktrees/a',
        projectWorkspaceId: 'project', projectWorkspacePath: '/project',
        // Production worktree sessions carry the resolved execution target; it
        // is what keeps the session in its project's navigation group.
        config: {
          executionTarget: {
            kind: 'existingWorktree', worktreeId: 'worktree-id', rootPath: '/worktrees/a',
          },
        },
      });
      const listeners = new Map<string, (event: any) => void>();
      vi.spyOn(api, 'listen').mockImplementation((name, callback) => {
        listeners.set(name, callback);
        return () => { listeners.delete(name); };
      });
      vi.spyOn(api, 'waitForListenerRegistrations').mockResolvedValue();
      agenticEventListener.stopListening();
      stopEventListeners = await initializeEventListeners({
        flowChatStore, currentWorkspaceId: 'project', currentWorkspacePath: '/project',
      } as FlowChatContext, vi.fn());
      // Older hosts emit the execution identity before resolving create_session.
      const createdSession = {
        sessionId: 'worktree-child', sessionName: 'Review', agentType: 'Standard',
        workspaceId: 'worktree-id', workspacePath: '/worktrees/a', projectWorkspacePath: '/project',
      };
      vi.spyOn(agentAPI, 'createSession').mockImplementation(async () => {
        if (eventFirst) listeners.get('agentic://session-created')!(createdSession);
        return createdSession;
      });
      const createParams = { parentSessionId: 'worktree-parent', childSessionName: 'Review', sessionKind };
      const { childSessionId } = sessionKind === 'btw'
        ? createBtwSessionPlaceholder(createParams)
        : await createBtwChildSession(createParams);
      if (!eventFirst && sessionKind !== 'btw') {
        listeners.get('agentic://session-created')!(createdSession);
      }
      const child = flowChatStore.getState().sessions.get(childSessionId)!;
      expect(sessionBelongsToWorkspaceNavRow(child, 'project')).toBe(true);
      expect(resolveSessionRelationship(child)).toMatchObject({
        kind: sessionKind, parentSessionId: 'worktree-parent', displayAsChild: true,
      });
      const params = { childSessionId, parentSessionId: 'worktree-parent', sessionKind };

      openBtwSessionInAuxPane(params);

      const canvas = useAgentCanvasStore.getState();
      expect(useSceneStore.getState().activeTabId).toBe(getSessionSceneTabId(target));
      expect(canvas.scopeKey).toBe('worktree-parent');
      expect(canvas.primaryGroup.tabs).toHaveLength(1);
      expect(canvas.primaryGroup.tabs[0].content).toMatchObject({
        type: 'btw-session',
        data: { childSessionId, parentSessionId: 'worktree-parent',
          workspaceId: 'worktree-id', workspacePath: '/worktrees/a', projectWorkspaceId: 'project' },
        metadata: { resourceScope: { surfaceId: 'local', workspaceId: 'worktree-id', workspacePath: '/worktrees/a' } },
      });
      expect(flowChatStore.getState().activeSessionId).toBe('worktree-parent');
      expect(Object.values(useContentResourceStore.getState().resources)).toHaveLength(0);

      openBtwSessionInAuxPane(params);
      expect(useAgentCanvasStore.getState().primaryGroup.tabs.map(tab => tab.id))
        .toEqual([canvas.primaryGroup.tabs[0].id]);

      expect(flowChatStore.getState().sessions.get(childSessionId)).toMatchObject({
        workspaceId: 'worktree-id', projectWorkspaceId: 'project',
        config: { workspaceId: 'worktree-id', projectWorkspaceId: 'project' },
      });
      useAgentCanvasStore.getState().closeTab(canvas.primaryGroup.tabs[0].id, 'primary');
      expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(0);
      expect(sessionBelongsToWorkspaceNavRow(flowChatStore.getState().sessions.get(childSessionId)!, 'project'))
        .toBe(true);
      openBtwSessionInAuxPane(params);
      expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(1);
      expect(useAgentCanvasStore.getState().primaryGroup.tabs[0].content.data)
        .toMatchObject({ childSessionId, workspaceId: 'worktree-id', projectWorkspaceId: 'project' });
      expect(flowChatStore.removeSessionsForWorkspace({ id: 'project' }).sort())
        .toEqual([childSessionId, 'worktree-parent'].sort());
    },
  );

  it('keeps a draft and replaces stale navigation when reopening an inline file', () => {
    openSession();
    fileTabManager.openFile({ filePath: '/project/a.ts', jumpToRange: { start: 2, end: 5 } });
    const store = useAgentCanvasStore.getState();
    const tab = store.primaryGroup.tabs[0];
    const documentId = `canvas:${tab.id}`;
    const document = getEditorDocument(documentId, tab.content.metadata!.resourceScope, '/project/a.ts');
    document.capture('unsaved draft', true, 'saved');
    store.setTabDirty(tab.id, 'primary', true);
    store.updateTabContent(tab.id, 'primary', { ...tab.content, data: { ...tab.content.data, content: 'unsaved draft' } });
    appManager.updateLayout({ rightPanelCollapsed: true });
    fileTabManager.openFile({ filePath: '/project/a.ts', jumpToLine: 9, jumpToColumn: 3 });
    const reopened = useAgentCanvasStore.getState().primaryGroup.tabs[0];
    expect(reopened).toMatchObject({ id: tab.id, isDirty: true, content: { data: { content: 'unsaved draft', jumpToLine: 9, jumpToColumn: 3 } } });
    expect(reopened.content.data.jumpToRange).toBeUndefined();
    expect(reopened.content.data.navigationToken).not.toBe(tab.content.data.navigationToken);
    expect(document.snapshot).toEqual({ content: 'unsaved draft', isDirty: true, savedContent: 'saved' });
    expect(appManager.getState().layout.rightPanelCollapsed).toBe(false);
    expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(1);
    releaseEditorDocument(documentId);
  });

  it('routes terminals and contextual content through the same session-first policy', () => {
    openSession();
    createTerminalTab('pty-session', 'Shell', 'project');
    createTerminalTab('pty-session', 'Shell', 'agent');
    createTab({ type: 'markdown-viewer', title: 'Note', data: '# Note', mode: 'project' });
    expect(useAgentCanvasStore.getState().primaryGroup.tabs.map(tab => tab.content.type)).toEqual(['markdown-viewer', 'terminal']);
    expect(useAgentCanvasStore.getState().primaryGroup.tabs[1].content.metadata?.terminalCloseBehavior).toBe('detach');
    expect(Object.values(useContentResourceStore.getState().resources)).toHaveLength(0);
  });

  it('isolates built-in browser tabs by session within one workspace', () => {
    openSession('session-a');
    createTab({
      type: 'browser',
      title: 'Example A',
      data: { url: 'https://example.com/a' },
      duplicateCheckKey: 'browser-panel:https://example.com',
      mode: 'agent',
    });
    const aCanvas = useAgentCanvasStore.getState();
    expect(aCanvas.scopeKey).toBe('session-a');
    expect(aCanvas.primaryGroup.tabs).toHaveLength(1);
    expect(aCanvas.primaryGroup.tabs[0].content.data.ownerSessionId).toBe('session-a');

    openSession('session-b');
    createTab({
      type: 'browser',
      title: 'Example B',
      data: { url: 'https://example.com/b' },
      duplicateCheckKey: 'browser-panel:https://example.com',
      mode: 'agent',
    });
    const bCanvas = useAgentCanvasStore.getState();
    expect(bCanvas.scopeKey).toBe('session-b');
    expect(bCanvas.primaryGroup.tabs).toHaveLength(1);
    expect(bCanvas.primaryGroup.tabs[0].content.data.ownerSessionId).toBe('session-b');

    // The canvas is keyed by session, so A keeps its own tab in its snapshot.
    switchAgentCanvasScope('session-a');
    const restored = useAgentCanvasStore.getState();
    expect(restored.scopeKey).toBe('session-a');
    expect(restored.primaryGroup.tabs).toHaveLength(1);
    expect(restored.primaryGroup.tabs[0].content.data.ownerSessionId).toBe('session-a');
    expect(restored.primaryGroup.tabs[0].content.metadata?.contentResourceKey)
      .not.toBe(bCanvas.primaryGroup.tabs[0].content.metadata?.contentResourceKey);
  });

  describe('Agent browser opens', () => {
    beforeEach(() => {
      vi.stubGlobal('__TAURI_INTERNALS__', { invoke: () => {} });
      vi.spyOn(api, 'invoke').mockResolvedValue(undefined);
    });
    afterEach(() => {
      vi.mocked(api.invoke).mockRestore();
      vi.unstubAllGlobals();
    });

    const request = {
      url: 'https://example.com/agent', ownerSessionId: 'session-a',
      ownerWorkspaceId: 'project', requestId: 'request-a', replaceExisting: true,
    };

    it.each([false, true])('keeps B selected while A prepares a hidden browser, typing=%s', async typing => {
      openSession('session-a');
      openSession('session-b');
      switchAgentCanvasScope(null);
      createCodeEditorTab('/project/draft.ts', 'draft.ts');
      const input = document.createElement('textarea');
      document.body.append(input);
      if (typing) { input.value = 'unfinished draft'; input.focus(); }
      const scenes = useSceneStore.getState();
      const previousTab = useAgentCanvasStore.getState().primaryGroup.activeTabId;
      const layout = appManager.getState().layout;

      try {
        await __test_only__.handleOpenBuiltInBrowser(request);
        expect(flowChatStore.getState().activeSessionId).toBe('session-b');
        expect(useSceneStore.getState().activeTabId).toBe(scenes.activeTabId);
        expect(useSceneStore.getState().navHistory).toEqual(scenes.navHistory);
        expect(appManager.getState().layout).toEqual(layout);
        if (typing) { expect(document.activeElement).toBe(input); expect(input.value).toBe('unfinished draft'); }
        const presented = useAgentCanvasStore.getState();
        expect(presented.primaryGroup.activeTabId).toBe(previousTab);
        // The prepared page belongs to A's canvas snapshot, never to B's.
        expect(presented.primaryGroup.tabs.some(tab => tab.content.type === 'browser')).toBe(false);

        switchAgentCanvasScope('session-a');
        const canvas = useAgentCanvasStore.getState();
        const browser = canvas.primaryGroup.tabs.find(tab => tab.content.type === 'browser')!;
        expect(browser.isHidden).toBe(true);
        expect(browser.content.data).toMatchObject({ ownerSessionId: 'session-a', adoptExisting: true });
        expect(api.invoke).toHaveBeenCalledExactlyOnceWith('browser_webview_create', {
          request: expect.objectContaining({ label: browser.content.data.webviewLabel,
            url: request.url, openRequestId: request.requestId }),
        });

        expect(canvas.syncSessionOwnedBrowserTabs('session-a').hasVisibleOwnedBrowserTab).toBe(true);
        expect(useAgentCanvasStore.getState().primaryGroup.tabs.find(tab => tab.id === browser.id)?.isHidden).toBe(false);
      } finally { input.remove(); }
    });

    it.each(['local', 'peer-test'])('stores A in its remote workspace without switching B on surface %s', async surfaceId => {
      activateSurface(surfaceId);
      const remote: WorkspaceInfo = { id: 'remote-a', name: 'Remote', rootPath: '/remote/a',
        workspaceKind: 'remote', connectionId: 'ssh-a', filesystemScopeKey: 'ssh:ssh-a',
        createdAt: '', lastAccessed: '' };
      vi.mocked(workspaceManager.getState).mockReturnValueOnce({
        currentWorkspace: { id: 'project', rootPath: '/project' }, recentWorkspaces: [],
        openedWorkspaces: new Map([['remote-a', remote], ['project', { id: 'project', rootPath: '/project' }]]),
      } as any);
      const sessionA = openSession('session-a', { workspaceId: remote.id, workspacePath: remote.rootPath });
      openSession('session-b');
      switchAgentCanvasScope(null);
      createCodeEditorTab('/project/b.ts', 'b.ts');
      const scenes = useSceneStore.getState();
      const before = useAgentCanvasStore.getState();
      // An OHOS/peer host already owns this page; the controller only records its view.
      vi.mocked(workspaceManager.getState).mockReturnValueOnce({
        currentWorkspace: { id: 'project', rootPath: '/project' }, recentWorkspaces: [],
        openedWorkspaces: new Map([['remote-a', remote], ['project', { id: 'project', rootPath: '/project' }]]),
      } as any);
      await __test_only__.handleOpenBuiltInBrowser({ ...request, ownerWorkspaceId: remote.id,
        webviewLabel: 'embedded-browser-panel-view-agent-existing', adoptExisting: true });
      expect(flowChatStore.getState().activeSessionId).toBe('session-b');
      expect(useSceneStore.getState().activeTabId).toBe(scenes.activeTabId);
      expect(useSceneStore.getState().openTabs.some(tab => tab.session === sessionA)).toBe(true);
      expect(useAgentCanvasStore.getState()).toBe(before);
      expect(api.invoke).not.toHaveBeenCalled();
      switchAgentCanvasScope('session-a');
      const browser = useAgentCanvasStore.getState().primaryGroup.tabs[0];
      expect(browser.content.data).toMatchObject({ ownerSessionId: 'session-a',
        webviewLabel: 'embedded-browser-panel-view-agent-existing', adoptExisting: true });
      expect(browser.content.metadata?.resourceScope).toMatchObject({ surfaceId, workspaceId: remote.id,
        remoteConnectionId: 'ssh-a' });
    });

    it('opens the browser panel normally when A is already presented', async () => {
      openSession('session-a');
      await __test_only__.handleOpenBuiltInBrowser(request);
      expect(useAgentCanvasStore.getState().primaryGroup.tabs[0].content.type).toBe('browser');
      expect(appManager.getState().layout.rightPanelCollapsed).toBe(false);
      expect(api.invoke).not.toHaveBeenCalled();
    });

    it('does not cancel a user navigation from A to B while preparing A', async () => {
      const sessionA = openSession('session-a');
      const sessionB = openSession('session-b', { workspaceId: 'other', workspacePath: '/other' });
      selectSession('session-a');
      useSceneStore.getState().activateScene(getSessionSceneTabId(sessionA));
      switchAgentCanvasScope(null);
      let finish!: (activated: boolean) => void;
      const stop = registerSessionSceneNavigation({
        current: () => sessionA, isActive: () => false,
        activate: () => new Promise<boolean>(resolve => { finish = resolve; }),
      });
      try {
        useSceneStore.getState().activateScene(getSessionSceneTabId(sessionB));
        await __test_only__.handleOpenBuiltInBrowser(request);
        expect(useSceneStore.getState().pendingTabId).toBe(getSessionSceneTabId(sessionB));
        selectSession('session-b', { workspaceId: 'other', workspacePath: '/other' });
        finish(true);
        await vi.waitFor(() => expect(useSceneStore.getState().activeTabId).toBe(getSessionSceneTabId(sessionB)));
        expect(flowChatStore.getState().activeSessionId).toBe('session-b');
      } finally { stop(); }
    });

    it('replaces a background page without changing selection or retaining the old native page', async () => {
      selectSession('session-a');
      openSession('session-b');
      switchAgentCanvasScope(null);
      createCodeEditorTab('/project/b.ts', 'b.ts');
      const selected = useAgentCanvasStore.getState().primaryGroup.activeTabId;
      await __test_only__.handleOpenBuiltInBrowser(request);
      // B's presented canvas never receives A's page.
      const presented = useAgentCanvasStore.getState();
      expect(presented.primaryGroup.activeTabId).toBe(selected);
      expect(presented.primaryGroup.tabs.some(tab => tab.content.type === 'browser')).toBe(false);

      switchAgentCanvasScope('session-a');
      const first = useAgentCanvasStore.getState().primaryGroup.tabs.find(tab => tab.content.type === 'browser')!;
      switchAgentCanvasScope('session-b');

      await __test_only__.handleOpenBuiltInBrowser({ ...request, requestId: 'replacement', url: 'https://example.com/new' });
      expect(flowChatStore.getState().activeSessionId).toBe('session-b');
      expect(useAgentCanvasStore.getState().primaryGroup.activeTabId).toBe(selected);
      expect(useAgentCanvasStore.getState().primaryGroup.tabs.some(tab => tab.content.type === 'browser')).toBe(false);

      switchAgentCanvasScope('session-a');
      const canvas = useAgentCanvasStore.getState();
      const browsers = canvas.primaryGroup.tabs.filter(tab => tab.content.type === 'browser');
      expect(browsers).toHaveLength(1);
      expect(browsers[0].content.data.url).toBe('https://example.com/new');
      expect(browsers[0].content.data.webviewLabel).not.toBe(first.content.data.webviewLabel);
      expect(canvas.primaryGroup.activeTabId).not.toBe(browsers[0].id);
      await vi.waitFor(() => expect(api.invoke).toHaveBeenCalledWith('browser_webview_close', {
        request: { label: first.content.data.webviewLabel },
      }));
    });

    it('keeps legacy requests without an owner in the background', async () => {
      openSession('session-b');
      const activeTab = useSceneStore.getState().activeTabId;
      await __test_only__.handleOpenBuiltInBrowser({ url: 'https://example.com/legacy' });
      expect(useSceneStore.getState().activeTabId).toBe(activeTab);
      expect(flowChatStore.getState().activeSessionId).toBe('session-b');
      expect(Object.values(useContentResourceStore.getState().resources)[0].content.data)
        .toMatchObject({ url: 'https://example.com/legacy', adoptExisting: true });
    });

    it('keeps an existing main browser view in the background', async () => {
      openSession('session-b');
      const id = openWorkbenchContent({ type: 'browser', title: 'A',
        data: { url: request.url, ownerSessionId: 'session-a' } },
      { resourceKey: 'browser-panel:session-a:session:session-a', focus: false });
      const activeTab = useSceneStore.getState().activeTabId;
      await __test_only__.handleOpenBuiltInBrowser({ ...request,
        webviewLabel: 'embedded-browser-panel-view-agent-main', adoptExisting: true });
      expect(useSceneStore.getState().activeTabId).toBe(activeTab);
      expect(useContentResourceStore.getState().resources[id].content.data.webviewLabel)
        .toBe('embedded-browser-panel-view-agent-main');
    });

    it('does not navigate if native browser preparation fails', async () => {
      openSession('session-b');
      const activeTab = useSceneStore.getState().activeTabId;
      vi.mocked(api.invoke).mockRejectedValueOnce(new Error('Native browser unavailable'));
      await expect(__test_only__.handleOpenBuiltInBrowser(request)).rejects.toThrow('Native browser unavailable');
      expect(useSceneStore.getState().activeTabId).toBe(activeTab);
      expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(0);
      expect(useContentResourceStore.getState().resources).toEqual({});
    });

    it('abandons a prepared page when the device surface changes', async () => {
      openSession('session-b');
      let finish!: () => void;
      vi.mocked(api.invoke).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
      const opening = __test_only__.handleOpenBuiltInBrowser(request);
      activateSurface('another-device');
      finish();
      await opening;
      expect(api.invoke).toHaveBeenLastCalledWith('browser_webview_close', {
        request: { label: expect.stringMatching(/^embedded-browser-panel-view-/) },
      });
      expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(0);
      expect(useContentResourceStore.getState().resources).toEqual({});
    });
  });

  it('keeps explicit Git opens in Git even with a selected session', () => {
    openSession();
    useSceneStore.getState().openScene('git');
    createGitCodeEditorTab('/project/a.ts', 'a.ts');
    expect(useGitCanvasStore.getState().primaryGroup.tabs).toHaveLength(1);
    expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(0);
    expect(useSceneStore.getState().activeTabId).toBe('git');
    expect(appManager.getState().layout.rightPanelCollapsed).toBe(true);
  });

  it('leaves the code editor minimap to the user setting unless a tab overrides it', () => {
    openSession();
    useSceneStore.getState().openScene('git');
    createGitCodeEditorTab('/project/a.ts', 'a.ts');
    createGitCodeEditorTab('/project/b.ts', 'b.ts', { showMinimap: false });
    createCodeEditorTab('/project/c.ts', 'c.ts');

    const gitTabs = useGitCanvasStore.getState().primaryGroup.tabs
      .map(tab => ({ filePath: tab.content.data.filePath, showMinimap: tab.content.data.showMinimap }))
      .sort((left, right) => left.filePath.localeCompare(right.filePath));
    expect(gitTabs).toEqual([
      { filePath: '/project/a.ts', showMinimap: undefined },
      { filePath: '/project/b.ts', showMinimap: false },
    ]);
    const agentTabs = useAgentCanvasStore.getState().primaryGroup.tabs.map(tab => tab.content.data);
    expect(agentTabs.map(data => data.showMinimap)).toEqual([undefined]);
  });

  it('keeps an explicit pop-out at the top and reuses its document on later opens', () => {
    openSession();
    fileTabManager.openFile({ filePath: '/project/a.ts' });
    const canvas = useAgentCanvasStore.getState();
    const tab = canvas.primaryGroup.tabs[0];
    const resourceId = openWorkbenchContent(tab.content, { scope: tab.content.metadata!.resourceScope, documentId: `canvas:${tab.id}` });
    canvas.detachTab(tab.id, 'primary');
    fileTabManager.openFile({ filePath: '/project/a.ts', jumpToLine: 12 });
    expect(useSceneStore.getState().activeTabId).toBe(`content:${resourceId}`);
    expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(0);
    expect(Object.values(useContentResourceStore.getState().resources)).toHaveLength(1);
    expect(useContentResourceStore.getState().resources[resourceId].documentId).toBe(`canvas:${tab.id}`);
  });

  it.each([
    { workspacePath: '/other' },
    { workspacePath: '/project', remoteConnectionId: 'ssh-other' },
  ])('does not route a different workspace or filesystem into the selected session: %j', origin => {
    openSession();
    const selected = useSceneStore.getState().activeTabId;
    expect(() => fileTabManager.openFile({ filePath: 'a.ts', ...origin })).toThrow('Workspace identity');
    expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(0);
    expect(useSceneStore.getState().activeTabId).toBe(selected);
    expect(appManager.getState().layout.rightPanelCollapsed).toBe(true);
  });

  it('isolates a peer file from sessions on the local device', () => {
    openSession();
    activateSurface('peer-without-session');
    fileTabManager.openFile({ filePath: '/project/a.ts' });
    expect(useSceneStore.getState().activeTabId).toMatch(/^content:/);
    expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(0);
    expect(() => fileTabManager.openFile({ filePath: '/project/b.ts', scope: { surfaceId: 'local' } })).toThrow('another device');
  });

  it('resolves uncatalogued workspace IDs only from the current device session bindings', () => {
    selectSession('same-session', { workspaceId: undefined, workspacePath: undefined,
      config: { workspaceId: 'same-workspace', workspacePath: '/worktrees/local' } });
    expect(captureContentScope({ workspaceId: 'same-workspace', workspacePath: '/stale' }))
      .toMatchObject({ surfaceId: 'local', workspaceId: 'same-workspace', workspacePath: '/worktrees/local' });

    activateSurface('worktree-peer');
    expect(() => captureContentScope({ workspaceId: 'same-workspace', workspacePath: '/worktrees/local' }))
      .toThrow('Workspace identity');
    selectSession('same-session', { workspaceId: 'same-workspace', workspacePath: '/srv/worktree',
      remoteConnectionId: 'peer-ssh' });
    expect(captureContentScope({ workspaceId: 'same-workspace' })).toEqual({
      surfaceId: 'worktree-peer', workspaceId: 'same-workspace', workspacePath: '/srv/worktree', remoteConnectionId: 'peer-ssh',
    });
    flowChatStore.setState(state => ({ ...state, sessions: new Map(), activeSessionId: null }));
    activateSurface('local');
    expect(captureContentScope({ workspaceId: 'same-workspace' }))
      .toMatchObject({ surfaceId: 'local', workspaceId: 'same-workspace', workspacePath: '/worktrees/local' });
  });

  it.each(['superseded', 'device-change'])('waits for session activation and abandons a stale content request: %s', async reason => {
    openSession();
    useSceneStore.getState().openScene('git');
    flowChatStore.setState(state => ({ ...state, activeSessionId: null }));
    let complete!: (activated: boolean) => void;
    const activation = new Promise<boolean>(resolve => { complete = resolve; });
    const stop = registerSessionSceneNavigation({ current: () => null, isActive: () => false, activate: () => activation });
    let current = true;
    try {
      openContentInBestTarget({ type: 'code-editor', title: 'a.ts', data: { filePath: '/project/a.ts' } }, { isCurrent: () => current });
      expect(useSceneStore.getState().pendingTabId).toMatch(/^session:/);
      expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(0);
      if (reason === 'superseded') current = false;
      else { activateSurface('peer'); activateSurface('local'); }
      complete(true);
      await vi.waitFor(() => expect(useSceneStore.getState().pendingTabId).toBeNull());
      expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(0);
      expect(useSceneStore.getState().activeTabId).toBe('git');
      expect(appManager.getState().layout.rightPanelCollapsed).toBe(true);
    } finally { stop(); }
  });

  it.each(['closed', 'replaced', 'scope-changed'])('cancels content when the destination changes during activation: %s', async reason => {
    const target = openSession();
    useSceneStore.getState().openScene('git');
    let complete!: (activated: boolean) => void;
    let isCurrent = () => true;
    const activation = new Promise<boolean>(resolve => { complete = resolve; });
    const stop = registerSessionSceneNavigation({ current: () => null, isActive: () => false,
      activate: (_target, current) => { isCurrent = current; return activation; } });
    try {
      fileTabManager.openFile({ filePath: '/project/a.ts' });
      expect(useSceneStore.getState().pendingTabId).toBe(getSessionSceneTabId(target));
      if (reason === 'closed') await useSceneStore.getState().closeScene(getSessionSceneTabId(target));
      else if (reason === 'replaced') {
        selectSession('replacement');
        useSceneStore.getState().updateSessionScene({ ...target, sessionId: 'replacement' });
      } else selectSession(target.sessionId, { workspaceId: undefined, workspacePath: '/other' });
      expect(isCurrent()).toBe(false);
      complete(true);
      await vi.waitFor(() => expect(useSceneStore.getState().pendingTabId).toBeNull());
      expect(useSceneStore.getState().activeTabId).toBe('git');
      const retained = useSceneStore.getState().openTabs.find(tab => tab.id === getSessionSceneTabId(target));
      if (reason === 'closed') expect(retained).toBeUndefined();
      if (reason === 'replaced') expect(retained?.session?.sessionId).toBe('replacement');
      expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(0);
      expect(Object.values(useContentResourceStore.getState().resources)).toHaveLength(0);
      expect(appManager.getState().layout.rightPanelCollapsed).toBe(true);
    } finally { stop(); }
  });

  it('activates an existing session tab before committing and preserves the previous scope canvas', async () => {
    openSession();
    useSceneStore.getState().openScene('git');
    flowChatStore.setState(state => ({ ...state, activeSessionId: null }));
    switchAgentCanvasScope('scratch-session');
    useAgentCanvasStore.getState().addTab({ type: 'markdown-viewer', title: 'Previous', data: 'draft' }, 'active');
    const previous = useAgentCanvasStore.getState().primaryGroup.tabs[0];
    const stop = registerSessionSceneNavigation({ current: () => null, isActive: () => false,
      activate: async target => {
        flowChatStore.setState(state => ({ ...state, activeSessionId: target.sessionId }));
        return true;
      } });
    try {
      fileTabManager.openFile({ filePath: '/project/a.ts' });
      await vi.waitFor(() => expect(useAgentCanvasStore.getState().scopeKey).toBe('session-a'));
      expect(useAgentCanvasStore.getState().primaryGroup.tabs[0].content.data.filePath).toBe('/project/a.ts');
      expect(flowChatStore.getState().activeSessionId).toBe('session-a');
      switchAgentCanvasScope('scratch-session');
      expect(useAgentCanvasStore.getState().primaryGroup.tabs.map(tab => tab.id)).toEqual([previous.id]);
    } finally { stop(); }
  });

  it('keeps content and layout unchanged when settings exit is canceled', async () => {
    openSession();
    useSceneStore.getState().openScene('settings');
    const draft = registerSettingsDraft({ id: 'settings-draft', pageId: 'page', label: 'Settings', dirty: true,
      save: () => true, discard: () => {} });
    try {
      fileTabManager.openFile({ filePath: '/project/a.ts' });
      expect(useSceneStore.getState().activeTabId).toBe('settings');
      expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(0);
      expect(appManager.getState().layout.rightPanelCollapsed).toBe(true);
      cancelPendingSettingsNavigation();
      expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(0);
      fileTabManager.openFile({ filePath: '/project/a.ts' });
      await discardAndContinueSettingsNavigation();
      expect(useSceneStore.getState().activeTabId).toMatch(/^session:/);
      expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(1);
      expect(appManager.getState().layout.rightPanelCollapsed).toBe(false);
    } finally { draft(); }
  });

  it.each(['closed', 'replaced'])('does not restore a destination changed while settings exit is pending: %s', async reason => {
    const target = openSession();
    useSceneStore.getState().openScene('settings');
    const draft = registerSettingsDraft({ id: 'settings-draft', pageId: 'page', label: 'Settings', dirty: true,
      save: () => true, discard: () => {} });
    const activate = vi.fn(async () => true);
    const stop = registerSessionSceneNavigation({ current: () => null, isActive: () => false, activate });
    try {
      fileTabManager.openFile({ filePath: '/project/a.ts' });
      expect(activate).not.toHaveBeenCalled();
      if (reason === 'closed') await useSceneStore.getState().closeScene(getSessionSceneTabId(target));
      else {
        selectSession('replacement');
        useSceneStore.getState().updateSessionScene({ ...target, sessionId: 'replacement' });
      }
      await discardAndContinueSettingsNavigation();
      expect(activate).not.toHaveBeenCalled();
      expect(useSceneStore.getState().activeTabId).toBe('settings');
      const retained = useSceneStore.getState().openTabs.find(tab => tab.id === getSessionSceneTabId(target));
      if (reason === 'closed') expect(retained).toBeUndefined();
      else expect(retained?.session?.sessionId).toBe('replacement');
      expect(useAgentCanvasStore.getState().primaryGroup.tabs).toHaveLength(0);
      expect(Object.values(useContentResourceStore.getState().resources)).toHaveLength(0);
      expect(appManager.getState().layout.rightPanelCollapsed).toBe(true);
    } finally { stop(); draft(); }
  });

  it('does not remove a dirty document after a canceled close and shares repeated close requests', async () => {
    fileTabManager.openFile({ filePath: '/project/a.ts' });
    const tab = useSceneStore.getState().openTabs[0];
    const resourceId = tab.contentId!;
    useContentResourceStore.getState().update(resourceId, { isDirty: true });
    let resolve!: (approved: boolean) => void;
    const guard = vi.fn(() => new Promise<boolean>(done => { resolve = done; }));
    const stop = registerContentCloseGuard(resourceId, guard);
    useSceneStore.getState().closeScene(tab.id);
    useSceneStore.getState().closeScene(tab.id);
    expect(guard).toHaveBeenCalledTimes(1);
    resolve(false);
    await vi.waitFor(() => expect(useSceneStore.getState().openTabs).toHaveLength(1));
    expect(useContentResourceStore.getState().resources[resourceId].isDirty).toBe(true);
    stop();
  });
  it('restores file tabs by device without discarding their resource state', () => {
    fileTabManager.openFile({ filePath: '/project/a.ts' });
    const localTab = useSceneStore.getState().openTabs[0];
    useContentResourceStore.getState().update(localTab.contentId!, { isDirty: true });
    useSceneStore.getState().resetForPeerSwitch();
    activateSurface('peer');
    useSceneStore.getState().resetForPeerSwitch(true);
    fileTabManager.openFile({ filePath: '/project/a.ts' });
    expect(useSceneStore.getState().openTabs[0].contentId).not.toBe(localTab.contentId);
    useSceneStore.getState().resetForPeerSwitch();
    activateSurface('local');
    useSceneStore.getState().resetForPeerSwitch(true);
    expect(useSceneStore.getState().openTabs[0].id).toBe(localTab.id);
    expect(useContentResourceStore.getState().resources[localTab.contentId!].isDirty).toBe(true);
  });
  it('pins and reorders tabs without changing document identity or navigation history', () => {
    fileTabManager.openFile({ filePath: '/project/a.ts' });
    fileTabManager.openFile({ filePath: '/project/b.ts' });
    fileTabManager.openFile({ filePath: '/project/c.ts' });
    const [a, b, c] = useSceneStore.getState().openTabs;
    const history = useSceneStore.getState().navHistory;
    useSceneStore.getState().togglePinScene(b.id);
    useSceneStore.getState().reorderScene(a.id, c.id, 'after');
    expect(useSceneStore.getState().openTabs.map(tab => tab.id)).toEqual([b.id, c.id, a.id]);
    expect(useSceneStore.getState().navHistory).toEqual(history);
    expect(Object.keys(useContentResourceStore.getState().resources)).toHaveLength(3);
  });
  it('rejects a pending close after switching away and back to the same device', async () => {
    fileTabManager.openFile({ filePath: '/project/a.ts' });
    const tab = useSceneStore.getState().openTabs[0];
    let resolve!: (approved: boolean) => void;
    const stop = registerContentCloseGuard(tab.contentId!, () => new Promise<boolean>(done => { resolve = done; }));
    const close = useSceneStore.getState().closeScene(tab.id);
    activateSurface('peer');
    activateSurface('local');
    resolve(true);
    await close;
    expect(useSceneStore.getState().openTabs[0].id).toBe(tab.id);
    stop();
  });
  it('routes repeated jumps through the resource tab and retains line columns', async () => {
    fileTabManager.openFile({ filePath: '/project/a.ts' });
    const tab = useSceneStore.getState().openTabs[0];
    useSceneStore.getState().openScene('git');
    await editorJumpService.jumpToFile('/project/a.ts', 7, 8);
    const firstToken = useContentResourceStore.getState().resources[tab.contentId!].content.data.navigationToken;
    await editorJumpService.jumpToFile('/project/a.ts', 7, 8);
    expect(useSceneStore.getState().activeTabId).toBe(tab.id);
    expect(useContentResourceStore.getState().resources[tab.contentId!].content.data).toMatchObject({ jumpToLine: 7, jumpToColumn: 8 });
    expect(useContentResourceStore.getState().resources[tab.contentId!].content.data.navigationToken).not.toBe(firstToken);
  });
  it('applies rename notifications to their originating device while it is suspended', () => {
    fileTabManager.openFile({ filePath: '/project/a.ts' });
    const tab = useSceneStore.getState().openTabs[0];
    activateSurface('peer');
    globalEventBus.emit('workspace:file-renamed', { surfaceId: 'local', workspaceId: 'project', oldPath: '/project/a.ts', newPath: '/project/b.ts' });
    expect(useContentResourceStore.getState().resources[tab.contentId!].target).toEqual({ kind: 'file', path: '/project/b.ts' });
  });
  it('detaches regular terminals on tab close and reconciles explicit renames and destruction', async () => {
    createTerminalTab('pty-a', 'Terminal A');
    const first = useSceneStore.getState().openTabs[0];
    window.dispatchEvent(new CustomEvent('terminal-session-renamed', { detail: { sessionId: 'pty-a', newName: 'Build', surfaceId: 'local' } }));
    expect(useContentResourceStore.getState().resources[first.contentId!].content.title).toBe('Build');
    await useSceneStore.getState().closeScene(first.id);
    expect(useSceneStore.getState().openTabs).toHaveLength(0);
    createTerminalTab('pty-a', 'Build');
    window.dispatchEvent(new CustomEvent('terminal-session-destroyed', { detail: { sessionId: 'pty-a', surfaceId: 'local' } }));
    await vi.waitFor(() => expect(useSceneStore.getState().openTabs).toHaveLength(0));
  });

});
