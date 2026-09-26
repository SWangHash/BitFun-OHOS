/**
 * The nav badge is the only scheduled-job signal visible without opening a
 * panel, so what it counts has to match what the panel lists. A job the agent
 * created with "enabled": false used to disappear from the badge entirely.
 */

import { describe, expect, it } from 'vitest';
import type { CronJob } from '@/infrastructure/api';
import { computeCronJobCounts } from './cronJobCountsStore';

function sessionJob(id: string, sessionId: string, workspaceId: string, enabled = true): CronJob {
  return {
    id,
    name: id,
    schedule: { kind: 'every', everyMs: 60_000 },
    payload: { text: 'hello' },
    enabled,
    target: {
      kind: 'session',
      sessionId,
      workspace: { workspaceId, workspacePath: '/tmp/workspace' },
    },
    createdAtMs: 0,
    configUpdatedAtMs: 0,
    updatedAtMs: 0,
    state: { consecutiveFailures: 0, coalescedRunCount: 0 },
  };
}

function workspaceJob(id: string, workspaceId: string): CronJob {
  return {
    id,
    name: id,
    schedule: { kind: 'every', everyMs: 60_000 },
    payload: { text: 'hello' },
    enabled: true,
    target: {
      kind: 'workspace',
      workspace: { workspaceId, workspacePath: '/tmp/workspace' },
      launch: { agentType: 'Standard' },
    },
    createdAtMs: 0,
    configUpdatedAtMs: 0,
    updatedAtMs: 0,
    state: { consecutiveFailures: 0, coalescedRunCount: 0 },
  };
}

describe('computeCronJobCounts', () => {
  it('counts a session job towards its workspace and its session', () => {
    const counts = computeCronJobCounts([
      sessionJob('cron_a', 'session_1', 'ws_1'),
      sessionJob('cron_b', 'session_1', 'ws_1'),
      sessionJob('cron_c', 'session_2', 'ws_1'),
    ]);

    expect(counts.byWorkspaceId.get('ws_1')).toBe(3);
    expect(counts.bySessionId.get('session_1')).toBe(2);
    expect(counts.bySessionId.get('session_2')).toBe(1);
  });

  it('counts a workspace job without attributing it to a session', () => {
    const counts = computeCronJobCounts([workspaceJob('cron_d', 'ws_1')]);

    expect(counts.byWorkspaceId.get('ws_1')).toBe(1);
    expect(counts.bySessionId.size).toBe(0);
  });

  it('keeps disabled jobs counted, matching the panel list', () => {
    const counts = computeCronJobCounts([
      sessionJob('cron_e', 'session_1', 'ws_1', false),
      sessionJob('cron_f', 'session_1', 'ws_1'),
    ]);

    expect(counts.byWorkspaceId.get('ws_1')).toBe(2);
    expect(counts.bySessionId.get('session_1')).toBe(2);
  });

  it('ignores jobs whose workspace has no id', () => {
    const job = sessionJob('cron_g', 'session_1', 'ws_1');
    job.target.workspace = { workspacePath: '/tmp/workspace' };

    const counts = computeCronJobCounts([job]);

    expect(counts.byWorkspaceId.size).toBe(0);
    expect(counts.bySessionId.get('session_1')).toBe(1);
  });
});
