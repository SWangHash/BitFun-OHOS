// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const emitMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const listenMock = vi.hoisted(() => vi.fn(() => Promise.resolve(() => {})));
const invokeMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const cursorPositionMock = vi.hoisted(() => vi.fn(() => Promise.resolve({ x: 10, y: 20 })));

vi.mock('@tauri-apps/api/event', () => ({
  emit: emitMock,
  listen: listenMock,
}));

vi.mock('@tauri-apps/api/window', () => ({
  cursorPosition: cursorPositionMock,
  getCurrentWindow: () => ({
    hide: vi.fn(() => Promise.resolve()),
    setFocus: vi.fn(() => Promise.resolve()),
    outerPosition: vi.fn(() => Promise.resolve({ x: 100, y: 200 })),
    scaleFactor: vi.fn(() => Promise.resolve(1.5)),
    onMoved: vi.fn(() => Promise.resolve(() => {})),
    onScaleChanged: vi.fn(() => Promise.resolve(() => {})),
  }),
}));

vi.mock('@/infrastructure/api/service-api/ApiClient', () => ({
  api: { invoke: invokeMock },
}));

import {
  resetAgentCompanionPetWindowHostForTesting,
  resolveAgentCompanionPetWindowHost,
} from './agentCompanionPetWindowHost';

interface FakeProxy {
  post: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  showMainWindow: ReturnType<typeof vi.fn>;
  startDrag: ReturnType<typeof vi.fn>;
}

function installHarmonyOsProxy(): FakeProxy {
  const proxy: FakeProxy = {
    post: vi.fn(),
    hide: vi.fn(),
    resize: vi.fn(),
    focus: vi.fn(),
    showMainWindow: vi.fn(),
    startDrag: vi.fn(),
  };
  (window as unknown as { bitfunPetHost?: FakeProxy }).bitfunPetHost = proxy;
  return proxy;
}

describe('agentCompanionPetWindowHost', () => {
  beforeEach(() => {
    resetAgentCompanionPetWindowHostForTesting();
    emitMock.mockClear();
    listenMock.mockClear();
    invokeMock.mockClear();
  });

  afterEach(() => {
    delete (window as unknown as { bitfunPetHost?: FakeProxy }).bitfunPetHost;
    resetAgentCompanionPetWindowHostForTesting();
  });

  describe('desktop', () => {
    it('keeps the Tauri event bus and window geometry APIs', async () => {
      const host = resolveAgentCompanionPetWindowHost();

      expect(host.kind).toBe('desktop');
      expect(host.pointer).not.toBeNull();

      await host.emit('agent-companion://ready');
      expect(emitMock).toHaveBeenCalledWith('agent-companion://ready', undefined);

      await host.resizeWindow({ width: 120, height: 140 });
      expect(invokeMock).toHaveBeenCalledWith('resize_agent_companion_desktop_pet', {
        width: 120,
        height: 140,
      });

      await host.showMainWindow();
      expect(invokeMock).toHaveBeenCalledWith('show_main_window');
    });
  });

  describe('harmonyos', () => {
    it('exposes no pointer host because the window has no global cursor', () => {
      installHarmonyOsProxy();
      const host = resolveAgentCompanionPetWindowHost();

      expect(host.kind).toBe('harmonyos');
      expect(host.pointer).toBeNull();
      expect(host.startHostDrag).not.toBeNull();
    });

    it('posts commands to the ArkTS proxy as JSON', async () => {
      const proxy = installHarmonyOsProxy();
      const host = resolveAgentCompanionPetWindowHost();

      await host.emit('agent-companion://pet-command', { type: 'dismiss-task', sessionId: 's1' });

      expect(proxy.post).toHaveBeenCalledWith(
        'agent-companion://pet-command',
        JSON.stringify({ type: 'dismiss-task', sessionId: 's1' }),
      );
    });

    it('delivers host events to listeners until they unsubscribe', async () => {
      installHarmonyOsProxy();
      const host = resolveAgentCompanionPetWindowHost();
      const received: unknown[] = [];
      const unlisten = await host.listen<{ mood: string }>('agent-companion://activity-updated', payload => {
        received.push(payload);
      });

      window.__bitfunPetHostDeliver?.(JSON.stringify({
        event: 'agent-companion://activity-updated',
        payload: { mood: 'working' },
      }));
      expect(received).toEqual([{ mood: 'working' }]);

      unlisten();
      window.__bitfunPetHostDeliver?.(JSON.stringify({
        event: 'agent-companion://activity-updated',
        payload: { mood: 'rest' },
      }));
      expect(received).toEqual([{ mood: 'working' }]);
    });

    it('ignores malformed deliveries instead of throwing', () => {
      installHarmonyOsProxy();
      resolveAgentCompanionPetWindowHost();

      expect(() => window.__bitfunPetHostDeliver?.('not json')).not.toThrow();
    });

    it('drops redundant window resizes that would flicker on HarmonyOS', async () => {
      const proxy = installHarmonyOsProxy();
      const host = resolveAgentCompanionPetWindowHost();

      await host.resizeWindow({ width: 180.4, height: 96.2 });
      await host.resizeWindow({ width: 180, height: 96 });
      expect(proxy.resize).toHaveBeenCalledTimes(1);
      expect(proxy.resize).toHaveBeenCalledWith(180, 96);

      await host.resizeWindow({ width: 200, height: 96 });
      expect(proxy.resize).toHaveBeenCalledTimes(2);
    });

    it('routes window actions through the proxy', async () => {
      const proxy = installHarmonyOsProxy();
      const host = resolveAgentCompanionPetWindowHost();

      await host.hideWindow();
      await host.focusWindow();
      await host.showMainWindow();
      await host.startHostDrag?.();

      expect(proxy.hide).toHaveBeenCalledTimes(1);
      expect(proxy.focus).toHaveBeenCalledTimes(1);
      expect(proxy.showMainWindow).toHaveBeenCalledTimes(1);
      expect(proxy.startDrag).toHaveBeenCalledTimes(1);
      expect(invokeMock).not.toHaveBeenCalled();
    });
  });
});
