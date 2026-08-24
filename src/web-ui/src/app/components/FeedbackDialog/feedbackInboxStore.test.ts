import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAccessState = vi.fn();
const listFeedbackRecords = vi.fn();

const record = (index: number) => ({
  feedbackId: `feedback-${index}`,
  category: 'other' as const,
  status: 'submitted' as const,
  hasNewReply: false,
  createdAt: `2026-07-28T01:${String(index).padStart(2, '0')}:00Z`,
  updatedAt: `2026-07-28T02:${String(index).padStart(2, '0')}:00Z`,
  canOpen: true,
});

vi.mock('@/infrastructure/api', () => ({
  feedbackAPI: { getAccessState, listFeedbackRecords },
  normalizeFeedbackError: (error: unknown) => error,
}));

describe('feedbackInboxStore', () => {
  beforeEach(async () => {
    vi.resetModules();
    getAccessState.mockReset();
    listFeedbackRecords.mockReset();
  });

  it('does not inspect or query access in privacy-not-accepted mode', async () => {
    const { useFeedbackInboxStore } = await import('./feedbackInboxStore');
    await useFeedbackInboxStore.getState().initializeForMode('privacy_not_accepted');
    expect(getAccessState).not.toHaveBeenCalled();
    expect(listFeedbackRecords).not.toHaveBeenCalled();
  });

  it('checks once but does not enroll or query when there is no history', async () => {
    getAccessState.mockResolvedValue({
      hasHistory: false,
      canReuseAccess: false,
      cachedInbox: { items: [], hasMore: false },
    });
    const { useFeedbackInboxStore } = await import('./feedbackInboxStore');
    await useFeedbackInboxStore.getState().initializeForMode('full');
    await useFeedbackInboxStore.getState().initializeForMode('full');
    expect(getAccessState).toHaveBeenCalledTimes(1);
    expect(listFeedbackRecords).not.toHaveBeenCalled();
  });

  it('preserves cached records when an active refresh fails', async () => {
    const cached = {
      feedbackId: 'feedback-1',
      category: 'other',
      status: 'waiting_user',
      hasNewReply: true,
      createdAt: '2026-07-28T01:00:00Z',
      updatedAt: '2026-07-28T02:00:00Z',
      canOpen: true,
    };
    getAccessState.mockResolvedValue({
      hasHistory: true,
      canReuseAccess: true,
      cachedInbox: { items: [cached], nextCursor: 'cached-cursor', hasMore: true },
    });
    listFeedbackRecords.mockRejectedValue({ code: 'NETWORK_ERROR' });
    const { useFeedbackInboxStore } = await import('./feedbackInboxStore');

    expect(await useFeedbackInboxStore.getState().refresh(true)).toBe(false);
    expect(useFeedbackInboxStore.getState().records).toEqual([cached]);
    expect(useFeedbackInboxStore.getState().nextCursor).toBe('cached-cursor');
  });

  it('performs one startup Inbox query when full mode has reusable history', async () => {
    getAccessState.mockResolvedValue({
      hasHistory: true,
      canReuseAccess: true,
      cachedInbox: { items: [], hasMore: false },
    });
    listFeedbackRecords.mockResolvedValue({ items: [], hasMore: false });
    const { useFeedbackInboxStore } = await import('./feedbackInboxStore');

    await useFeedbackInboxStore.getState().initializeForMode('full');
    await useFeedbackInboxStore.getState().initializeForMode('full');

    expect(listFeedbackRecords).toHaveBeenCalledTimes(1);
    expect(listFeedbackRecords).toHaveBeenCalledWith({}, { userInitiated: false });
  });

  it('refreshes every currently loaded Inbox page before replacing the list', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => record(index));
    const secondPage = Array.from({ length: 20 }, (_, index) => record(index + 20));
    getAccessState.mockResolvedValue({
      hasHistory: true,
      canReuseAccess: true,
      cachedInbox: { items: firstPage, nextCursor: 'cursor-2', hasMore: true },
    });
    listFeedbackRecords
      .mockResolvedValueOnce({ items: firstPage, nextCursor: 'cursor-2', hasMore: true })
      .mockResolvedValueOnce({ items: secondPage, nextCursor: 'cursor-3', hasMore: true });
    const { useFeedbackInboxStore } = await import('./feedbackInboxStore');
    useFeedbackInboxStore.setState({
      records: [...firstPage, ...secondPage],
      nextCursor: 'cursor-3',
      hasMore: true,
      loaded: true,
    });

    expect(await useFeedbackInboxStore.getState().refresh(true)).toBe(true);
    expect(listFeedbackRecords).toHaveBeenCalledTimes(2);
    expect(listFeedbackRecords).toHaveBeenNthCalledWith(1, {}, { userInitiated: true });
    expect(listFeedbackRecords).toHaveBeenNthCalledWith(
      2,
      { cursor: 'cursor-2' },
      { userInitiated: true },
    );
    expect(useFeedbackInboxStore.getState()).toMatchObject({
      records: [...firstPage, ...secondPage],
      nextCursor: 'cursor-3',
      hasMore: true,
    });
  });

  it('keeps all loaded pages when a later refresh page fails', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => record(index));
    const loadedRecords = Array.from({ length: 40 }, (_, index) => record(index));
    getAccessState.mockResolvedValue({
      hasHistory: true,
      canReuseAccess: true,
      cachedInbox: { items: firstPage, nextCursor: 'cursor-2', hasMore: true },
    });
    listFeedbackRecords
      .mockResolvedValueOnce({ items: firstPage, nextCursor: 'cursor-2', hasMore: true })
      .mockRejectedValueOnce({ code: 'NETWORK_ERROR' });
    const { useFeedbackInboxStore } = await import('./feedbackInboxStore');
    useFeedbackInboxStore.setState({
      records: loadedRecords,
      nextCursor: 'cursor-3',
      hasMore: true,
      loaded: true,
    });

    expect(await useFeedbackInboxStore.getState().refresh(true)).toBe(false);
    expect(useFeedbackInboxStore.getState().records).toEqual(loadedRecords);
    expect(useFeedbackInboxStore.getState().nextCursor).toBe('cursor-3');
  });

  it('clears the unread marker when a conversation result is committed', async () => {
    const record = {
      feedbackId: 'feedback-1',
      category: 'other' as const,
      status: 'waiting_user' as const,
      hasNewReply: true,
      createdAt: '2026-07-28T01:00:00Z',
      updatedAt: '2026-07-28T02:00:00Z',
      canOpen: true,
    };
    const { useFeedbackInboxStore } = await import('./feedbackInboxStore');
    useFeedbackInboxStore.setState({ records: [record] });

    useFeedbackInboxStore.getState().applyServerStatus('feedback-1', 'in_progress');

    expect(useFeedbackInboxStore.getState().records[0]).toMatchObject({
      status: 'in_progress',
      hasNewReply: false,
    });
  });

  it('does not surface an unread reply that cannot be opened or acknowledged', async () => {
    const record = {
      feedbackId: 'feedback-1',
      category: 'other' as const,
      status: 'waiting_user' as const,
      hasNewReply: true,
      createdAt: '2026-07-28T01:00:00Z',
      updatedAt: '2026-07-28T02:00:00Z',
      canOpen: true,
    };
    const { hasActionableUnreadReply, useFeedbackInboxStore } = await import('./feedbackInboxStore');
    useFeedbackInboxStore.setState({ records: [record] });

    expect(hasActionableUnreadReply(record)).toBe(true);

    useFeedbackInboxStore.getState().markInaccessible('feedback-1');

    expect(hasActionableUnreadReply(useFeedbackInboxStore.getState().records[0])).toBe(false);
    expect(useFeedbackInboxStore.getState().records[0].hasNewReply).toBe(true);
  });
});
