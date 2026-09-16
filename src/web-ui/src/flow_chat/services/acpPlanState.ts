import { create } from 'zustand';
import { ACPClientAPI, type AcpPlanUpdatedEvent } from '@/infrastructure/api/service-api/ACPClientAPI';
import { agentAPI } from '@/infrastructure/api/service-api/AgentAPI';

// Runtime presentation only: retain the latest report while its turn is running.
export const useAcpPlanStore = create<{ plans: Map<string, AcpPlanUpdatedEvent> }>(() => ({
  plans: new Map(),
}));

export function initializeAcpPlanState(): () => void {
  const clearTurn = (event: { sessionId?: string; turnId?: string }) => {
    const current = event.sessionId && useAcpPlanStore.getState().plans.get(event.sessionId);
    if (!current || current.turnId !== event.turnId) return;
    useAcpPlanStore.setState(({ plans }) => {
      const next = new Map(plans);
      next.delete(current.sessionId);
      return { plans: next };
    });
  };
  const unlisteners = [
    ACPClientAPI.onPlanUpdated((event) => {
      useAcpPlanStore.setState(({ plans }) => ({
        plans: new Map(plans).set(event.sessionId, event),
      }));
    }),
    agentAPI.onDialogTurnCompleted(clearTurn),
    agentAPI.onDialogTurnCancelled(clearTurn),
    agentAPI.onDialogTurnFailed(clearTurn),
  ];
  return () => {
    unlisteners.forEach((unlisten) => unlisten());
    useAcpPlanStore.setState({ plans: new Map() });
  };
}
