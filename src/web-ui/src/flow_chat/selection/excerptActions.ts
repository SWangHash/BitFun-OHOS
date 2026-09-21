import { getActiveSurfaceScope } from '@/infrastructure/peer-device/deviceSurface';
import type { ConversationExcerptContext } from '@/shared/types/context';

export const FLOWCHAT_EXCERPT_ACTION = 'flowchat:excerpt-action';
export type ExcerptAction = 'annotate' | 'ask';
export interface ExcerptActionRequest {
  excerpt: ConversationExcerptContext;
  parentSessionId: string;
  action: ExcerptAction;
  surfaceEpoch: number;
  onAccepted?: () => void;
}

export function requestExcerptAction(excerpt: ConversationExcerptContext, parentSessionId: string, action: ExcerptAction): boolean {
  const scope = getActiveSurfaceScope();
  if (excerpt.source.surfaceId !== scope.surfaceId) return false;
  let accepted = false;
  window.dispatchEvent(new CustomEvent<ExcerptActionRequest>(FLOWCHAT_EXCERPT_ACTION, {
    detail: { excerpt, parentSessionId, action, surfaceEpoch: scope.epoch, onAccepted: () => { accepted = true; } },
  }));
  return accepted;
}
