import { useSceneStore } from '@/app/stores/sceneStore';
import { useContentResourceStore, contentResourceIdentity, mergeContentOpenIntent } from '@/app/workbench/contentResourceStore';
import { openAgentCanvasTabForSessionInBackground, switchAgentCanvasScope, useAgentCanvasStore, useGitCanvasStore } from '@/app/components/panels/content-canvas/stores';
import type { EditorGroupId } from '@/app/components/panels/content-canvas/types';
import type { SessionSceneTarget } from '@/app/components/SceneBar/types';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import type { Session } from '@/flow_chat/types/flow-chat';
import { sessionExecutionWorkspacePath, sessionWorkspaceId } from '@/flow_chat/utils/sessionWorkspace';
import { resolveLegacySessionWorkspace } from '@/infrastructure/api/service-api/legacyWorkspaceCompatibility';
import { workspaceManager } from '@/infrastructure/services/business/workspaceManager';
import { getActiveSurfaceId, getActiveSurfaceScope } from '@/infrastructure/peer-device/deviceSurface';
import type { PanelContent } from '@/app/components/panels/base/types';
import type { ContentResourceScope, OpenContentOptions } from '@/shared/types/contentResource';
import { closeAdoptedBrowserPage } from '@/app/scenes/browser/closeAdoptedBrowserPage';

export function captureContentScope(data?: { workspaceId?: string; workspacePath?: string; remoteConnectionId?: string }): ContentResourceScope {
  const state = workspaceManager.getState();
  const records = [...state.openedWorkspaces.values(), ...state.recentWorkspaces];
  const workspace = data?.workspaceId
    ? records.find(record => record.id === data.workspaceId)
    : data?.workspacePath
      // Temporary ingress for old tab data. Never prefer the active record when paths collide.
      ? resolveLegacySessionWorkspace(data, records.filter((record, index) => records.findIndex(candidate => candidate.id === record.id) === index))
      : state.currentWorkspace;
  if ((data?.workspaceId || data?.workspacePath) && !workspace) {
    // A session's registered execution workspace can be absent from the UI's
    // opened/recent catalog after worktree binding. Resolve its explicit ID
    // from the current surface's sessions, never from a matching path.
    if (data.workspaceId) {
      for (const session of flowChatStore.getState().sessions.values()) {
        if (sessionWorkspaceId(session) !== data.workspaceId) continue;
        return {
          surfaceId: getActiveSurfaceId(), workspaceId: data.workspaceId,
          workspacePath: sessionExecutionWorkspacePath(session),
          remoteConnectionId: session.remoteConnectionId || session.config?.remoteConnectionId,
        };
      }
    }
    throw new Error('Workspace identity is unavailable or ambiguous; select its workspace ID.');
  }
  return {
    surfaceId: getActiveSurfaceId(), workspaceId: workspace?.id,
    workspacePath: workspace?.rootPath,
    remoteConnectionId: workspace?.workspaceKind === 'remote' ? workspace.connectionId : undefined,
  };
}

/** Content opens commit state directly, independently of any mounted view. */
export function openWorkbenchContent(content: PanelContent, options: OpenContentOptions = {}): string {
  const scope = options.scope ?? captureContentScope(content.data);
  if (scope.surfaceId !== getActiveSurfaceId()) throw new Error('The resource belongs to another device surface.');
  const id = useContentResourceStore.getState().open(content, scope, options.resourceKey, options.replaceExisting, options.documentId);
  useSceneStore.getState().openContentScene(id, options.focus !== false);
  return id;
}

export interface ContentOpenOptions extends Pick<OpenContentOptions, 'scope' | 'resourceKey' | 'replaceExisting' | 'focus'> {
  isCurrent?: () => boolean;
  targetGroup?: EditorGroupId;
  splitView?: boolean;
}

/** Commit to an explicitly selected inline host; the host owns navigation and layout. */
export function openCanvasContent(mode: 'agent' | 'git', input: PanelContent, options: ContentOpenOptions = {}): void {
  if (options.isCurrent && !options.isCurrent()) return;
  const scope = options.scope ?? captureContentScope(input.data);
  if (scope.surfaceId !== getActiveSurfaceId()) throw new Error('The resource belongs to another device surface.');
  const { key, target } = contentResourceIdentity(input, scope, options.resourceKey);
  const content = { ...input,
    data: input.data !== null && typeof input.data === 'object' ? { ...input.data,
      ...(target.kind === 'file' ? { filePath: target.path } : {}),
      workspaceId: scope.workspaceId, workspacePath: scope.workspacePath, remoteConnectionId: scope.remoteConnectionId } : input.data,
    metadata: { ...input.metadata, resourceScope: scope, contentResourceKey: key },
  };
  const store = (mode === 'git' ? useGitCanvasStore : useAgentCanvasStore).getState();
  const syncBrowserOwner = () => {
    const ownerSessionId = browserOwnerSessionId(content);
    if (mode === 'agent' && ownerSessionId) {
      store.syncSessionOwnedBrowserTabs(ownerSessionId, { revealPending: true });
    }
  };
  const groups = [store.primaryGroup, store.secondaryGroup, store.tertiaryGroup];
  const groupIds: EditorGroupId[] = ['primary', 'secondary', 'tertiary'];
  for (const [index, group] of groups.entries()) {
    const existing = group.tabs.find(tab => (tab.content.metadata?.contentResourceKey
      ?? contentResourceIdentity(tab.content, tab.content.metadata?.resourceScope
        ?? captureContentScope(tab.content.data)).key) === key);
    if (!existing) continue;
    const groupId = groupIds[index];
    const nextContent = mergeContentOpenIntent(existing.content, content, options.replaceExisting, existing.isDirty);
    if (existing.content.data?.webviewLabel !== nextContent.data?.webviewLabel) closeAdoptedBrowserPage(existing.content);
    store.updateTabContent(existing.id, groupId, nextContent);
    store.switchToTab(existing.id, groupId);
    store.promoteTab(existing.id, groupId);
    syncBrowserOwner();
    return;
  }
  if (options.splitView && store.layout.splitMode === 'none') store.setSplitMode('vertical');
  store.addTab(content, 'active', options.targetGroup);
  syncBrowserOwner();
}

function sessionMatchesContentScope(session: Session, scope: ContentResourceScope): boolean {
  if (session.isTransient || session.sessionKind === 'subagent' || session.persistedStatus === 'archived') return false;
  if (!scope.workspaceId) return false;
  return session.workspaceId === scope.workspaceId || session.config?.workspaceId === scope.workspaceId
    || session.projectWorkspaceId === scope.workspaceId || session.config?.projectWorkspaceId === scope.workspaceId;
}

function browserOwnerSessionId(content: PanelContent): string | undefined {
  if (content.type !== 'browser') return undefined;
  const owner = content.data?.ownerSessionId ?? content.metadata?.ownerSessionId;
  return typeof owner === 'string' && owner.trim() ? owner.trim() : undefined;
}

function withBrowserSessionOwner(content: PanelContent, ownerSessionId: string | undefined): PanelContent {
  if (content.type !== 'browser' || !ownerSessionId) return content;
  return {
    ...content,
    data: { ...content.data, ownerSessionId },
    metadata: { ...content.metadata, ownerSessionId },
  };
}

function browserSessionResourceKey(
  content: PanelContent,
  resourceKey: string | undefined,
  ownerSessionId: string | undefined,
): string | undefined {
  if (content.type !== 'browser' || !ownerSessionId) return resourceKey;
  const base = resourceKey ?? content.metadata?.duplicateCheckKey;
  if (typeof base !== 'string' || !base) return resourceKey;
  const suffix = `:session:${ownerSessionId}`;
  return base.endsWith(suffix) ? base : `${base}${suffix}`;
}

function preferredOpenSessionTarget(
  scope: ContentResourceScope,
  ownerSessionId?: string,
): SessionSceneTarget | undefined {
  const { sessions } = flowChatStore.getState();
  const { openTabs, activeTabId } = useSceneStore.getState();
  // Only the tab owner knows whether a session is open. FlowChat's selection and
  // cached history survive closing a tab and must never reopen it for content.
  const tabs = openTabs.filter(tab => tab.session?.surfaceId === scope.surfaceId)
    .sort((a, b) => Number(b.id === activeTabId) - Number(a.id === activeTabId) || b.lastUsed - a.lastUsed);
  if (ownerSessionId) {
    const owned = tabs.find(tab => tab.session?.sessionId === ownerSessionId)?.session;
    const session = owned ? sessions.get(owned.sessionId) : undefined;
    return owned && session && sessionMatchesContentScope(session, scope) ? owned : undefined;
  }
  for (const tab of tabs) {
    const target = tab.session!;
    const session = sessions.get(target.sessionId);
    if (session && sessionMatchesContentScope(session, scope)) return target;
  }
  return undefined;
}

/** Reuse a main view; new content prefers an already open session in its scope. */
export function openContentInBestTarget(content: PanelContent, options: ContentOpenOptions = {}): void {
  if (options.isCurrent && !options.isCurrent()) return;
  const scope = options.scope ?? captureContentScope(content.data);
  if (scope.surfaceId !== getActiveSurfaceId()) throw new Error('The resource belongs to another device surface.');
  const requestedOwnerSessionId = browserOwnerSessionId(content);
  const target = preferredOpenSessionTarget(scope, requestedOwnerSessionId);
  const ownerSessionId = requestedOwnerSessionId ?? (content.type === 'browser' ? target?.sessionId : undefined);
  const ownedContent = withBrowserSessionOwner(content, ownerSessionId);
  const resourceKey = browserSessionResourceKey(ownedContent, options.resourceKey, ownerSessionId);
  if (resourceKey && ownedContent.metadata?.duplicateCheckKey !== resourceKey) {
    ownedContent.metadata = { ...ownedContent.metadata, duplicateCheckKey: resourceKey };
  }
  const identity = contentResourceIdentity(ownedContent, scope, resourceKey);
  const mainView = Object.values(useContentResourceStore.getState().resources).find(resource => resource.key === identity.key);
  if (mainView && options.replaceExisting && !mainView.isDirty
    && mainView.content.data?.webviewLabel !== ownedContent.data?.webviewLabel) {
    closeAdoptedBrowserPage(mainView.content, scope.surfaceId);
  }
  if (options.focus === false && requestedOwnerSessionId && !mainView) {
    const session = flowChatStore.getState().sessions.get(requestedOwnerSessionId);
    if (session && sessionMatchesContentScope(session, scope)) {
      // Keep a prepared page in its owner session's snapshot: the presented
      // session owns the visible canvas and must not be navigated or reselected.
      openAgentCanvasTabForSessionInBackground(requestedOwnerSessionId, {
        content: { ...ownedContent, metadata: { ...ownedContent.metadata,
          resourceScope: scope, contentResourceKey: identity.key,
          duplicateCheckKey: resourceKey ?? identity.key } },
        checkDuplicate: true,
        duplicateCheckKey: resourceKey ?? identity.key,
        replaceExisting: options.replaceExisting,
      });
      return;
    }
  }
  if (options.focus === false) {
    openWorkbenchContent(ownedContent, { ...options, scope, resourceKey });
    return;
  }
  if (mainView || !target) {
    openWorkbenchContent(ownedContent, { ...options, scope, resourceKey });
    return;
  }

  const surface = getActiveSurfaceScope();
  const isCurrent = () => {
    const currentSession = flowChatStore.getState().sessions.get(target.sessionId);
    return surface.isCurrent() && (options.isCurrent?.() ?? true)
      && Boolean(currentSession && sessionMatchesContentScope(currentSession, scope));
  };
  useSceneStore.getState().activateSessionScene(target, {
    isCurrent,
    revealCanvas: true,
    onActivated: () => {
      if (!isCurrent()) return;
      // Scope selection must precede the write, including before AuxPane's first
      // mount: the canvas is owned by the session that shows the content.
      switchAgentCanvasScope(target.sessionId);
      openCanvasContent('agent', ownedContent, { ...options, scope, resourceKey });
    },
  });
}
