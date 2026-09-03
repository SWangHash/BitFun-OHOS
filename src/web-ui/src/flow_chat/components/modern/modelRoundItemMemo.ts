import type { ModelRound, TokenUsage } from '../../types/flow-chat';

export interface ModelRoundItemMemoProps {
  round: ModelRound;
  turnId: string;
  isLastRound?: boolean;
  isTurnComplete?: boolean;
  expandedThinkingItemIds?: string[];
  turnStartedAt?: number;
  turnEndedAt?: number;
  turnDurationMs?: number;
  turnTokenUsage?: TokenUsage;
}

export function areModelRoundItemPropsEqual(
  prev: ModelRoundItemMemoProps,
  next: ModelRoundItemMemoProps,
): boolean {
  const streaming = next.round.isStreaming || prev.round.isStreaming;
  const sameRenderableData =
    prev.round === next.round &&
    prev.round.id === next.round.id &&
    prev.round.status === next.round.status &&
    prev.round.items === next.round.items &&
    prev.round.attempts === next.round.attempts &&
    prev.round.attemptDiagnostics === next.round.attemptDiagnostics &&
    prev.round.historyRounds === next.round.historyRounds &&
    prev.isLastRound === next.isLastRound &&
    prev.isTurnComplete === next.isTurnComplete &&
    prev.expandedThinkingItemIds === next.expandedThinkingItemIds &&
    prev.turnStartedAt === next.turnStartedAt &&
    prev.turnEndedAt === next.turnEndedAt &&
    prev.turnDurationMs === next.turnDurationMs &&
    prev.turnTokenUsage === next.turnTokenUsage;
  return !streaming && sameRenderableData;
}