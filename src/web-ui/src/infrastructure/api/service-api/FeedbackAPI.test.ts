import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('./ApiClient', () => ({
  api: { invoke: invokeMock },
}));

vi.mock('@/flow_chat/store/FlowChatStore', () => ({
  flowChatStore: { getState: () => ({ activeSessionId: null }) },
}));

describe('FeedbackAPI', () => {
  beforeEach(() => invokeMock.mockReset());

  it('uses a structured request and disables adapter retries', async () => {
    const { feedbackAPI } = await import('./FeedbackAPI');
    invokeMock.mockResolvedValue({
      feedbackId: 'feedback-1',
      status: 'submitted',
      inboxCursor: 'cursor-1',
    });

    await feedbackAPI.submitFeedback({
      category: 'other',
      content: 'hello',
      includeCorrelation: false,
    });

    expect(invokeMock).toHaveBeenCalledWith(
      'submit_feedback',
      { request: { category: 'other', content: 'hello', sessionIdHash: undefined } },
      { retries: 0 },
    );
  });

  it('truncates by Unicode characters without splitting surrogate pairs', async () => {
    const { feedbackContentLength, truncateFeedbackContent } = await import('./FeedbackAPI');
    const truncated = truncateFeedbackContent(`${'中'.repeat(1_999)}😀tail`);
    expect(feedbackContentLength(truncated)).toBe(2_000);
    expect(truncated.endsWith('😀')).toBe(true);
  });

  it('removes leading whitespace before applying the character limit', async () => {
    const { feedbackContentLength, feedbackInsertText, truncateFeedbackContent } = await import('./FeedbackAPI');

    expect(truncateFeedbackContent(' \n\t反馈')).toBe('反馈');
    expect(feedbackContentLength(truncateFeedbackContent(`${' '.repeat(20)}${'a'.repeat(2_000)}`))).toBe(2_000);
    expect(feedbackInsertText('abc', 3, 3, `${'x'.repeat(2_000)}tail`)).toHaveLength(1_997);
    expect(feedbackInsertText('abc', 0, 0, '  next')).toBe('next');
    expect(feedbackInsertText('a'.repeat(2_000), 2_000, 2_000, ' ')).toBe('');
    expect(feedbackInsertText('a'.repeat(2_000), 0, 10, '😀')).toBe('😀');
  });

  it('maps Inbox paging to a structured request with a fixed default page size', async () => {
    const { feedbackAPI } = await import('./FeedbackAPI');
    invokeMock.mockResolvedValue({ items: [], hasMore: false });

    await feedbackAPI.listFeedbackRecords(
      { cursor: 'cursor-1' },
      { userInitiated: true },
    );

    expect(invokeMock).toHaveBeenCalledWith(
      'list_feedback',
      {
        request: {
          cursor: 'cursor-1',
          pageSize: 20,
          userInitiated: true,
        },
      },
      { retries: 0 },
    );
  });

  it('normalizes command errors without requiring diagnostic text', async () => {
    const { normalizeFeedbackError } = await import('./FeedbackAPI');
    const caught = normalizeFeedbackError({
      code: 'RATE_LIMITED',
      message: 'server diagnostic',
      retryable: true,
      requestId: 'request-1',
      retryAfterSeconds: 30,
    });
    expect(caught.code).toBe('RATE_LIMITED');
    expect(caught.retryable).toBe(true);
    expect(caught.requestId).toBe('request-1');
    expect(caught.retryAfterSeconds).toBe(30);
  });

  it('opens message history through the local paging contract', async () => {
    const { feedbackAPI } = await import('./FeedbackAPI');
    invokeMock.mockResolvedValue({
      messages: [{
        messageId: 'message-deleted',
        sender: 'admin',
        content: 'Message content was deleted',
        contentDeleted: true,
        createdAt: '2026-07-28T02:00:00Z',
      }],
      nextCursor: 'cache:50',
      hasMore: true,
    });

    const page = await feedbackAPI.openConversation({ feedbackId: 'feedback-1' });

    expect(invokeMock).toHaveBeenCalledWith(
      'open_feedback_conversation',
      {
        request: {
          feedbackId: 'feedback-1',
          cursor: undefined,
          pageSize: 50,
          userInitiated: true,
        },
      },
      { retries: 0 },
    );
    expect(page.messages[0].contentDeleted).toBe(true);
  });

  it('sends replies through a structured request without adapter retries', async () => {
    const { feedbackAPI } = await import('./FeedbackAPI');
    invokeMock.mockResolvedValue({
      message: {
        messageId: 'message-1',
        sender: 'user',
        content: 'reply',
        contentDeleted: false,
        createdAt: '2026-07-28T03:00:00Z',
      },
      feedbackStatus: 'in_progress',
    });

    await feedbackAPI.replyFeedback('feedback-1', 'reply');

    expect(invokeMock).toHaveBeenCalledWith(
      'reply_feedback',
      { request: { feedbackId: 'feedback-1', content: 'reply' } },
      { retries: 0 },
    );
  });
});
