import type { ModelRound, FlowToolItem, TokenUsage } from '../../types/flow-chat';

export interface ModelRoundItemProps {
  round: ModelRound;
  turnId: string;
  isLastRound?: boolean;
  isTurnComplete?: boolean;
  turnStartedAt?: number;
  turnEndedAt?: number;
  turnDurationMs?: number;
  turnTokenUsage?: TokenUsage;
  canvasArtifactItems?: FlowToolItem[];
  expandedThinkingItemIds?: string[];
}

export function areModelRoundItemPropsEqual(prev: ModelRoundItemProps, next: ModelRoundItemProps): boolean {
  // Streaming content accumulates, so always re-render.
  if (next.round.isStreaming || prev.round.isStreaming) {
    return false;
  }

  // In complete state, compare items array reference to detect tool state changes.
  return (
    prev.round.id === next.round.id &&
    prev.round.renderHints?.continuedAfterInterruption === next.round.renderHints?.continuedAfterInterruption &&
    prev.round.renderHints?.disableExploreGrouping === next.round.renderHints?.disableExploreGrouping &&
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
    prev.turnTokenUsage === next.turnTokenUsage &&
    prev.canvasArtifactItems === next.canvasArtifactItems
  );
}
