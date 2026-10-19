import { workspaceManager } from '@/infrastructure/services/business/workspaceManager';
import { configManager } from '@/infrastructure/config/services/ConfigManager';
import type { TerminalConfig } from '@/infrastructure/config/types';
import { getTerminalService } from '@/tools/terminal/services/TerminalService';
import { registerPendingTerminalSpawn } from '@/tools/terminal/services/pendingTerminalSpawn';
import type { CreateSessionRequest, SessionResponse } from '@/tools/terminal/types/session';
import { getActiveSurfaceScope } from '@/infrastructure/peer-device/deviceSurface';

export interface CreateManualTerminalSessionOptions {
  workspaceId: string;
  workspacePath?: string;
  shellType?: string;
  shellId?: string;
  name?: string;
  sessionId?: string;
}

/** A manual terminal that has an identity but no shell yet. See `prepareManualTerminalSession`. */
export interface PreparedManualTerminalSession {
  sessionId: string;
  name: string;
}

interface ResolvedManualTerminalRequest {
  request: CreateSessionRequest;
  name: string;
}

async function getDefaultShellPreference(): Promise<string | undefined> {
  try {
    const config = await configManager.getConfig<TerminalConfig>('terminal');
    return config?.default_shell || undefined;
  } catch {
    return undefined;
  }
}

async function resolveDefaultShellSelection(
  service: ReturnType<typeof getTerminalService>,
): Promise<Pick<CreateSessionRequest, 'shellId' | 'shellType'>> {
  const preference = await getDefaultShellPreference();
  if (!preference) {
    return {};
  }

  try {
    const shell = (await service.getAvailableShells()).find(
      (candidate) => candidate.path === preference,
    );
    return shell ? { shellId: shell.id, shellType: shell.shellType } : {};
  } catch {
    return {};
  }
}

function createTerminalSessionId(): string {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  // Non-secure WebKit builds may lack `randomUUID`; the ID only has to be unique here.
  return `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function resolveManualTerminalRequest(
  options: CreateManualTerminalSessionOptions,
): Promise<ResolvedManualTerminalRequest> {
  const state = workspaceManager.getState();
  const workspace = state.openedWorkspaces.get(options.workspaceId)
    || state.recentWorkspaces.find(record => record.id === options.workspaceId);
  if (!workspace) throw new Error('Terminal workspace ID is unavailable');
  const service = getTerminalService();
  const scope = getActiveSurfaceScope();
  await service.connect();
  scope.assertCurrent('create manual terminal');

  const [sessions, shellSelection] = await Promise.all([
    service.listSessions(),
    workspace.workspaceKind === 'remote' ? Promise.resolve({}) : resolveDefaultShellSelection(service),
  ]);
  scope.assertCurrent('create manual terminal');
  const manualCount = sessions.filter((session) => session.source === 'manual').length;
  const name = options.name ?? `Shell ${manualCount + 1}`;

  const request: CreateSessionRequest = {
    workspaceId: options.workspaceId,
    workingDirectory: options.workspacePath,
    name,
    sessionId: options.sessionId,
    ...(options.shellId ? { shellId: options.shellId, shellType: options.shellType }
      : options.shellType && options.shellType !== 'Remote' ? { shellType: options.shellType } : shellSelection),
    source: 'manual',
  };

  return { request, name };
}

/** Create a regular user terminal without requiring the Shell navigation UI. */
export async function createManualTerminalSession(
  options: CreateManualTerminalSessionOptions,
): Promise<SessionResponse> {
  const { request } = await resolveManualTerminalRequest(options);
  return getTerminalService().createSession(request);
}

/**
 * Reserve a manual terminal session without starting its shell.
 *
 * The caller opens the tab with the returned ID; the terminal panel then creates the PTY
 * with the geometry it measured for itself (`pendingTerminalSpawn`). Starting the shell
 * eagerly would size it to the backend default, and the shell would lay out its first
 * prompt for that width instead of the panel's.
 */
export async function prepareManualTerminalSession(
  options: CreateManualTerminalSessionOptions,
): Promise<PreparedManualTerminalSession> {
  const { request, name } = await resolveManualTerminalRequest(options);
  const sessionId = request.sessionId ?? createTerminalSessionId();
  registerPendingTerminalSpawn(sessionId, {
    surfaceId: getActiveSurfaceScope().surfaceId,
    request: { ...request, sessionId },
  });

  return { sessionId, name };
}
