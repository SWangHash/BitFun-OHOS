/**
 * Recognize a migration session from its loaded history.
 *
 * Tool signals only identify a migration session while the app watches it
 * live. A session restored after an app restart (or one tracked before
 * session ids were persisted) resumes with ordinary tool calls, so the panel
 * would never learn that it is the migration session and stay idle. When such
 * a session starts a turn, its loaded tool calls are classified the same way
 * live calls are.
 */

import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import type { FlowToolItem } from '@/flow_chat/types/flow-chat';
import { effectiveToolInvocation } from '@/flow_chat/utils/toolInvocationIdentity';
import {
  classifyMigrationToolEvent,
  isMigrationEvidence,
  isMigrationSession,
  rememberMigrationSession,
} from './migrationToolSignals';

/** Sessions already scanned without evidence; rescanned only after new turns load. */
const scannedTurnCounts = new Map<string, number>();

export function recoverMigrationSession(sessionId: string): boolean {
  if (isMigrationSession(sessionId)) return true;
  const session = flowChatStore.getState().sessions.get(sessionId);
  if (!session) return false;
  const turns = session.dialogTurns ?? [];
  if (scannedTurnCounts.get(sessionId) === turns.length) return false;
  scannedTurnCounts.set(sessionId, turns.length);

  // Newest turns first: a migration in progress touches its ledger often.
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    for (const round of turns[turnIndex].modelRounds ?? []) {
      for (const item of round.items ?? []) {
        if (item.type !== 'tool') continue;
        const tool = item as FlowToolItem;
        if (!tool.toolName) continue;
        const effective = effectiveToolInvocation(tool.toolName, tool.toolCall?.input);
        const classified = classifyMigrationToolEvent(effective.toolName, effective.input ?? {});
        if (classified && isMigrationEvidence(classified)) {
          rememberMigrationSession(sessionId);
          scannedTurnCounts.delete(sessionId);
          return true;
        }
      }
    }
  }
  return false;
}
