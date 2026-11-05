import type { Session } from '../types/flow-chat';
import type { SessionMetadata } from '@/shared/types/session-history';

const ACP_AGENT_TYPE_PREFIX = 'acp:';

export function acpClientIdFromAgentType(agentType: string | null | undefined): string | null {
  const value = agentType?.trim();
  if (!value?.startsWith(ACP_AGENT_TYPE_PREFIX)) return null;

  const clientId = value.slice(ACP_AGENT_TYPE_PREFIX.length).trim();
  return clientId || null;
}

export function isAcpAgentType(agentType: string | null | undefined): boolean {
  return acpClientIdFromAgentType(agentType) !== null;
}

export function acpAgentTypeFromMetadata(
  metadata: Pick<SessionMetadata, 'agentType' | 'customMetadata'>,
): string | null {
  const persistedClientId = acpClientIdFromAgentType(metadata.agentType);
  if (persistedClientId) return `${ACP_AGENT_TYPE_PREFIX}${persistedClientId}`;
  if (metadata.customMetadata?.provider !== 'acp') return null;

  const clientId = metadata.customMetadata.acpClientId;
  return typeof clientId === 'string' && clientId.trim()
    ? `${ACP_AGENT_TYPE_PREFIX}${clientId.trim()}`
    : null;
}

export function acpAgentTypeFromSession(
  session: Pick<Session, 'config' | 'mode'> | null | undefined,
): string | null {
  const configClientId = acpClientIdFromAgentType(session?.config?.agentType);
  if (configClientId) return `${ACP_AGENT_TYPE_PREFIX}${configClientId}`;

  const modeClientId = acpClientIdFromAgentType(session?.mode);
  return modeClientId ? `${ACP_AGENT_TYPE_PREFIX}${modeClientId}` : null;
}

export function isAcpFlowSession(
  session: Pick<Session, 'config' | 'mode'> | null | undefined,
): boolean {
  return acpAgentTypeFromSession(session) !== null;
}

export interface AcpSessionRef {
  sessionId: string;
  clientId: string;
  /** Workspace identity; the path and SSH fields are IO projections. */
  workspaceId?: string;
  workspacePath?: string;
  remoteConnectionId?: string;
  remoteSshHost?: string;
}

export function acpSessionRef(
  session:
    | Pick<
        Session,
        | 'sessionId'
        | 'config'
        | 'mode'
        | 'workspaceId'
        | 'workspacePath'
        | 'remoteConnectionId'
        | 'remoteSshHost'
      >
    | null
    | undefined,
): AcpSessionRef | null {
  if (!session?.sessionId) return null;

  const clientId =
    acpClientIdFromAgentType(session.config?.agentType) ??
    acpClientIdFromAgentType(session.mode);
  if (!clientId) return null;

  return {
    sessionId: session.sessionId,
    clientId,
    workspaceId: session.workspaceId ?? session.config?.workspaceId,
    workspacePath: session.workspacePath ?? session.config?.workspacePath,
    remoteConnectionId: session.remoteConnectionId ?? session.config?.remoteConnectionId,
    remoteSshHost: session.remoteSshHost,
  };
}

export function acpSlashCommandText(name: string): string {
  return `/${name} `;
}
