import { create } from 'zustand';
import {
  feedbackAPI,
  normalizeFeedbackError,
  type FeedbackAccessState,
  type FeedbackApiError,
  type FeedbackRecordSummary,
} from '@/infrastructure/api';
import type { PrivacyEffectiveMode } from '@/infrastructure/api/service-api/PrivacyAPI';

interface FeedbackInboxState {
  records: FeedbackRecordSummary[];
  nextCursor?: string;
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  backgroundAttempted: boolean;
  error: FeedbackApiError | null;
  initializeForMode: (mode: PrivacyEffectiveMode) => Promise<void>;
  refresh: (userInitiated: boolean) => Promise<boolean>;
  loadMore: () => Promise<boolean>;
  applyServerStatus: (feedbackId: string, status: FeedbackRecordSummary['status']) => void;
  markInaccessible: (feedbackId: string) => void;
}

export function hasActionableUnreadReply(record: FeedbackRecordSummary): boolean {
  return record.canOpen && record.hasNewReply;
}

function cachedState(access: FeedbackAccessState) {
  return {
    records: access.cachedInbox.items,
    nextCursor: access.cachedInbox.nextCursor,
    hasMore: access.cachedInbox.hasMore,
    loaded: true,
  };
}

export const useFeedbackInboxStore = create<FeedbackInboxState>((set, get) => ({
  records: [],
  nextCursor: undefined,
  hasMore: false,
  loaded: false,
  loading: false,
  loadingMore: false,
  backgroundAttempted: false,
  error: null,

  initializeForMode: async mode => {
    if (mode !== 'full' || get().backgroundAttempted) return;
    set({ backgroundAttempted: true });
    try {
      const access = await feedbackAPI.getAccessState();
      set(cachedState(access));
      if (access.hasHistory && access.canReuseAccess) {
        await get().refresh(false);
      }
    } catch (error) {
      set({ error: normalizeFeedbackError(error), loaded: true });
    }
  },

  refresh: async userInitiated => {
    if (get().loading || get().loadingMore) return false;
    const stateBeforeRefresh = get();
    set({ loading: true, error: null });
    let cachedFallback: ReturnType<typeof cachedState> | null = null;
    try {
      const access = await feedbackAPI.getAccessState();
      cachedFallback = cachedState(access);
      if (!access.hasHistory) {
        set({ ...cachedFallback, loading: false, error: null });
        return true;
      }
      if (!access.canReuseAccess) {
        set({
          ...(!stateBeforeRefresh.loaded ? cachedFallback : {}),
          loading: false,
          error: normalizeFeedbackError({
            code: 'FEEDBACK_ACCESS_UNAVAILABLE',
            message: 'Saved feedback access is unavailable',
            retryable: false,
          }),
        });
        return false;
      }

      const targetCount = Math.max(
        stateBeforeRefresh.records.length,
        access.cachedInbox.items.length,
      );
      const records: FeedbackRecordSummary[] = [];
      const knownIds = new Set<string>();
      let cursor: string | undefined;
      let nextCursor: string | undefined;
      let hasMore = false;

      do {
        const page = await feedbackAPI.listFeedbackRecords(
          cursor ? { cursor } : {},
          { userInitiated },
        );
        for (const record of page.items) {
          if (knownIds.has(record.feedbackId)) continue;
          knownIds.add(record.feedbackId);
          records.push(record);
        }
        nextCursor = page.nextCursor;
        hasMore = page.hasMore;
        if (!hasMore || !nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      } while (records.length < targetCount);

      set({
        records,
        nextCursor,
        hasMore,
        loaded: true,
        loading: false,
        error: null,
      });
      return true;
    } catch (error) {
      set({
        ...(!stateBeforeRefresh.loaded && cachedFallback ? cachedFallback : {}),
        loading: false,
        loaded: true,
        error: normalizeFeedbackError(error),
      });
      return false;
    }
  },

  loadMore: async () => {
    const { hasMore, nextCursor, loading, loadingMore, records } = get();
    if (!hasMore || !nextCursor || loading || loadingMore) return false;
    set({ loadingMore: true, error: null });
    try {
      const page = await feedbackAPI.listFeedbackRecords(
        { cursor: nextCursor },
        { userInitiated: true },
      );
      const knownIds = new Set(records.map(record => record.feedbackId));
      set({
        records: [
          ...records,
          ...page.items.filter(record => !knownIds.has(record.feedbackId)),
        ],
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        loadingMore: false,
        error: null,
      });
      return true;
    } catch (error) {
      set({ loadingMore: false, error: normalizeFeedbackError(error) });
      return false;
    }
  },

  applyServerStatus: (feedbackId, status) => {
    set(state => ({
      records: state.records.map(record =>
        record.feedbackId === feedbackId
          ? { ...record, status, hasNewReply: false }
          : record),
    }));
  },

  markInaccessible: feedbackId => {
    set(state => ({
      records: state.records.map(record =>
        record.feedbackId === feedbackId ? { ...record, canOpen: false } : record),
    }));
  },
}));
