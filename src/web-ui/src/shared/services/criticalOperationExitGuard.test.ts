import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  confirmCriticalOperationExit,
  isMainWindowCloseRequestInProgress,
  registerCriticalOperationExitGuard,
  setMainWindowCloseRequestInProgress,
  subscribeMainWindowCloseRequest,
} from './criticalOperationExitGuard';

describe('criticalOperationExitGuard', () => {
  afterEach(() => setMainWindowCloseRequestInProgress(false));

  it('allows exit when there are no active operations', async () => {
    await expect(confirmCriticalOperationExit()).resolves.toBe(true);
  });

  it('blocks exit while an operation asks the user to keep waiting', async () => {
    const unregister = registerCriticalOperationExitGuard(async () => false);
    await expect(confirmCriticalOperationExit()).resolves.toBe(false);
    unregister();
    await expect(confirmCriticalOperationExit()).resolves.toBe(true);
  });

  it('stops after the first operation blocks exit', async () => {
    const later = vi.fn(async () => true);
    const unregisterFirst = registerCriticalOperationExitGuard(async () => false);
    const unregisterLater = registerCriticalOperationExitGuard(later);
    await expect(confirmCriticalOperationExit()).resolves.toBe(false);
    expect(later).not.toHaveBeenCalled();
    unregisterFirst();
    unregisterLater();
  });

  it('publishes the synchronous main-window close decision window', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMainWindowCloseRequest(listener);
    const unsubscribeFailing = subscribeMainWindowCloseRequest(() => {
      throw new Error('listener failed');
    });

    setMainWindowCloseRequestInProgress(true);
    expect(isMainWindowCloseRequestInProgress()).toBe(true);
    expect(listener).toHaveBeenLastCalledWith(true);

    setMainWindowCloseRequestInProgress(false);
    expect(isMainWindowCloseRequestInProgress()).toBe(false);
    expect(listener).toHaveBeenLastCalledWith(false);

    unsubscribe();
    unsubscribeFailing();
  });
});
