/**
 * Manual terminal sessions that are opened before their shell exists.
 *
 * A terminal panel only knows its own geometry after it has been laid out, so a new
 * manual session is registered here first and the PTY is created by the panel with the
 * measured cols/rows. Creating the PTY eagerly starts the shell at the backend default
 * size (80x24); the shell then lays out its first prompt for that width, and the rows a
 * later resize leaves behind stay in the terminal buffer.
 */

import type { CreateSessionRequest } from '../types';

/**
 * Intents expire so a panel that closes before it was ever measured cannot spawn a
 * shell much later onto a surface the user has already left.
 */
export const PENDING_TERMINAL_SPAWN_TTL_MS = 30_000;

export interface PendingTerminalSpawn {
  /** Device surface that requested the spawn. Another surface must not create it. */
  surfaceId: string;
  /** Session request without geometry; the spawn adds the measured cols/rows. */
  request: CreateSessionRequest;
}

interface PendingTerminalSpawnEntry extends PendingTerminalSpawn {
  registeredAtMs: number;
}

const pendingTerminalSpawns = new Map<string, PendingTerminalSpawnEntry>();

function currentTimeMs(): number {
  return Date.now();
}

/** Drop expired entries; a claimed or spawned intent is never returned twice. */
function readLiveSpawn(sessionId: string): PendingTerminalSpawnEntry | null {
  const entry = pendingTerminalSpawns.get(sessionId);
  if (!entry) {
    return null;
  }

  if (currentTimeMs() - entry.registeredAtMs > PENDING_TERMINAL_SPAWN_TTL_MS) {
    pendingTerminalSpawns.delete(sessionId);
    return null;
  }

  return entry;
}

export function registerPendingTerminalSpawn(
  sessionId: string,
  spawn: PendingTerminalSpawn,
): void {
  pendingTerminalSpawns.set(sessionId, { ...spawn, registeredAtMs: currentTimeMs() });
}

/** Read the intent without claiming it, for panels that only need to know one exists. */
export function peekPendingTerminalSpawn(sessionId: string): PendingTerminalSpawn | null {
  const entry = readLiveSpawn(sessionId);
  if (!entry) {
    return null;
  }

  return { surfaceId: entry.surfaceId, request: entry.request };
}

/** Claim the intent. A claimed intent is removed so a shell is never created twice. */
export function takePendingTerminalSpawn(sessionId: string): PendingTerminalSpawn | null {
  const spawn = peekPendingTerminalSpawn(sessionId);
  pendingTerminalSpawns.delete(sessionId);
  return spawn;
}

export function clearPendingTerminalSpawn(sessionId: string): void {
  pendingTerminalSpawns.delete(sessionId);
}
