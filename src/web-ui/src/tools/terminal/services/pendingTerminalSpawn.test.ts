import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PENDING_TERMINAL_SPAWN_TTL_MS,
  clearPendingTerminalSpawn,
  peekPendingTerminalSpawn,
  registerPendingTerminalSpawn,
  takePendingTerminalSpawn,
} from './pendingTerminalSpawn';

const SESSION_ID = 'session-1';

function register(): void {
  registerPendingTerminalSpawn(SESSION_ID, {
    surfaceId: 'local',
    request: { workspaceId: 'workspace-1', workingDirectory: '/repo', source: 'manual' },
  });
}

describe('pending terminal spawn registry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    clearPendingTerminalSpawn(SESSION_ID);
  });

  afterEach(() => {
    clearPendingTerminalSpawn(SESSION_ID);
    vi.useRealTimers();
  });

  it('returns the registered spawn request once', () => {
    register();

    expect(takePendingTerminalSpawn(SESSION_ID)).toEqual({
      surfaceId: 'local',
      request: { workspaceId: 'workspace-1', workingDirectory: '/repo', source: 'manual' },
    });
    // A claimed intent must not create a second shell for the same session.
    expect(takePendingTerminalSpawn(SESSION_ID)).toBeNull();
  });

  it('keeps the intent available to peek', () => {
    register();

    expect(peekPendingTerminalSpawn(SESSION_ID)?.request.workspaceId).toBe('workspace-1');
    expect(peekPendingTerminalSpawn(SESSION_ID)?.request.workspaceId).toBe('workspace-1');
    expect(takePendingTerminalSpawn(SESSION_ID)).not.toBeNull();
  });

  it('drops an intent that no panel ever measured', () => {
    register();
    vi.setSystemTime(new Date(Date.now() + PENDING_TERMINAL_SPAWN_TTL_MS + 1));

    expect(peekPendingTerminalSpawn(SESSION_ID)).toBeNull();
    expect(takePendingTerminalSpawn(SESSION_ID)).toBeNull();
  });

  it('forgets a cancelled intent', () => {
    register();
    clearPendingTerminalSpawn(SESSION_ID);

    expect(peekPendingTerminalSpawn(SESSION_ID)).toBeNull();
  });

  it('ignores sessions without an intent', () => {
    expect(peekPendingTerminalSpawn('unknown-session')).toBeNull();
    expect(takePendingTerminalSpawn('unknown-session')).toBeNull();
  });
});
