/**
 * Store choreography for marking a session's in-flight turn as cancelled.
 *
 * Leaf module shared by the local session driver and flow-chat-manager.
 */

import type { FlowChatContext } from '../services/flow-chat-manager/types';
import type { AnyFlowItem, ModelRound } from '../types/flow-chat';

/**
 * Settle the text and thinking items of a round that ended without a stream
 * completion (Stop, backend interrupt).
 *
 * Nothing else does: a cancelled stream no longer emits
 * `ModelRoundAttemptSuperseded`, which used to be the only path that closed the
 * cancelled attempt's items. Left alone they keep `isStreaming`, so the thinking
 * block reads "Thinking..." and Markdown stays in streaming mode on a paused turn.
 * Items live both in `items` and in `attempts[].items`; keep the two in step.
 */
export function settleStreamingRoundItems(round: ModelRound): ModelRound {
  const settle = (item: AnyFlowItem): AnyFlowItem => {
    if (item.type !== 'text' && item.type !== 'thinking') return item;
    if (!item.isStreaming && item.status !== 'streaming') return item;
    return {
      ...item,
      isStreaming: false,
      status: item.status === 'streaming' ? 'cancelled' : item.status,
    };
  };
  return {
    ...round,
    items: round.items.map(settle),
    ...(round.attempts && {
      attempts: round.attempts.map(attempt => ({ ...attempt, items: attempt.items.map(settle) })),
    }),
  };
}

export function markCurrentTurnItemsAsCancelled(
  context: FlowChatContext,
  sessionId: string
): void {
  const state = context.flowChatStore.getState();
  const session = state.sessions.get(sessionId);
  if (!session) return;

  const lastDialogTurn = session.dialogTurns[session.dialogTurns.length - 1];
  if (!lastDialogTurn) return;

  if (lastDialogTurn.status === 'completed' || lastDialogTurn.status === 'cancelled') {
    return;
  }

  lastDialogTurn.modelRounds.forEach(round => {
    round.items.forEach(item => {
      if (item.status === 'completed' || item.status === 'cancelled' || item.status === 'error') {
        return;
      }

      context.flowChatStore.updateModelRoundItem(sessionId, lastDialogTurn.id, item.id, {
        status: 'cancelled',
        ...((item.type === 'text' || item.type === 'thinking') && { isStreaming: false }),
        ...(item.type === 'tool' && {
          isParamsStreaming: false,
          endTime: Date.now()
        })
      } as any);
    });
  });

  context.flowChatStore.updateDialogTurn(sessionId, lastDialogTurn.id, turn => ({
    ...turn,
    status: 'cancelled',
    endTime: Date.now()
  }));
}
