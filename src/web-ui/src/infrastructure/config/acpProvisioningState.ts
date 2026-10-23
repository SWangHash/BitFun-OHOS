import { useSyncExternalStore } from 'react';
import { ACPClientAPI, type AcpManagedProvisioningProgress } from '../api/service-api/ACPClientAPI';
import {
  getActiveSurfaceId,
  onSurfaceActivated,
  surfaceScopedKey,
  type SurfaceScope,
} from '../peer-device/deviceSurface';

interface ProvisioningOperation {
  key: string;
  clientId: string;
  remoteConnectionId?: string;
  managed: boolean;
  progress?: AcpManagedProvisioningProgress;
}

interface ProvisioningSnapshot {
  operations: readonly ProvisioningOperation[];
  completion?: { owner: symbol; revision: number };
}

const emptySnapshot: ProvisioningSnapshot = { operations: [] };
const snapshots = new Map<string, ProvisioningSnapshot>();
const listeners = new Set<() => void>();
let completionRevision = 0;

function snapshotFor(surfaceId: string): ProvisioningSnapshot {
  return snapshots.get(surfaceId) ?? emptySnapshot;
}

function publish(surfaceId: string, snapshot: ProvisioningSnapshot): void {
  snapshots.set(surfaceId, snapshot);
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const unsubscribeSurface = onSurfaceActivated(listener);
  return () => {
    listeners.delete(listener);
    unsubscribeSurface();
  };
}

/** Pending host work outlives the settings page or dialog observing it. */
export function useAcpProvisioningState(): ProvisioningSnapshot {
  return useSyncExternalStore(subscribe, () => snapshotFor(getActiveSurfaceId()));
}

export function hasManagedAcpSetup(surfaceId: string): boolean {
  return snapshotFor(surfaceId).operations.some(operation => operation.managed);
}

export function beginAcpProvisioning(
  scope: SurfaceScope,
  owner: symbol,
  options: { clientId: string; remoteConnectionId?: string; managed: boolean },
): { finish: () => void } | null {
  const key = surfaceScopedKey(scope.surfaceId, options.remoteConnectionId, options.clientId);
  const snapshot = snapshotFor(scope.surfaceId);
  if (snapshot.operations.some(operation => operation.key === key)) return null;
  publish(scope.surfaceId, { ...snapshot, operations: [...snapshot.operations, { ...options, key }] });
  // Register for the operation's lifetime, including while no dialog is mounted.
  const unsubscribe = options.managed ? ACPClientAPI.onManagedProvisioningProgress(progress => {
    if (!scope.isCurrent() || progress.clientId !== options.clientId) return;
    const current = snapshotFor(scope.surfaceId);
    const terminal = ['ready', 'cancelled', 'failed'].includes(progress.stage);
    publish(scope.surfaceId, {
      ...current,
      operations: current.operations.map(operation => operation.key === key
        ? { ...operation, progress: terminal ? undefined : progress } : operation),
    });
  }) : undefined;
  return {
    finish: () => {
      unsubscribe?.();
      const current = snapshotFor(scope.surfaceId);
      publish(scope.surfaceId, {
        operations: current.operations.filter(operation => operation.key !== key),
        completion: { owner, revision: ++completionRevision },
      });
    },
  };
}
