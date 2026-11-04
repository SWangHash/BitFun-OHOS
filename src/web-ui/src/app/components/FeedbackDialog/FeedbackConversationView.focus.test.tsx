// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openConversation: vi.fn(),
  replyFeedback: vi.fn(),
  acknowledgeFeedback: vi.fn(),
}));

vi.mock('@/infrastructure/api', () => {
  class MockFeedbackApiError extends Error {
    constructor(
      public code: string,
      message: string,
      public retryable = false,
    ) {
      super(message);
    }
  }
  return {
    FEEDBACK_CONTENT_MAX_CHARS: 2000,
    FeedbackApiError: MockFeedbackApiError,
    feedbackAPI: {
      openConversation: mocks.openConversation,
      replyFeedback: mocks.replyFeedback,
      acknowledgeFeedback: mocks.acknowledgeFeedback,
      getAccessState: vi.fn(),
      listFeedbackRecords: vi.fn(),
    },
    feedbackContentLength: (value: string) => Array.from(value).length,
    feedbackInsertText: (value: string, start: number, end: number, inserted: string) =>
      value.slice(0, start) + inserted + value.slice(end),
    normalizeFeedbackError: (error: unknown) => error,
    planFeedbackPaste: (_value: string, _start: number, _end: number, inserted: string) => ({
      acceptedText: inserted,
      nativeMaxLength: 2000,
      useNativePaste: true,
    }),
    truncateFeedbackContent: (value: string) => Array.from(value).slice(0, 2000).join(''),
  };
});

vi.mock('@/app/components/Privacy/PrivacyContext', () => ({
  usePrivacy: () => ({
    status: {
      effectiveMode: 'full',
      policy: { updatedAt: '', consentVersion: '', documentSha256: '', locale: 'en-US' },
    },
    accept: vi.fn(),
  }),
}));
vi.mock('@/app/components/Privacy/PrivacyStatementDialog', () => ({
  PrivacyStatementDialog: () => null,
}));
vi.mock('./PrivacyStatementLink', () => ({ PrivacyStatementLink: () => null }));
vi.mock('./useRejectedInsertionCaret', () => ({
  useRejectedInsertionCaret: () => ({
    armRejectedInsertionCaret: vi.fn(),
    restoreRejectedInsertionCaret: vi.fn(),
  }),
}));
vi.mock('@/flow_chat/hooks/useImeOwnedKeyGuard', () => ({
  useImeOwnedKeyGuard: () => ({
    isImeOwnedKey: () => false,
    handleCompositionStart: vi.fn(),
    handleCompositionEnd: vi.fn(),
  }),
}));
vi.mock('@/infrastructure/i18n/hooks/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    formatDate: (value: Date | number) => String(value),
  }),
}));
vi.mock('@bitfun/ui', async () => {
  const { forwardRef } = await import('react');
  return {
    Button: ({ children, leadingIcon: _leadingIcon, loading: _loading, variant: _variant, ...props }: any) =>
      <button {...props}>{children}</button>,
    ConfirmDialog: () => null,
    IconButton: ({ children, loading: _loading, ...props }: any) => <button {...props}>{children}</button>,
    Textarea: forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
      (props, ref) => <textarea {...props} ref={ref} />,
    ),
  };
});

import { FeedbackConversationView } from './FeedbackConversationView';
import { useFeedbackInboxStore } from './feedbackInboxStore';

const feedbackRecord = {
  feedbackId: 'feedback-1',
  category: 'other' as const,
  status: 'in_progress' as const,
  hasNewReply: false,
  createdAt: '2026-07-28T01:00:00Z',
  updatedAt: '2026-07-28T02:00:00Z',
  canOpen: true,
};

describe('FeedbackConversationView reply focus', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      disconnect() {}
    });
    mocks.openConversation.mockReset().mockResolvedValue({
      messages: [],
      hasMore: false,
      syncError: null,
    });
    mocks.replyFeedback.mockReset().mockResolvedValue({
      message: {
        messageId: 'reply-1',
        sender: 'user',
        content: 'Hello',
        createdAt: '2026-07-28T03:00:00Z',
        contentDeleted: false,
      },
      feedbackStatus: 'in_progress',
    });
    useFeedbackInboxStore.setState({ records: [feedbackRecord] });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = async (focusDraftVersion: number) => {
    await act(async () => {
      root.render(
        <FeedbackConversationView
          record={feedbackRecord}
          resetDraftVersion={0}
          focusDraftVersion={focusDraftVersion}
          onInteractionStateChange={vi.fn()}
        />,
      );
      await Promise.resolve();
    });
  };

  it('focuses the reply field again after a successful Enter submission', async () => {
    await render(0);
    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      textarea.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Hello');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    });

    expect(mocks.replyFeedback).toHaveBeenCalledWith('feedback-1', 'Hello');
    expect(document.activeElement).toBe(textarea);
  });

  it('focuses the reply field when continue-editing advances the focus version', async () => {
    await render(0);
    const textarea = container.querySelector('textarea')!;
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();

    await render(1);
    await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));

    expect(document.activeElement).toBe(textarea);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Continue');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    });
    expect(mocks.replyFeedback).toHaveBeenCalledWith('feedback-1', 'Continue');
    outside.remove();
  });
});
