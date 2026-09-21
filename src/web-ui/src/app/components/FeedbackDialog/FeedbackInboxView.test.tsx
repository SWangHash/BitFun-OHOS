// @vitest-environment jsdom

import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAccessState: vi.fn(),
  listFeedbackRecords: vi.fn(),
}));

vi.mock('@/infrastructure/api', () => ({
  FEEDBACK_INBOX_PAGE_SIZE: 20,
  feedbackAPI: {
    getAccessState: mocks.getAccessState,
    listFeedbackRecords: mocks.listFeedbackRecords,
  },
  normalizeFeedbackError: (error: unknown) => error,
}));

vi.mock('@/infrastructure/i18n/hooks/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: { count?: number }) => values?.count == null
      ? key
      : `${key}:${values.count}`,
    formatDate: (value: Date | number) => String(value),
  }),
}));

vi.mock('@bitfun/ui', () => ({
  Button: ({
    children,
    loading: _loading,
    variant: _variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    loading?: boolean;
    variant?: string;
  }) => <button {...props}>{children}</button>,
}));

vi.mock('./FeedbackConversationView', () => ({
  FeedbackConversationView: () => null,
}));

import { FeedbackInboxView } from './FeedbackInboxView';
import { useFeedbackInboxStore } from './feedbackInboxStore';

const record = (index: number) => ({
  feedbackId: `feedback-${index}`,
  category: 'other' as const,
  status: 'submitted' as const,
  hasNewReply: false,
  createdAt: `2026-07-28T01:${String(index).padStart(2, '0')}:00Z`,
  updatedAt: `2026-07-28T02:${String(index).padStart(2, '0')}:00Z`,
  canOpen: true,
});

const Harness: React.FC = () => {
  const [visibleCount, setVisibleCount] = useState(20);
  return (
    <FeedbackInboxView
      wide={false}
      selectedId={null}
      onSelect={vi.fn()}
      visibleCount={visibleCount}
      onVisibleCountChange={setVisibleCount}
      replySending={false}
      resetDraftVersion={0}
      onReplyStateChange={vi.fn()}
    />
  );
};

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('FeedbackInboxView pagination', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.getAccessState.mockReset();
    mocks.listFeedbackRecords.mockReset();
    useFeedbackInboxStore.setState({
      records: [],
      nextCursor: undefined,
      hasMore: false,
      loaded: true,
      loading: false,
      loadingMore: false,
      error: null,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderInbox = () => {
    act(() => root.render(<Harness />));
  };

  const clickLoadMore = async () => {
    const button = Array.from(container.querySelectorAll('button')).find(
      element => element.textContent === 'feedback.inbox.loadMore',
    );
    expect(button).toBeDefined();
    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
  };

  it('shows only the first page while retaining cached records for expansion', async () => {
    useFeedbackInboxStore.setState({
      records: Array.from({ length: 35 }, (_, index) => record(index)),
      hasMore: false,
    });

    renderInbox();

    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(20);
    expect(container.textContent).toContain('feedback.inbox.count:20');

    await clickLoadMore();

    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(35);
    expect(container.textContent).toContain('feedback.inbox.count:35');
    expect(mocks.listFeedbackRecords).not.toHaveBeenCalled();
  });

  it('requests the next page after all loaded records are visible', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => record(index));
    const secondPage = Array.from({ length: 15 }, (_, index) => record(index + 20));
    useFeedbackInboxStore.setState({
      records: firstPage,
      nextCursor: 'cursor-2',
      hasMore: true,
    });
    mocks.listFeedbackRecords.mockResolvedValue({ items: secondPage, hasMore: false });

    renderInbox();
    await clickLoadMore();

    expect(mocks.listFeedbackRecords).toHaveBeenCalledWith(
      { cursor: 'cursor-2' },
      { userInitiated: true },
    );
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(35);
    expect(container.textContent).toContain('feedback.inbox.count:35');
  });
});
