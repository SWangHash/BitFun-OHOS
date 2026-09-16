import type { AcpPlanEntry } from '@/infrastructure/api/service-api/ACPClientAPI';
import { useAcpPlanStore } from '../services/acpPlanState';

const EMPTY_ENTRIES: AcpPlanEntry[] = [];

export function useAcpPlan(sessionId: string | null): { entries: AcpPlanEntry[] } {
  const entries = useAcpPlanStore((state) =>
    sessionId ? state.plans.get(sessionId)?.entries ?? EMPTY_ENTRIES : EMPTY_ENTRIES,
  );
  return { entries };
}
