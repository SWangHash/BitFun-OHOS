/**
 * HarmonyOS bridge for commands sent by the pet window.
 *
 * The pet window is an ArkUI window whose webview has no Tauri IPC, so ArkTS
 * carries its commands to the main window and injects them as
 * `window.__bitfunAgentCompanionCommand(jsonString)` with
 * `{ event, payload }` — the same event names the desktop pet window publishes
 * through `@tauri-apps/api/event`.
 *
 * The handlers are the ones `App.tsx` already runs for its Tauri listeners, so
 * this module exists only to reach them from an injection instead of the event
 * bus. Data flowing back to the pet window still uses `emit`, which the OHOS
 * relay in the Rust host forwards to the pet webview.
 */

import type { AgentCompanionPetCommand } from '@/app/services/agentCompanionPetCommands';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('AgentCompanionHostCommandBridge');

interface HostCommandMessage {
  event?: string;
  payload?: unknown;
}

declare global {
  interface Window {
    __bitfunAgentCompanionCommand?: (messageJson: string) => void;
  }
}

async function syncSettingsAndActivityToPetWindow(): Promise<void> {
  const [
    { aiExperienceConfigService },
    { buildAgentCompanionActivity },
    { emitAgentCompanionActivity },
  ] = await Promise.all([
    import('@/infrastructure/config/services/AIExperienceConfigService'),
    import('@/flow_chat/utils/agentCompanionActivity'),
    import('@/flow_chat/services/AgentCompanionActivityBridge'),
  ]);
  const { emit } = await import('@tauri-apps/api/event');
  const settings = await aiExperienceConfigService.getSettingsAsync({ forceRefresh: true });
  await emit('agent-companion://settings-updated', settings);
  await emitAgentCompanionActivity(buildAgentCompanionActivity());
}

async function handleHostCommand(message: HostCommandMessage): Promise<void> {
  switch (message.event) {
    case 'agent-companion://ready':
      await syncSettingsAndActivityToPetWindow();
      return;
    case 'agent-companion://pet-command': {
      const { handleAgentCompanionPetCommand } = await import('@/app/services/agentCompanionPetCommands');
      await handleAgentCompanionPetCommand(message.payload as AgentCompanionPetCommand);
      return;
    }
    case 'agent-companion://open-session': {
      const sessionId = (message.payload as { sessionId?: string } | null)?.sessionId;
      if (!sessionId) {
        return;
      }
      const { openAgentCompanionSession } = await import('@/app/services/openAgentCompanionSession');
      await openAgentCompanionSession(sessionId);
      const { api } = await import('@/infrastructure/api/service-api/ApiClient');
      await api.invoke('show_main_window');
      return;
    }
    case 'agent-companion://show-main-window': {
      const { api } = await import('@/infrastructure/api/service-api/ApiClient');
      await api.invoke('show_main_window');
      return;
    }
    default:
      log.warn('Ignored unknown Agent companion host command', { event: message.event });
  }
}

/**
 * Install the injection target. Safe to call more than once: the previous
 * handler is replaced so a hot reload cannot stack dispatchers.
 */
export function ensureAgentCompanionHostCommandBridge(): void {
  window.__bitfunAgentCompanionCommand = (messageJson: string) => {
    let message: HostCommandMessage;
    try {
      message = JSON.parse(messageJson) as HostCommandMessage;
    } catch (error) {
      log.warn('Ignored malformed Agent companion host command', { error });
      return;
    }
    void handleHostCommand(message).catch(error => {
      log.warn('Agent companion host command failed', { event: message.event, error });
    });
  };
}
