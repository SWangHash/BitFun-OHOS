// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useComputerUseEnabled } from './useComputerUseEnabled';

const mocks = vi.hoisted(() => ({
  harmony: false, get: vi.fn(), changed: (_path: string) => {},
}));
vi.mock('@/infrastructure/runtime/environment', () => ({ isOpenHarmonyRuntime: () => mocks.harmony }));
vi.mock('../services/ConfigManager', () => ({ configManager: {
  getConfig: mocks.get,
  onConfigChange: (changed: (path: string) => void) => { mocks.changed = changed; return () => {}; },
} }));

afterEach(() => vi.unstubAllGlobals());

describe('desktop control availability', () => {
  it.each([false, true])('honors saved choices only on a supported host (HarmonyOS: %s)', async harmony => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.harmony = harmony;
    mocks.get.mockReset().mockResolvedValue(true);
    function Entry() {
      const { computerUseEnabled } = useComputerUseEnabled();
      return <span>{String(computerUseEnabled)}</span>;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(<Entry />));
    expect(container.textContent).toBe(String(!harmony));
    expect(mocks.get).toHaveBeenCalledTimes(harmony ? 0 : 1);
    await act(async () => root.unmount());
  });
});
