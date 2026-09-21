import { createContext, useContext } from 'react';
import type { ConversationExcerptContext } from '@/shared/types/context';
import { EMPTY_SOURCE_INDEX, type ConversationExcerptSourceIndex } from './conversationExcerptInventory';

const EMPTY_EXCERPTS: readonly ConversationExcerptContext[] = [];
export const ConversationExcerptSourceContext = createContext<ConversationExcerptSourceIndex>(EMPTY_SOURCE_INDEX);

export function useConversationExcerptSources(turnId: string): readonly ConversationExcerptContext[] {
  return useContext(ConversationExcerptSourceContext).get(turnId) ?? EMPTY_EXCERPTS;
}
