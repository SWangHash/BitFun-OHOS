// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  isConnected: vi.fn(() => true),
  getSession: vi.fn(),
  getHistory: vi.fn(),
  createSession: vi.fn(),
  onSessionEvent: vi.fn(() => () => {}),
}));

vi.mock('../services', () => ({
  getTerminalService: () => ({
    connect: mocks.connect,
    isConnected: mocks.isConnected,
    getSession: mocks.getSession,
    getHistory: mocks.getHistory,
    createSession: mocks.createSession,
    onSessionEvent: mocks.onSessionEvent,
  }),
}));

vi.mock('@/infrastructure/peer-device/deviceSurface', () => ({
  getActiveSurfaceScope: () => ({ surfaceId: 'local', isCurrent: () => true, assertCurrent: () => {} }),
  getActiveSurfaceId: () => 'local',
}));

import {
  clearPendingTerminalSpawn,
  peekPendingTerminalSpawn,
  registerPendingTerminalSpawn,
} from '../services/pendingTerminalSpawn';
import { useTerminal, type UseTerminalReturn } from './useTerminal';

const SESSION_ID = 'session-reserved';
const REQUEST = { workspaceId: 'workspace-1', workingDirectory: '/repo', name: 'Shell 1', source: 'manual' as const };

function reserveSpawn(surfaceId = 'local'): void {
  registerPendingTerminalSpawn(SESSION_ID, { surfaceId, request: { ...REQUEST, sessionId: SESSION_ID } });
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

describe('useTerminal reserved sessions', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let api: UseTerminalReturn | undefined;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue(undefined);
    mocks.getSession.mockResolvedValue({ id: SESSION_ID, name: 'Shell 1', status: 'Running', shellType: 'Bash' });
    mocks.getHistory.mockResolvedValue({ sessionId: SESSION_ID, events: [], data: '', historySize: 0, cols: 80, rows: 24 });
    mocks.createSession.mockResolvedValue({ id: SESSION_ID, name: 'Shell 1', status: 'Running', shellType: 'Bash' });
    clearPendingTerminalSpawn(SESSION_ID);
    container = document.createElement('div');
    root = createRoot(container);
    api = undefined;
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    clearPendingTerminalSpawn(SESSION_ID);
  });

  function Probe() {
    api = useTerminal({ sessionId: SESSION_ID });
    return null;
  }

  it('waits for a measured size before creating the shell', async () => {
    reserveSpawn();

    await act(async () => { root.render(<Probe />); });
    await flush();

    // The session does not exist yet, so attaching would fail and start the shell at a
    // guessed size instead of the panel's.
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(api?.isLoading).toBe(true);

    await act(async () => { await api!.spawnPendingSession(120, 30); });
    await flush();

    expect(mocks.createSession).toHaveBeenCalledExactlyOnceWith({
      ...REQUEST,
      sessionId: SESSION_ID,
      cols: 120,
      rows: 30,
    });
    expect(mocks.getSession).toHaveBeenCalledWith(SESSION_ID);
    expect(peekPendingTerminalSpawn(SESSION_ID)).toBeNull();
  });

  it('creates the shell only once for a reserved session', async () => {
    reserveSpawn();

    await act(async () => { root.render(<Probe />); });
    await flush();

    await act(async () => {
      await Promise.all([
        api!.spawnPendingSession(100, 20),
        api!.spawnPendingSession(100, 20),
      ]);
    });
    await flush();

    expect(mocks.createSession).toHaveBeenCalledTimes(1);
  });

  it('does not create a shell on a device surface that no longer owns the panel', async () => {
    reserveSpawn('other-surface');

    await act(async () => { root.render(<Probe />); });
    await flush();

    await act(async () => { await api!.spawnPendingSession(100, 20); });
    await flush();

    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(api?.error).toBeTruthy();
    // The intent survives so a retry on the owning surface can still create the shell.
    expect(peekPendingTerminalSpawn(SESSION_ID)).not.toBeNull();
  });

  it('attaches directly to a session that was not reserved', async () => {
    await act(async () => { root.render(<Probe />); });
    await flush();

    expect(mocks.getSession).toHaveBeenCalledWith(SESSION_ID);
    expect(mocks.createSession).not.toHaveBeenCalled();

    await act(async () => { await api!.spawnPendingSession(100, 20); });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
