import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateSurface, resetDeviceSurfaceForTest } from '@/infrastructure/peer-device/deviceSurface';
import { startFlowChatInitialization } from './flowChatInitialization';

describe('FlowChat initialization recovery', () => {
  let stop: (() => void) | undefined;
  beforeEach(() => {
    resetDeviceSurfaceForTest();
    vi.useFakeTimers();
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
    resetDeviceSurfaceForTest();
  });

  it.each([true, false])('recovers a failed read and preserves the history result %s', async hasHistory => {
    const failure = new Error('Session read timed out');
    const initialize = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(hasHistory);
    const createSession = vi.fn();
    const onInitialized = vi.fn(async (hasHistoricalSessions: boolean) => {
      if (!hasHistoricalSessions) createSession();
    });
    const onError = vi.fn();
    stop = startFlowChatInitialization({ initialize, onInitialized, onError });

    await vi.advanceTimersByTimeAsync(999);
    expect(onError).toHaveBeenCalledWith(failure, 1000);
    expect(onInitialized).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(onInitialized).toHaveBeenCalledExactlyOnceWith(hasHistory, expect.any(Function));
    expect(createSession).toHaveBeenCalledTimes(hasHistory ? 0 : 1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(onInitialized).toHaveBeenCalledTimes(1);
  });

  it('caps the retry interval while keeping a failed host recoverable', async () => {
    const initialize = vi.fn().mockRejectedValue(new Error('Host unavailable'));
    const onInitialized = vi.fn();
    const onError = vi.fn();
    stop = startFlowChatInitialization({ initialize, onInitialized, onError });
    await vi.advanceTimersByTimeAsync(0);
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      const attempts = initialize.mock.calls.length;
      expect(onError).toHaveBeenLastCalledWith(expect.any(Error), delay);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(initialize).toHaveBeenCalledTimes(attempts);
      await vi.advanceTimersByTimeAsync(1);
      expect(initialize).toHaveBeenCalledTimes(attempts + 1);
    }
    initialize.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onInitialized).toHaveBeenCalledTimes(1);
  });

  it('does not overlap a read that is still pending', async () => {
    let finish!: (hasHistory: boolean) => void;
    const initialize = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const onInitialized = vi.fn();
    stop = startFlowChatInitialization({ initialize, onInitialized, onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(initialize).toHaveBeenCalledTimes(1);
    finish(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onInitialized).toHaveBeenCalledTimes(1);
  });

  it('does not replay writes after successful initialization', async () => {
    const failure = new Error('Create acknowledgement lost');
    const initialize = vi.fn().mockResolvedValue(false);
    const onInitialized = vi.fn().mockRejectedValue(failure);
    const onError = vi.fn();
    stop = startFlowChatInitialization({ initialize, onInitialized, onError });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(onInitialized).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure, null);
  });

  it('cancels the old workspace timer before starting the next workspace', async () => {
    const initialize = vi.fn().mockRejectedValue(new Error('Old workspace unavailable'));
    const onInitialized = vi.fn();
    stop = startFlowChatInitialization({ initialize, onInitialized, onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    const nextInitialize = vi.fn().mockResolvedValue(true);
    stop = startFlowChatInitialization({ initialize: nextInitialize, onInitialized, onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(nextInitialize).toHaveBeenCalledTimes(1);
    expect(onInitialized).toHaveBeenCalledTimes(1);
  });

  it('discards an in-flight result after unmount', async () => {
    let finish!: (hasHistory: boolean) => void;
    const initialize = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const onInitialized = vi.fn();
    const onError = vi.fn();
    stop = startFlowChatInitialization({ initialize, onInitialized, onError });
    stop();
    finish(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onInitialized).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('cancels retries and delayed success actions on a device activation', async () => {
    const initialize = vi.fn().mockRejectedValue(new Error('Peer offline'));
    const onInitialized = vi.fn();
    const onError = vi.fn();
    stop = startFlowChatInitialization({ initialize, onInitialized, onError });
    await vi.advanceTimersByTimeAsync(0);
    activateSurface('peer-device');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);

    let isCurrent!: () => boolean;
    stop = startFlowChatInitialization({
      initialize: async () => true,
      onInitialized: async (_hasHistory, current) => { isCurrent = current; },
      onError,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(isCurrent()).toBe(true);
    activateSurface('local');
    expect(isCurrent()).toBe(false);
  });
});
