import { appManager } from '@/app/services/AppManager';
import { useSceneStore } from '@/app/stores/sceneStore';
import { flowChatStore } from '../store/FlowChatStore';
import type { Session } from '../types/flow-chat';
import { flowChatManager } from './FlowChatManager';
import { syncSessionToModernStore } from './storeSync';
import { workspaceManager } from '@/infrastructure/services/business/workspaceManager';
import { getActiveSurfaceScope } from '@/infrastructure/peer-device/deviceSurface';
import { resolveSessionSceneWorkspace } from '@/app/services/sessionSceneTarget';
import { sessionProjectWorkspacePath } from '../utils/sessionWorkspace';
import { i18nService } from '@/infrastructure/i18n';

interface SessionActivationOptions {
  workspaceId?: string;
  activateWorkspace?: (workspaceId: string) => void | Promise<unknown>;
  isCurrent?: () => boolean;
}

let activationRequest = 0;
let workspaceActivation: Promise<unknown> = Promise.resolve();

export async function openMainSession(
  sessionId: string,
  options?: SessionActivationOptions,
): Promise<void> {
  const activated = await activateMainSession(sessionId, options);
  if (!activated) return;
  appManager.updateLayout({
    leftPanelActiveTab: 'sessions',
    leftPanelCollapsed: false,
  });

  useSceneStore.getState().openScene('session');
}

export async function activateMainSession(sessionId: string, options?: SessionActivationOptions): Promise<boolean> {
  const scope = getActiveSurfaceScope();
  const request = ++activationRequest;
  const isCurrent = () => scope.isCurrent() && request === activationRequest && (options?.isCurrent?.() ?? true);
  if (!isCurrent()) return false;
  const session = flowChatStore.getState().sessions.get(sessionId);
  const workspace = session && resolveSessionSceneWorkspace(session, workspaceManager.getState().openedWorkspaces.values());
  const workspaceId = options?.workspaceId ?? workspace?.id;
  if (session && sessionProjectWorkspacePath(session) && !workspaceId
    && workspaceManager.getState().currentWorkspace) {
    throw new Error(i18nService.t('common:sceneBar.workspaceUnavailable'));
  }
  if (workspaceId) {
    // Workspace activation mutates the host as well as the frontend. Serialize
    // it so a slow A request cannot finish after a newer B request on the host.
    const activation = workspaceActivation.then(async () => {
      if (!isCurrent() || workspaceManager.getState().activeWorkspaceId === workspaceId) return;
      await (options?.activateWorkspace ?? (id => workspaceManager.setActiveWorkspace(id)))(workspaceId);
    });
    workspaceActivation = activation.catch(() => undefined);
    await activation;
    if (!isCurrent()) return false;
  }
  const isTargetActive = () => {
    const state = flowChatStore.getState();
    return isCurrent() && state.activeSessionId === sessionId && state.sessions.has(sessionId);
  };
  const targetSession = flowChatStore.getState().sessions.get(sessionId) ?? null;
  if (!targetSession) {
    return false;
  }

  if (isTargetActive()) {
    const activeSession = flowChatStore.getState().sessions.get(sessionId) ?? null;
    if (
      activeSession?.externalHistory?.mode === 'follow' || (activeSession?.isHistorical &&
      (activeSession.historyState === 'metadata-only' || activeSession.historyState === 'failed'))
    ) {
      await flowChatManager.switchChatSession(sessionId, isCurrent);
      if (!isTargetActive()) {
        return false;
      }
    }
    syncSessionToModernStore(sessionId);
  } else {
    await flowChatManager.switchChatSession(sessionId, isCurrent);
    if (!isTargetActive()) {
      return false;
    }
    syncSessionToModernStore(sessionId);
  }

  return true;
}

/**
 * Ensure the main session is active without forcing a re-activation when it
 * is already the active session and already showing content to the user.
 *
 * Calling openMainSession unconditionally can trigger
 * switchChatSession → loadSessionHistory, which reloads history from the
 * backend for several seconds even when the user is already viewing
 * persisted turns (isHistorical: true, historyState: 'metadata-only').
 *
 * Use this instead of openMainSession when the caller only needs to "make
 * sure A is active" (e.g. opening a child review/btw session), not "force
 * activate A regardless of its state".
 *
 * Options are forwarded to openMainSession when activation is actually needed.
 */
export function ensureMainSessionActive(
  sessionId: string,
  options?: SessionActivationOptions,
): void {
  const state = flowChatStore.getState();
  const session = state.sessions.get(sessionId);
  // A workspaceId option only matters when it differs from the currently
  // active workspace. When the target workspace is already active, the
  // option is a no-op for activation purposes and must not defeat the
  // guard (the log trace showed SessionsSection always passes
  // targetWorkspaceId, which made the guard miss on every review click).
  const needsWorkspaceSwitch = Boolean(
    options?.workspaceId &&
    workspaceManager.getState().activeWorkspaceId !== options.workspaceId
  );
  if (
    state.activeSessionId === sessionId &&
    session &&
    !needsWorkspaceSwitch &&
    hasRenderableSessionContent(session)
  ) {
    return;
  }
  void openMainSession(sessionId, options);
}

/**
 * Whether the session has any turns that would produce visible content.
 * When true, the user is already viewing content and re-activating the
 * session would only cause a needless reload.
 */
function hasRenderableSessionContent(session: Session): boolean {
  return session.dialogTurns.some(turn =>
    Boolean(turn.userMessage) ||
    (turn.status === 'image_analyzing' && turn.modelRounds.length === 0) ||
    turn.modelRounds.some(round => round.items.length > 0)
  );
}
