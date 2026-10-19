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

vi.mock('@/infrastructure/peer-device/deviceSurface', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/infrastructure/peer-device/deviceSurface')>();
  return {
    ...actual,
    getActiveSurfaceScope: () => ({ surfaceId: 'local', isCurrent: () => true, assertCurrent: () => {} }),
    getActiveSurfaceId: () => 'local',
  };
});

/**
 * xterm needs a laid-out viewport, which jsdom does not provide. This stub stands in for
 * the panel: it mounts, reports the size the real terminal would have measured, and
 * exposes that size through the imperative handle the panel reads.
 */
const measuredSize = { cols: 120, rows: 30 };
vi.mock('./Terminal', async () => {
  const React = await import('react');
  const Stub = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      write: () => {}, writeln: () => {}, clear: () => {}, reset: () => {}, focus: () => {},
      paste: () => {}, fit: () => {}, flushResize: () => {}, forceRedraw: () => {},
      getTerminal: () => null, getSize: () => measuredSize,
    }));
    React.useEffect(() => {
      props.onReady?.({} as never);
      props.onSizeSettled?.({ ...measuredSize });
    }, []);
    return React.createElement('div', { 'data-testid': 'terminal-stub' });
  });
  return { default: Stub };
});

import { clearPendingTerminalSpawn, registerPendingTerminalSpawn } from '../services/pendingTerminalSpawn';
import ConnectedTerminal from './ConnectedTerminal';

const SESSION_ID = 'session-reserved';
const CONNECTING_TEXT = 'Connecting to terminal';

function reserveSpawn(): void {
  registerPendingTerminalSpawn(SESSION_ID, {
    surfaceId: 'local',
    request: { workspaceId: 'workspace-1', workingDirectory: '/repo', name: 'Shell 1', source: 'manual', sessionId: SESSION_ID },
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

describe('ConnectedTerminal reserved sessions', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue(undefined);
    mocks.getSession.mockResolvedValue({ id: SESSION_ID, name: 'Shell 1', status: 'Running', shellType: 'Bash' });
    mocks.getHistory.mockResolvedValue({ sessionId: SESSION_ID, events: [], data: '', historySize: 0, cols: 120, rows: 30 });
    mocks.createSession.mockResolvedValue({ id: SESSION_ID, name: 'Shell 1', status: 'Running', shellType: 'Bash' });
    clearPendingTerminalSpawn(SESSION_ID);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    clearPendingTerminalSpawn(SESSION_ID);
  });

  it('keeps the terminal mounted while its shell is still being created', async () => {
    reserveSpawn();
    let completeCreate!: (session: unknown) => void;
    mocks.createSession.mockImplementation(() => new Promise(resolve => { completeCreate = resolve; }));

    await act(async () => { root.render(<ConnectedTerminal sessionId={SESSION_ID} />); });
    await flush();

    // The panel is the only place that can measure the geometry its shell starts with, so
    // it must not be replaced by the connecting state while the PTY is being created.
    // Replacing it here left the PTY uncreated and the panel on "Connecting to terminal".
    expect(container.querySelector('[data-testid="terminal-stub"]')).not.toBeNull();
    expect(container.textContent).not.toContain(CONNECTING_TEXT);
    expect(mocks.getSession).not.toHaveBeenCalled();

    await act(async () => {
      completeCreate({ id: SESSION_ID, name: 'Shell 1', status: 'Running', shellType: 'Bash' });
    });
    await flush();

    // The shell is created for the measured geometry, not the backend default size.
    expect(mocks.createSession).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      sessionId: SESSION_ID,
      cols: measuredSize.cols,
      rows: measuredSize.rows,
    }));
    expect(mocks.getSession).toHaveBeenCalledWith(SESSION_ID);
    expect(container.querySelector('[data-testid="terminal-stub"]')).not.toBeNull();
  });

  it('shows the connecting state while attaching a session that already exists', async () => {
    let completeGetSession!: (session: unknown) => void;
    mocks.getSession.mockImplementation(() => new Promise(resolve => { completeGetSession = resolve; }));

    await act(async () => { root.render(<ConnectedTerminal sessionId={SESSION_ID} />); });
    await flush();

    expect(container.textContent).toContain(CONNECTING_TEXT);
    expect(container.querySelector('[data-testid="terminal-stub"]')).toBeNull();

    await act(async () => {
      completeGetSession({ id: SESSION_ID, name: 'Shell 1', status: 'Running', shellType: 'Bash' });
    });
    await flush();

    expect(container.querySelector('[data-testid="terminal-stub"]')).not.toBeNull();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
