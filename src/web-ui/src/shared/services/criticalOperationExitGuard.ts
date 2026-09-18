export type CriticalOperationExitGuard = () => Promise<boolean>;

const guards = new Set<CriticalOperationExitGuard>();
const mainWindowCloseListeners = new Set<(inProgress: boolean) => void>();
let mainWindowCloseRequestInProgress = false;

export function setMainWindowCloseRequestInProgress(inProgress: boolean): void {
  if (mainWindowCloseRequestInProgress === inProgress) return;
  mainWindowCloseRequestInProgress = inProgress;
  for (const listener of Array.from(mainWindowCloseListeners)) {
    try {
      listener(inProgress);
    } catch {
      // One surface must not prevent the host close flow or other listeners.
    }
  }
}

export function isMainWindowCloseRequestInProgress(): boolean {
  return mainWindowCloseRequestInProgress;
}

export function subscribeMainWindowCloseRequest(
  listener: (inProgress: boolean) => void,
): () => void {
  mainWindowCloseListeners.add(listener);
  return () => mainWindowCloseListeners.delete(listener);
}

export function registerCriticalOperationExitGuard(
  guard: CriticalOperationExitGuard,
): () => void {
  guards.add(guard);
  return () => guards.delete(guard);
}

export async function confirmCriticalOperationExit(): Promise<boolean> {
  for (const guard of Array.from(guards)) {
    try {
      if (!(await guard())) return false;
    } catch {
      return false;
    }
  }
  return true;
}
